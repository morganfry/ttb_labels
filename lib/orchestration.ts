/**
 * Batch processing: extract + match + persist for a queue of applications,
 * with a bounded number in flight, streaming each result as it lands.
 *
 * Two interview-driven constraints shape this: the ~5s expectation is
 * PER LABEL not per batch (so we stream, never block on the whole batch),
 * and importers submit 200-300 at once (so a concurrency cap prevents
 * opening hundreds of simultaneous model calls).
 */
import { extractFirstPage, extractLabelArtwork, toBase64 } from "./pdfFirstPage";
import { parseLabel, parseForm, type FormExtraction } from "./parsers";
import { verify } from "./matching";
import { ExtractionError, type ExtractionInput, type MediaType } from "./extraction";
import { config } from "./config";
import type { VerificationResult, ApplicationData, Confidence } from "./schema";

/**
 * One unit of work — one application as a combined document. Two intake shapes:
 *  - PDF (mediaType "application/pdf", the default): the SAME file is given as
 *    both `labelPdf` and `formPdf`; the orchestrator slices page 1 for the form
 *    and the artwork pages for the label.
 *  - Image (mediaType "image/*"): a flat image showing the whole application;
 *    it can't be sliced, so the one image is read by BOTH parsers as-is.
 */
export interface WorkItem {
    id: string;
    name: string;
    labelPdf: Uint8Array;
    formPdf: Uint8Array;
    /** Defaults to "application/pdf"; an image type switches off PDF slicing. */
    mediaType?: MediaType;
}

/** Discriminated union — success carries the verdict, failure carries a
 *  classified error. One bad item never aborts the batch. */
export type ItemOutcome =
    | { id: string; name: string; ok: true; result: VerificationResult; latencyMs: number }
    | { id: string; name: string; ok: false; error: BatchErrorInfo; latencyMs: number };

export interface BatchErrorInfo {
    kind: "extraction" | "matching" | "unknown";
    stage: "label" | "form" | "match" | "persist";
    message: string;
    /** Whether a re-run might succeed (network/api yes; parse/shape no). */
    retryable: boolean;
}

export interface BatchOptions {
    /** Max items in flight; clamped to a hard ceiling. Defaults to config. */
    concurrency?: number;
    /** Called as each item finishes — drives incremental UI updates. */
    onResult: (outcome: ItemOutcome) => void;
    onProgress?: (done: number, total: number) => void;
    /** Optional save hook; a failure here is non-fatal (see processOne). */
    persist?: (result: VerificationResult) => Promise<void>;
    /** Cancels the batch (e.g. client disconnect). */
    signal?: AbortSignal;
    /** Global model override applied to both sides unless a per-side one is set. */
    model?: string;
    /** Per-side model overrides (default to config.labelModel / config.formModel). */
    labelModel?: string;
    formModel?: string;
    /**
     * Parser injection seam. Defaults to the real model-backed parsers; tests
     * override these with fixtures to exercise the pipeline deterministically
     * without an API call. Production never passes them.
     */
    parsers?: {
        parseLabel: typeof parseLabel;
        parseForm: typeof parseForm;
    };
}

export interface BatchSummary {
    total: number; succeeded: number; failed: number;
    pass: number; needsReview: number; fail: number; totalMs: number;
}

/**
 * Process all items, streaming results via `onResult`. Resolves with the
 * aggregate summary once the queue is drained.
 *
 * Concurrency model: N persistent workers pull from a shared cursor rather
 * than chunking the queue. This keeps exactly N in flight at all times — when
 * one finishes it grabs the next — so a single slow item never stalls the
 * others, unlike fixed-size batches that wait on their slowest member.
 */
export async function processBatch(items: WorkItem[], opts: BatchOptions): Promise<BatchSummary> {
    return runPool(items, (item) => processOne(item, opts), opts);
}

/** The streaming-aware part of {@link BatchOptions}, shared by every pool. */
export interface PoolOptions {
    concurrency?: number;
    onResult: (outcome: ItemOutcome) => void;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
}

/**
 * Generic bounded worker pool: run `process` over `items` with at most N in
 * flight, streaming each {@link ItemOutcome} as it lands and returning the
 * aggregate summary. The PDF and CSV paths differ only in `process`; the
 * concurrency model, cancellation, and tallying live here once.
 *
 * Concurrency model: N persistent workers pull from a shared cursor rather
 * than chunking the queue. This keeps exactly N in flight at all times — when
 * one finishes it grabs the next — so a single slow item never stalls the
 * others, unlike fixed-size batches that wait on their slowest member.
 */
export async function runPool<T>(
    items: T[],
    process: (item: T) => Promise<ItemOutcome>,
    opts: PoolOptions,
): Promise<BatchSummary> {
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? config.concurrency, 12));
    const total = items.length;
    const start = Date.now();
    const summary: BatchSummary = { total, succeeded: 0, failed: 0, pass: 0, needsReview: 0, fail: 0, totalMs: 0 };
    let done = 0;
    let cursor = 0;

    async function worker() {
        while (true) {
            if (opts.signal?.aborted) return;
            const index = cursor++;
            if (index >= items.length) return;
            const outcome = await process(items[index]);
            if (outcome.ok) { summary.succeeded++; summary[outcome.result.overall]++; }
            else summary.failed++;
            opts.onResult(outcome); // stream out now — UI updates this row immediately
            done++;
            opts.onProgress?.(done, total);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, worker);
    await Promise.all(workers);
    summary.totalMs = Date.now() - start;
    return summary;
}

/**
 * Single-item pipeline: slice form → extract label+form concurrently → match
 * → persist. Every failure is caught and classified into an ItemOutcome
 * rather than thrown, so one bad file can't abort the batch.
 */
async function processOne(item: WorkItem, opts: BatchOptions): Promise<ItemOutcome> {
    const start = Date.now();
    const fail = (error: BatchErrorInfo): ItemOutcome => ({ id: item.id, name: item.name, ok: false, error, latencyMs: Date.now() - start });

    // Resolve each parser's input. PDFs are sliced (page 1 → form, artwork pages
    // → label) so the model never sees boilerplate pages. A flat image can't be
    // sliced, so the one image — which shows the whole application — is fed to
    // both parsers verbatim.
    let labelInput: ExtractionInput, formInput: ExtractionInput;
    const mediaType: MediaType = item.mediaType ?? "application/pdf";
    if (mediaType === "application/pdf") {
        // Hard guard: only page 1 (Part I) of the form reaches the model.
        let formBytes: Uint8Array;
        try { formBytes = (await extractFirstPage(item.formPdf)).bytes; }
        catch (e) { return fail({ kind: "extraction", stage: "form", message: `Could not read form PDF: ${msg(e)}`, retryable: false }); }
        // Only the artwork pages — fewer image tokens, lower latency. Never
        // throws; falls back to the whole PDF.
        const labelBytes = (await extractLabelArtwork(item.labelPdf)).bytes;
        formInput = { base64: toBase64(formBytes), mediaType: "application/pdf" };
        labelInput = { base64: toBase64(labelBytes), mediaType: "application/pdf" };
    } else {
        const base64 = toBase64(item.formPdf); // image: label and form bytes are the one image
        formInput = { base64, mediaType };
        labelInput = { base64, mediaType };
    }

    // Parsers are injectable (default: real model-backed). Label and form are
    // independent calls — run concurrently to roughly halve per-item latency,
    // each on its own model (label defaults to a faster tier; see config).
    const label = opts.parsers?.parseLabel ?? parseLabel;
    const form = opts.parsers?.parseForm ?? parseForm;
    const labelModel = opts.labelModel ?? opts.model ?? config.labelModel;
    const formModel = opts.formModel ?? opts.model ?? config.formModel;
    const [labelRes, formRes] = await Promise.allSettled([
        label(labelInput, labelModel),
        form(formInput, formModel),
    ]);

    if (labelRes.status === "rejected") return fail(classifyExtraction(labelRes.reason, "label"));
    if (formRes.status === "rejected") return fail(classifyExtraction(formRes.reason, "form"));

    const { app, appConfidence } = toApplicationData(formRes.value.data);

    let result: VerificationResult;
    try { result = verify(labelRes.value.data, app, appConfidence); }
    catch (e) { return fail({ kind: "matching", stage: "match", message: `Matching failed: ${msg(e)}`, retryable: false }); }

    // Persistence is non-fatal: losing a DB write is bad, but discarding a
    // verdict the agent is already viewing is worse. Log and continue.
    if (opts.persist) {
        try { await opts.persist(result); }
        catch (e) { console.error(`Persist failed for ${item.name}:`, msg(e)); }
    }

    return { id: item.id, name: item.name, ok: true, result, latencyMs: Date.now() - start };
}

/**
 * Map the form extraction into {@link ApplicationData} plus a confidence map.
 *
 * KNOWN GAP: productType (form item 5) selects the entire validation ruleset.
 * When unreadable it currently defaults to "distilledSpirits", which silently
 * picks a profile. For production this should gate to human confirmation
 * rather than guess — flagged here and in the README.
 */
function toApplicationData(form: FormExtraction): {
    app: ApplicationData; appConfidence: Partial<Record<keyof ApplicationData, Confidence>>;
} {
    const app: ApplicationData = {
        serialNumber: form.serialNumber.value ?? "",
        productType: form.productType.value ?? "distilledSpirits", // see KNOWN GAP above
        source: form.source.value ?? "domestic",
        brandName: form.brandName.value ?? "",
        fancifulName: form.fancifulName.value ?? undefined,
        applicantNameAddress: form.applicantNameAddress.value ?? "",
        grapeVarietals: form.grapeVarietals.value ?? undefined,
        wineAppellation: form.wineAppellation.value ?? undefined,
    };
    const appConfidence: Partial<Record<keyof ApplicationData, Confidence>> = {
        brandName: form.brandName.confidence,
        applicantNameAddress: form.applicantNameAddress.confidence,
        wineAppellation: form.wineAppellation.confidence,
    };
    return { app, appConfidence };
}

/** Map an extraction failure to a batch error, marking transient kinds retryable. */
function classifyExtraction(err: unknown, stage: "label" | "form"): BatchErrorInfo {
    if (err instanceof ExtractionError) {
        const retryable = err.kind === "network" || err.kind === "api";
        return { kind: "extraction", stage, message: err.message, retryable };
    }
    return { kind: "unknown", stage, message: msg(err), retryable: false };
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
