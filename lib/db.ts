import pg from "pg";
import { readFileSync } from "fs";

/**
 * TLS for the DB connection, by PGSSLMODE:
 *  - unset / "disable": no TLS (the Render same-region internal URL needs none).
 *  - "no-verify": encrypt but DON'T validate the server cert — an explicit
 *    dev / self-signed escape hatch ONLY (it's MITM-able, so opt in knowingly).
 *  - anything else ("require" / "verify-full" / …): VALIDATE the server cert,
 *    trusting PGSSLROOTCERT's CA bundle if given, else the system trust store.
 * Validating is the secure default; encrypting-without-validating used to be the
 * "require" behavior, which defeats the point of requiring TLS.
 */
function dbSsl(): pg.PoolConfig["ssl"] {
    const mode = process.env.PGSSLMODE;
    if (!mode || mode === "disable") return undefined;
    if (mode === "no-verify") return { rejectUnauthorized: false };
    const ca = process.env.PGSSLROOTCERT;
    return { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(ca, "utf8") } : {}) };
}

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: dbSsl(),
});

/**
 * Tagged-template + .query() wrapper around pg.Pool.
 *
 * Supports two call styles used across the codebase:
 *   sql`SELECT * FROM t WHERE id = ${val}`        — tagged template
 *   sql.query("SELECT ... $1", [val])              — parameterised string
 */
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.reduce(
        (acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ""),
        "",
    );
    return pool.query(text, values);
}

sql.query = (text: string, values?: unknown[]) => pool.query(text, values);

export { sql };

/** Query bound to one transaction's client. */
export type TxQuery = (text: string, values?: unknown[]) => Promise<pg.QueryResult>;

/**
 * Run `fn` inside a single transaction on ONE dedicated client. The plain `sql`
 * helper goes through `pool.query`, which can grab a different pooled connection
 * per call — useless for a transaction — so callers that need atomicity use this.
 * Commits on success, rolls back on any throw, and always releases the client.
 */
export async function transaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn((text, values) => client.query(text, values));
        await client.query("COMMIT");
        return result;
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch { /* ignore: surface the original error */ }
        throw e;
    } finally {
        client.release();
    }
}

let migrated = false;
let migrating: Promise<void> | null = null;

/** Advisory-lock key so concurrent INSTANCES (a multi-task cold start) serialize
 *  the migration instead of racing on CREATE INDEX. Arbitrary fixed bigint. */
const MIGRATION_LOCK_KEY = 4_927_271_010;

/**
 * Create the schema if absent. Every route calls this per request, so the
 * in-flight run is memoized within a process; across processes a transaction-
 * scoped advisory lock serializes the DDL (so multiple instances starting at once
 * don't race on CREATE INDEX). On failure the promise is cleared so a later
 * request retries.
 */
export function migrate(): Promise<void> {
    if (migrated) return Promise.resolve();
    if (!migrating) {
        migrating = runMigration()
            .then(() => { migrated = true; })
            .finally(() => { migrating = null; });
    }
    return migrating;
}

async function runMigration(): Promise<void> {
    await transaction(async (q) => {
        // Block until we hold the lock; it auto-releases at COMMIT.
        await q("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
        await q(`CREATE TABLE IF NOT EXISTS verification (
          id            TEXT PRIMARY KEY,
          serial_number TEXT NOT NULL,
          product_type  TEXT NOT NULL,
          overall       TEXT NOT NULL,
          brand_name    TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await q(`CREATE TABLE IF NOT EXISTS field_result (
          id                TEXT PRIMARY KEY,
          verification_id   TEXT NOT NULL REFERENCES verification(id) ON DELETE CASCADE,
          field             TEXT NOT NULL,
          status            TEXT NOT NULL,
          label_value       TEXT,
          application_value TEXT,
          score             REAL,
          issues            JSONB
        )`);
        await q(`CREATE INDEX IF NOT EXISTS idx_verif_serial    ON verification(serial_number)`);
        // Functional index so the case-insensitive serial search (UPPER(serial)=…) is indexed.
        await q(`CREATE INDEX IF NOT EXISTS idx_verif_serial_ci ON verification(UPPER(serial_number))`);
        await q(`CREATE INDEX IF NOT EXISTS idx_verif_overall   ON verification(overall)`);
        await q(`CREATE INDEX IF NOT EXISTS idx_verif_brand     ON verification(brand_name)`);
        await q(`CREATE INDEX IF NOT EXISTS idx_verif_created   ON verification(created_at)`);
        await q(`CREATE INDEX IF NOT EXISTS idx_field_verif     ON field_result(verification_id)`);
    });
}
