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

    const out = await PDFDocument.create();
    const [page0] = await out.copyPages(src, [0]);
    out.addPage(page0);
    const bytes = await out.save();
    return { bytes, originalPageCount };
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
    const whole = (originalPageCount: number): LabelArtworkResult => ({
        bytes: pdfBytes, originalPageCount,
        usedPages: Array.from({ length: originalPageCount }, (_, i) => i), sliced: false,
    });
    try {
        const src = await PDFDocument.load(pdfBytes);
        const pageCount = src.getPageCount();
        if (pageCount <= 1) return whole(pageCount);

        const imagePages = src.getPages()
            .map((page, i) => (pageHasImage(page) ? i : -1))
            .filter((i) => i >= 0);

        // Nothing detected (vector art, scan we can't read, Form-XObject nesting)
        // → safe fallback. Every page qualifies → slicing buys nothing.
        if (imagePages.length === 0 || imagePages.length === pageCount) return whole(pageCount);

        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, imagePages);
        copied.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        return { bytes, originalPageCount: pageCount, usedPages: imagePages, sliced: true };
    } catch {
        return whole(0);
    }
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
