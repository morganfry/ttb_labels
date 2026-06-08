import { config } from "./config";

/**
 * The subset of operational config the CLIENT enforces — pre-flight UX guards
 * (CSV/file size + row caps) and the browser-side ZIP expansion budget.
 *
 * Why this exists: lib/config.ts reads process.env, which only resolves at
 * runtime on the SERVER. Imported into a client component the same reads yield
 * undefined → the compiled defaults, so an env override (e.g. PDF_ZIP_MAX_BYTES)
 * silently wouldn't apply in the browser. Instead the server reads these once and
 * hands them to the client via ClientConfigProvider, so both sides use the SAME
 * values — one source of truth, not two.
 */
export interface ClientConfig {
    latencyTargetMs: number;
    pdfZipMaxBytes: number;
    pdfZipMaxEntryBytes: number;
    pdfZipMaxTotalBytes: number;
    csvMaxBytes: number;
    csvMaxRows: number;
    csvMaxImagesPerRow: number;
    csvImageMaxBytes: number;
    csvImageZipMaxBytes: number;
    csvImageZipMaxTotalBytes: number;
}

/** Read the client-relevant caps on the server (where runtime env is real). */
export function clientConfig(): ClientConfig {
    return {
        latencyTargetMs: config.latencyTargetMs,
        pdfZipMaxBytes: config.pdfZipMaxBytes,
        pdfZipMaxEntryBytes: config.pdfZipMaxEntryBytes,
        pdfZipMaxTotalBytes: config.pdfZipMaxTotalBytes,
        csvMaxBytes: config.csvMaxBytes,
        csvMaxRows: config.csvMaxRows,
        csvMaxImagesPerRow: config.csvMaxImagesPerRow,
        csvImageMaxBytes: config.csvImageMaxBytes,
        csvImageZipMaxBytes: config.csvImageZipMaxBytes,
        csvImageZipMaxTotalBytes: config.csvImageZipMaxTotalBytes,
    };
}
