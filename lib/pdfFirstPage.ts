/**
 * Slices a combined application PDF for extraction:
 *  - {@link extractFirstPage} → page 1 only, for the FORM parser.
 *  - {@link extractLabelArtwork} → only the pages bearing artwork, for the LABEL
 *    parser, so the model doesn't pay to rasterize text-only form pages.
 *
 * extractFirstPage is the HARD guarantee that the model never sees the
 * instruction, certification, or allowable-revisions pages of TTB F 5100.31 —
 * Part I is always page 1. A prompt instruction is a soft constraint; truncating
 * the input is enforceable, so we do both (the form prompt also states its scope).
 */
import { PDFDocument, PDFName, PDFDict, PDFRawStream, type PDFPage } from "pdf-lib";

export interface FirstPageResult {
    bytes: Uint8Array;
    /** Original page count, before slicing — useful for logging/telemetry. */
    originalPageCount: number;
}

/**
 * @returns a single-page PDF (page 1 only) ready to base64-encode.
 * @throws if the PDF has no pages.
 */
export async function extractFirstPage(pdfBytes: Uint8Array): Promise<FirstPageResult> {
    const src = await PDFDocument.load(pdfBytes);
    const originalPageCount = src.getPageCount();
    if (originalPageCount === 0) throw new Error("Uploaded PDF has no pages.");
    return { bytes: await firstPageBytes(src), originalPageCount };
}

/** Page-1-only PDF bytes from an already-loaded document (the form region). */
async function firstPageBytes(src: PDFDocument): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    const [page0] = await out.copyPages(src, [0]);
    out.addPage(page0);
    return out.save();
}

export interface LabelArtworkResult {
    bytes: Uint8Array;
    /** Original page count, before slicing. */
    originalPageCount: number;
    /** 0-based indices of the pages sent to the label parser. */
    usedPages: number[];
    /** True when we sliced to a subset; false when we passed the PDF unchanged. */
    sliced: boolean;
}

/**
 * Reduce a combined PDF to the pages that actually carry label artwork, so the
 * vision model only rasterizes images — not the text-only form/boilerplate
 * pages (which dominate per-call latency for vision). The label artwork is
 * affixed as raster images, so "pages with an image XObject" is the signal.
 *
 * Deliberately conservative — correctness over speed:
 *  - It NEVER drops a page that contains an image, so it can't lose label
 *    content (a logo on the form page just rides along).
 *  - If no image page is found, or every page has one (nothing to gain), it
 *    returns the PDF unchanged — the prior whole-document behavior.
 *  - Any parsing trouble falls back to the original bytes; this optimization
 *    must never break the label read.
 */
export async function extractLabelArtwork(pdfBytes: Uint8Array): Promise<LabelArtworkResult> {
    try {
        const src = await PDFDocument.load(pdfBytes);
        return await labelArtworkBytes(src, pdfBytes, src.getPageCount());
    } catch {
        // Unreadable input — pass the original bytes through (never break the read).
        return { bytes: pdfBytes, originalPageCount: 0, usedPages: [], sliced: false };
    }
}

/**
 * Artwork-pages result from an already-loaded document, conservative with a
 * whole-PDF fallback. Returns the original `pdfBytes` unchanged (same reference)
 * when slicing buys nothing or page detection fails, so it never breaks the
 * label read.
 */
async function labelArtworkBytes(src: PDFDocument, pdfBytes: Uint8Array, pageCount: number): Promise<LabelArtworkResult> {
    const whole = (): LabelArtworkResult => ({
        bytes: pdfBytes, originalPageCount: pageCount,
        usedPages: Array.from({ length: pageCount }, (_, i) => i), sliced: false,
    });
    try {
        if (pageCount <= 1) return whole();

        const imagePages = src.getPages()
            .map((page, i) => (pageHasImage(page) ? i : -1))
            .filter((i) => i >= 0);

        // Nothing detected (vector art, scan we can't read, Form-XObject nesting)
        // → safe fallback. Every page qualifies → slicing buys nothing.
        if (imagePages.length === 0 || imagePages.length === pageCount) return whole();

        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, imagePages);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        return { bytes, originalPageCount: pageCount, usedPages: imagePages, sliced: true };
    } catch {
        return whole();
    }
}

export interface SlicedApplication {
    /** Page-1-only PDF for the form parser. */
    formBytes: Uint8Array;
    /** Artwork-pages result for the label parser (or the whole-PDF fallback). */
    label: LabelArtworkResult;
    originalPageCount: number;
}

/**
 * Slice a combined application PDF for BOTH parsers from a SINGLE parse — the
 * form (page 1) and the label (artwork pages). processOne uses this for PDF
 * items, where the same bytes feed both regions, so parsing once (instead of
 * extractFirstPage + extractLabelArtwork, which each load the PDF) drops a full
 * redundant parse from the per-item critical path. Throws only when the PDF
 * can't be loaded or has no pages — the form region is a hard guarantee; the
 * label region keeps its conservative whole-PDF fallback.
 */
export async function sliceApplicationPdf(pdfBytes: Uint8Array): Promise<SlicedApplication> {
    const src = await PDFDocument.load(pdfBytes);
    const originalPageCount = src.getPageCount();
    if (originalPageCount === 0) throw new Error("Uploaded PDF has no pages.");
    const formBytes = await firstPageBytes(src);
    const label = await labelArtworkBytes(src, pdfBytes, originalPageCount);
    return { formBytes, label, originalPageCount };
}

/** True if the page's resources reference at least one image XObject. */
function pageHasImage(page: PDFPage): boolean {
    try {
        const resources = page.node.Resources();
        if (!resources) return false;
        const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
        if (!xobjects) return false;
        for (const [name] of xobjects.entries()) {
            const xobj = xobjects.lookup(name);
            const dict = xobj instanceof PDFRawStream ? xobj.dict
                : (xobj instanceof PDFDict ? xobj : null);
            const subtype = dict?.lookupMaybe(PDFName.of("Subtype"), PDFName);
            if (subtype?.toString() === "/Image") return true;
        }
        return false;
    } catch {
        return false;
    }
}

/** Base64-encode bytes for the model API. Works in Node and the browser. */
export function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
