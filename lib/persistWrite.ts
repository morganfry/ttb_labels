import { transaction } from "./db";
import type { VerificationResult } from "./schema";
import { randomUUID } from "crypto";

/**
 * Persist one verdict atomically: the verification head row and all its
 * field rows commit together or not at all. (Without a transaction, a mid-loop
 * failure — connection drop, timeout, restart — would leave a verification row
 * with only some of its field_result rows, corrupting the searchable record.)
 */
export async function saveResult(result: VerificationResult): Promise<void> {
    const id = randomUUID();
    const brandField = result.fields.find((f) => f.field === "brandName");
    const brandName = brandField?.labelValue ?? brandField?.applicationValue ?? null;

    await transaction(async (q) => {
        await q(
            `INSERT INTO verification (id, serial_number, product_type, overall, brand_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, result.serialNumber, result.productType, result.overall, brandName],
        );
        for (const f of result.fields) {
            await q(
                `INSERT INTO field_result (id, verification_id, field, status, label_value, application_value, score, issues)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [randomUUID(), id, f.field, f.status, f.labelValue, f.applicationValue, f.score ?? null, JSON.stringify(f.issues)],
            );
        }
    });
}
