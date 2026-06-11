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
    /* Upload guards (memory/CPU-exhaustion DoS): the request body is rejected by
     * Content-Length before it's buffered; per-file, item-count, and CSV row caps
     * bound the rest. Large legit batches should be split rather than raised. */
    uploadMaxBytes: intFromEnv("UPLOAD_MAX_BYTES", 256 * 1024 * 1024),
    /* Aligned with the model API's 32 MB request ceiling: payloads are sent
     * base64 (×4/3), so ~24 MB raw is the largest file whose worst-case slice
     * (the un-rasterized fallback sends it nearly whole) still fits. A higher
     * cap would accept uploads that can only fail at the model call. */
    verifyMaxFileBytes: intFromEnv("VERIFY_MAX_FILE_BYTES", 24 * 1024 * 1024),
    verifyMaxItems: intFromEnv("VERIFY_MAX_ITEMS", 500),
    csvMaxBytes: intFromEnv("CSV_MAX_BYTES", 16 * 1024 * 1024),
    csvMaxRows: intFromEnv("CSV_MAX_ROWS", 5000),
    /* Label rasterization (pdfRaster.ts): artwork pages are rendered to JPEGs
     * capped at this long edge before the model call. 1568 px is the native
     * image limit of the Haiku/Sonnet tiers in use — larger inputs are
     * downscaled by the API anyway, so extra pixels cost upload time for zero
     * accuracy. Raise toward 2576 only if moving the label read to Opus 4.7+. */
    visionMaxEdgePx: intFromEnv("VISION_MAX_EDGE_PX", 1568),
    rasterJpegQuality: intFromEnv("RASTER_JPEG_QUALITY", 85),
    /* Artwork slices are a few pages; past this count, sending the PDF as-is
     * beats building dozens of JPEGs on our CPU. */
    rasterMaxPages: intFromEnv("RASTER_MAX_PAGES", 8),
    /* Per-label latency target (ms). The compliance team's hard bar from the
     * discovery interviews ("if we can't get results back in about 5 seconds,
     * nobody's going to use it"). Purely a display benchmark — it colors the
     * measured per-item timing in the UI; it changes no verdict. */
    latencyTargetMs: intFromEnv("LATENCY_TARGET_MS", 5000),
    /* CSV bulk path: label images are uploaded alongside the CSV (loose files
     * and/or a ZIP) and resolved from memory. These bound that intake so one bad
     * row (or archive) can't balloon a batch. Per-image cap aligned with the
     * model API's 10 MB-per-image limit, which is measured on the BASE64 form:
     * 7.5 MB raw × 4/3 = 10 MB encoded. A larger image could only fail at the
     * model call, after the upload already succeeded. */
    csvImageMaxBytes: intFromEnv("CSV_IMAGE_MAX_BYTES", 7.5 * 1024 * 1024),
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
    /* Matches verifyMaxFileBytes: ZIP entries become verify-route uploads, so a
     * larger entry would extract client-side only to be rejected server-side. */
    pdfZipMaxEntryBytes: intFromEnv("PDF_ZIP_MAX_ENTRY_BYTES", 24 * 1024 * 1024),
    pdfZipMaxTotalBytes: intFromEnv("PDF_ZIP_MAX_TOTAL_BYTES", 500 * 1024 * 1024),
} as const;
