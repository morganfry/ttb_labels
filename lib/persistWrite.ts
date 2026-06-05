import { sql } from "./db";
import type { VerificationResult } from "./schema";
import { randomUUID } from "crypto";

export async function saveResult(result: VerificationResult): Promise<void> {
    const id = randomUUID();
    const brandField = result.fields.find((f) => f.field === "brandName");
    const brandName = brandField?.labelValue ?? brandField?.applicationValue ?? null;

    await sql`
        INSERT INTO verification (id, serial_number, product_type, overall, brand_name)
        VALUES (${id}, ${result.serialNumber}, ${result.productType}, ${result.overall}, ${brandName})
    `;

    for (const f of result.fields) {
        await sql`
            INSERT INTO field_result (id, verification_id, field, status, label_value, application_value, score, issues)
            VALUES (${randomUUID()}, ${id}, ${f.field}, ${f.status}, ${f.labelValue}, ${f.applicationValue}, ${f.score ?? null}, ${JSON.stringify(f.issues)})
        `;
    }
}
