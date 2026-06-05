/* Operational configuration — tunable knobs in one place.
 * NOT here: secrets (ANTHROPIC_API_KEY stays in process.env) and domain
 * rules (matcher thresholds stay in schema.ts with the logic they govern). */

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
    model: process.env.MODEL ?? "claude-sonnet-4-5",
    maxTokens: 1500,
    maxRetries: 2,
    retryBaseMs: 500,
    concurrency: intFromEnv("BATCH_CONCURRENCY", 6),
    pageSize: 25,
} as const;
