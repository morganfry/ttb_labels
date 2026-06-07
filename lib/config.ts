/* Operational configuration — tunable knobs in one place.
 * NOT here: secrets (ANTHROPIC_API_KEY stays in process.env) and domain
 * rules (matcher thresholds stay in schema.ts with the logic they govern). */

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MODEL = process.env.MODEL ?? "claude-sonnet-4-6";

export const config = {
    /** General/default model (also the form parser's default). */
    model: MODEL,
    /**
     * Per-side model overrides. The label is verbatim transcription, which a
     * faster/cheaper tier handles well, so it defaults to Haiku; the form parser
     * stays on the general model. Both honor MODEL as a fallback and can be
     * pinned independently via LABEL_MODEL / FORM_MODEL. Confirm these are
     * current, valid model ids before real use.
     */
    labelModel: process.env.LABEL_MODEL ?? "claude-haiku-4-5",
    formModel: process.env.FORM_MODEL ?? MODEL,
    maxTokens: 8192,
    maxRetries: 2,
    retryBaseMs: 500,
    concurrency: intFromEnv("BATCH_CONCURRENCY", 6),
    pageSize: 25,
    temperature: 0,
    /* CSV bulk path: label images come from per-row URLs or an uploaded ZIP of
     * local files. These bound that intake so one bad row (or archive) can't
     * stall or balloon a batch. */
    csvImageMaxBytes: intFromEnv("CSV_IMAGE_MAX_BYTES", 12 * 1024 * 1024),
    csvImageFetchTimeoutMs: intFromEnv("CSV_IMAGE_FETCH_TIMEOUT_MS", 15000),
    csvMaxImagesPerRow: intFromEnv("CSV_MAX_IMAGES_PER_ROW", 6),
    /* Cap on the uploaded image-ZIP (compressed) — a blunt zip-bomb mitigation,
     * since extraction decompresses the whole archive into memory. */
    csvImageZipMaxBytes: intFromEnv("CSV_IMAGE_ZIP_MAX_BYTES", 100 * 1024 * 1024),
    /* PDF bulk path: a dropped ZIP of combined-application PDFs is expanded in
     * the browser (zipPdfs.ts). pdfZipMaxBytes guards the compressed upload; the
     * per-entry/total caps are a REAL decompressed budget enforced before each
     * entry is expanded, so these bound RAM even against a crafted archive. */
    pdfZipMaxBytes: intFromEnv("PDF_ZIP_MAX_BYTES", 200 * 1024 * 1024),
    pdfZipMaxEntryBytes: intFromEnv("PDF_ZIP_MAX_ENTRY_BYTES", 50 * 1024 * 1024),
    pdfZipMaxTotalBytes: intFromEnv("PDF_ZIP_MAX_TOTAL_BYTES", 500 * 1024 * 1024),
} as const;
