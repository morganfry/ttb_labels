import { sql } from "./db";
import type { VerificationResult, FieldResult, ProductType } from "./schema";

export interface SearchQuery {
    serialNumber?: string; brand?: string;
    overall?: "pass" | "needsReview" | "fail"; productType?: ProductType;
    fromDate?: string; toDate?: string; limit?: number; offset?: number;
}

export interface VerificationSummary {
    id: string; serialNumber: string; productType: ProductType;
    overall: "pass" | "needsReview" | "fail"; brandName: string | null; createdAt: string;
}

export interface SearchPage {
    rows: VerificationSummary[]; total: number; limit: number; offset: number;
}

export async function search(q: SearchQuery): Promise<SearchPage> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const p = () => `$${args.length + 1}`;
    // Serial match is case-insensitive (and whitespace-tolerant) to match the
    // tolerant spirit of the other text filters — "ab1234" finds "AB1234".
    if (q.serialNumber) { where.push(`UPPER(serial_number) = UPPER(${p()})`); args.push(q.serialNumber.trim()); }
    // Escape LIKE metacharacters so a literal % or _ in the brand is matched as
    // text, not as a wildcard (default ESCAPE is backslash).
    if (q.brand)        { where.push(`brand_name ILIKE ${p()}`); args.push(`%${escapeLike(q.brand)}%`); }
    if (q.overall)      { where.push(`overall = ${p()}`); args.push(q.overall); }
    if (q.productType)  { where.push(`product_type = ${p()}`); args.push(q.productType); }
    if (q.fromDate)     { where.push(`created_at >= ${p()}`); args.push(q.fromDate); }
    // `< toDate + 1 day` so a date-only bound (e.g. "2026-06-07", which Postgres
    // reads as midnight) still includes every record created that whole day,
    // rather than excluding everything after 00:00:00.
    if (q.toDate)       { where.push(`created_at < (${p()}::date + 1)`); args.push(q.toDate); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;

    const countRes = await sql.query(`SELECT COUNT(*)::int AS n FROM verification ${clause}`, args);
    const total = Number(countRes.rows[0]?.n ?? 0);

    const res = await sql.query(
        `SELECT id, serial_number, product_type, overall, brand_name, created_at
     FROM verification ${clause} ORDER BY created_at DESC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, offset],
    );
    return { rows: res.rows.map(rowToSummary), total, limit, offset };
}

export async function getResult(id: string): Promise<VerificationResult | null> {
    const head = await sql`SELECT * FROM verification WHERE id = ${id}`;
    if (head.rows.length === 0) return null;
    const h = head.rows[0];
    const fields = await sql`SELECT field, status, label_value, application_value, score, issues FROM field_result WHERE verification_id = ${id}`;
    return {
        serialNumber: String(h.serial_number),
        productType: String(h.product_type) as ProductType,
        overall: String(h.overall) as VerificationResult["overall"],
        fields: fields.rows.map((r): FieldResult => ({
            field: String(r.field) as FieldResult["field"],
            status: String(r.status) as FieldResult["status"],
            labelValue: r.label_value as string | null,
            applicationValue: r.application_value as string | null,
            score: r.score == null ? undefined : Number(r.score),
            issues: Array.isArray(r.issues) ? r.issues : [],
        })),
    };
}

/** Escape the LIKE/ILIKE wildcards (\ % _) so user text matches literally. */
function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function rowToSummary(r: Record<string, unknown>): VerificationSummary {
    return {
        id: String(r.id),
        serialNumber: String(r.serial_number),
        productType: String(r.product_type) as ProductType,
        overall: String(r.overall) as VerificationSummary["overall"],
        brandName: (r.brand_name as string | null) ?? null,
        createdAt: new Date(r.created_at as string).toISOString(),
    };
}
