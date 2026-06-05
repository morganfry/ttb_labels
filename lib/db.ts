import pg from "pg";

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
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

let migrated = false;

export async function migrate(): Promise<void> {
    if (migrated) return;
    await sql`
    CREATE TABLE IF NOT EXISTS verification (
      id            TEXT PRIMARY KEY,
      serial_number TEXT NOT NULL,
      product_type  TEXT NOT NULL,
      overall       TEXT NOT NULL,
      brand_name    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`
    CREATE TABLE IF NOT EXISTS field_result (
      id                TEXT PRIMARY KEY,
      verification_id   TEXT NOT NULL REFERENCES verification(id) ON DELETE CASCADE,
      field             TEXT NOT NULL,
      status            TEXT NOT NULL,
      label_value       TEXT,
      application_value TEXT,
      score             REAL,
      issues            JSONB
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_verif_serial  ON verification(serial_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_verif_overall ON verification(overall)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_verif_brand   ON verification(brand_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_verif_created ON verification(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_field_verif   ON field_result(verification_id)`;
    migrated = true;
}
