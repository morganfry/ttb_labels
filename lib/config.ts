/* Operational configuration — tunable knobs in one place.
 * NOT here: secrets (ANTHROPIC_API_KEY stays in process.env) and domain
 * rules (matcher thresholds stay in schema.ts with the logic they govern). */

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
    model: process.env.MODEL ?? "claude-sonnet-4-6",
    maxTokens: 8192,
    maxRetries: 2,
    retryBaseMs: 500,
    concurrency: intFromEnv("BATCH_CONCURRENCY", 6),
    pageSize: 25,
    temperature: 0,
    /* CSV bulk path: label images are fetched from the URLs supplied per row.
     * These bound that fetch so one bad row can't stall or balloon a batch. */
    csvImageMaxBytes: intFromEnv("CSV_IMAGE_MAX_BYTES", 12 * 1024 * 1024),
    csvImageFetchTimeoutMs: intFromEnv("CSV_IMAGE_FETCH_TIMEOUT_MS", 15000),
    csvMaxImagesPerRow: intFromEnv("CSV_MAX_IMAGES_PER_ROW", 6),
} as const;
