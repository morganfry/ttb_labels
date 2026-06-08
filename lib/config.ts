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
    /** Transport retries for the model call, passed to the Anthropic SDK (it
     *  retries 429/5xx/connection with retry-after-aware backoff). The single
     *  retry layer — don't add a second loop around messages.create. */
    maxRetries: 2,
    concurrency: intFromEnv("BATCH_CONCURRENCY", 6),
    pageSize: 25,
    temperature: 0,
    /* Per-label latency target (ms). The compliance team's hard bar from the
     * discovery interviews ("if we can't get results back in about 5 seconds,
     * nobody's going to use it"). Purely a display benchmark — it colors the
     * measured per-item timing in the UI; it changes no verdict. */
    latencyTargetMs: intFromEnv("LATENCY_TARGET_MS", 5000),
    /* CSV bulk path: label images are uploaded alongside the CSV (loose files
     * and/or a ZIP) and resolved from memory. These bound that intake so one bad
     * row (or archive) can't balloon a batch. */
    csvImageMaxBytes: intFromEnv("CSV_IMAGE_MAX_BYTES", 12 * 1024 * 1024),
    csvMaxImagesPerRow: intFromEnv("CSV_MAX_IMAGES_PER_ROW", 6),
    /* Cap on the uploaded image-ZIP (compressed upload size). */
    csvImageZipMaxBytes: intFromEnv("CSV_IMAGE_ZIP_MAX_BYTES", 100 * 1024 * 1024),
    /* Real DECOMPRESSED budget for the image ZIP (zip-bomb guard): a ZIP entry is
     * rejected by its declared uncompressed size before expansion when it exceeds
     * the per-image cap (csvImageMaxBytes) or would push the running total past
     * this. Mirrors the PDF-ZIP per-entry/total budget; see zipImages.ts. */
    csvImageZipMaxTotalBytes: intFromEnv("CSV_IMAGE_ZIP_MAX_TOTAL_BYTES", 200 * 1024 * 1024),
    /* PDF/image bulk path: a dropped ZIP of applications (combined PDFs and/or
     * images) is expanded in the browser (zipDocs.ts). pdfZipMaxBytes guards the
     * compressed upload; the per-entry/total caps are a REAL decompressed budget
     * enforced before each entry is expanded, so these bound RAM even against a
     * crafted archive. */
    pdfZipMaxBytes: intFromEnv("PDF_ZIP_MAX_BYTES", 200 * 1024 * 1024),
    pdfZipMaxEntryBytes: intFromEnv("PDF_ZIP_MAX_ENTRY_BYTES", 50 * 1024 * 1024),
    pdfZipMaxTotalBytes: intFromEnv("PDF_ZIP_MAX_TOTAL_BYTES", 500 * 1024 * 1024),
} as const;
