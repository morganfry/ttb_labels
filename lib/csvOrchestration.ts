/**
 * Batch processing for the CSV bulk path: fetch each row's label images,
 * transcribe them, match against the row's application data, persist, and
 * stream each verdict.
 *
 * This mirrors lib/orchestration.ts (the PDF path) and reuses its worker pool
 * ({@link runPool}) and outcome/summary types verbatim, so both paths produce
 * identical streaming behavior and result shapes. The only difference is the
 * per-item pipeline: the application side comes from CSV columns (no form
 * extraction, no PDF slicing) while the label side is still model-read from the
 * fetched images.
 */
import { runPool, type ItemOutcome, type ItemTimings, type BatchErrorInfo, type BatchSummary, type PoolOptions } from "./orchestration";
import { resolveLabelImages, ImageFetchError } from "./imageFetch";
import { parseLabel } from "./parsers";
import { verify } from "./matching";
import { ExtractionError } from "./extraction";
import { config } from "./config";
import type { ApplicationData, Confidence, VerificationResult } from "./schema";
import type { ZipImageIndex } from "./zipImages";

/** One CSV row of work: application data (from columns) + label image references. */
export interface CsvWorkItem {
    id: string;
    name: string;
    app: ApplicationData;
    /** http(s) URLs and/or file names inside {@link CsvBatchOptions.zipImages}. */
    imageRefs: string[];
    /** Pre-set failure for a row that failed CSV parsing; short-circuits work. */
    preError?: BatchErrorInfo;
}

export interface CsvBatchOptions extends PoolOptions {
    persist?: (result: VerificationResult) => Promise<void>;
    /** Global model override; the label read defaults to config.labelModel. */
    model?: string;
    labelModel?: string;
    /** Injection seam for tests; defaults to the real model-backed parser. */
    parseLabel?: typeof parseLabel;
    /** Injection seam for tests; defaults to the real URL/ZIP resolver. */
    resolveImages?: typeof resolveLabelImages;
    /** In-memory index of an uploaded image ZIP, for local-file references. */
    zipImages?: ZipImageIndex;
}

/** Process all rows, streaming each result. Resolves with the batch summary. */
export function processCsvBatch(items: CsvWorkItem[], opts: CsvBatchOptions): Promise<BatchSummary> {
    return runPool(items, (item) => processOneCsv(item, opts), opts);
}

/**
 * CSV-confident application values: each column is exact typed text, not a
 * model read, so the application side is "high" confidence. The confidence gate
 * in matching then only down-ranks shaky LABEL reads — which is exactly right,
 * since the label is the only model-read side here.
 */
function csvAppConfidence(): Partial<Record<keyof ApplicationData, Confidence>> {
    return { brandName: "high", applicantNameAddress: "high", wineAppellation: "high" };
}

async function processOneCsv(item: CsvWorkItem, opts: CsvBatchOptions): Promise<ItemOutcome> {
    const start = Date.now();
    const timings: ItemTimings = {};
    const fail = (error: BatchErrorInfo): ItemOutcome => ({ id: item.id, name: item.name, ok: false, error, latencyMs: Date.now() - start, timings });

    // A row that failed CSV validation arrives pre-failed — surface it as-is.
    if (item.preError) return fail(item.preError);

    const resolveImages = opts.resolveImages ?? resolveLabelImages;
    const label = opts.parseLabel ?? parseLabel;

    let inputs;
    const fetchStart = Date.now();
    try {
        inputs = await resolveImages(item.imageRefs, opts.zipImages);
    } catch (e) {
        const retryable = e instanceof ImageFetchError && /timed out|\b5\d\d\b/i.test(e.message);
        return fail({ kind: "extraction", stage: "label", message: `Image fetch failed: ${msg(e)}`, retryable });
    }
    timings.fetchMs = Date.now() - fetchStart;

    let labelRes;
    const labelStart = Date.now();
    try {
        labelRes = await label(inputs, opts.labelModel ?? opts.model ?? config.labelModel);
    } catch (e) {
        return fail(classifyExtraction(e));
    }
    timings.labelMs = Date.now() - labelStart;

    let result: VerificationResult;
    const matchStart = Date.now();
    try {
        result = verify(labelRes.data, item.app, csvAppConfidence());
    } catch (e) {
        return fail({ kind: "matching", stage: "match", message: `Matching failed: ${msg(e)}`, retryable: false });
    }
    timings.matchMs = Date.now() - matchStart;

    // Persistence is non-fatal (same policy as the PDF path): a lost DB write
    // must not discard a verdict the agent is already viewing.
    if (opts.persist) {
        try { await opts.persist(result); }
        catch (e) { console.error(`Persist failed for ${item.name}:`, msg(e)); }
    }

    return { id: item.id, name: item.name, ok: true, result, latencyMs: Date.now() - start, timings };
}

/** Map a label-extraction failure to a batch error, marking transient kinds retryable. */
function classifyExtraction(err: unknown): BatchErrorInfo {
    if (err instanceof ExtractionError) {
        const retryable = err.kind === "network" || err.kind === "api";
        return { kind: "extraction", stage: "label", message: err.message, retryable };
    }
    return { kind: "unknown", stage: "label", message: msg(err), retryable: false };
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
