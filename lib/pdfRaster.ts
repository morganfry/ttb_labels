/**
 * Rasterize PDF pages to capped-resolution JPEGs for the vision model.
 *
 * Why: the label models in use cap images at ~1568 px on the long edge — the
 * API downscales anything larger before the model sees it. Shipping a sliced
 * PDF whose embedded scans are far larger than that pays upload time (base64
 * over the wire), server-side rasterization, AND the PDF document block's
 * per-page text-token overhead, all for pixels that get discarded. Rendering
 * the pages ourselves at the cap turns a multi-MB document block into a few
 * hundred KB of image blocks with no accuracy loss.
 *
 * mupdf is WASM (no native deps), ESM-only with top-level await — hence the
 * memoized dynamic import. Rendering is synchronous on the main thread; pages
 * are bounded by maxEdgePx so each pixmap stays a few MB.
 */
import type { ExtractionInput } from "./extraction";

export interface RasterizedPage extends ExtractionInput {
    widthPx: number;
    heightPx: number;
}

export interface RasterizeOptions {
    /** Long-edge pixel cap for each rendered page (the model's native limit). */
    maxEdgePx: number;
    /** JPEG quality (1-100). */
    jpegQuality: number;
    /**
     * Refuse documents with more pages than this (throws; the caller falls
     * back to sending the PDF as-is). Artwork slices are a handful of pages;
     * a huge fallback document is better rasterized server-side than here.
     */
    maxPages: number;
}

type Mupdf = typeof import("mupdf");
let mupdfModule: Promise<Mupdf> | null = null;
/** Memoized so the WASM heap is initialized once per process, not per item. */
function loadMupdf(): Promise<Mupdf> {
    if (!mupdfModule) {
        mupdfModule = import("mupdf").catch((e) => {
            mupdfModule = null; // allow a later retry rather than caching the failure
            throw e;
        });
    }
    return mupdfModule;
}

/**
 * Render every page of `pdfBytes` to a JPEG whose long edge is `maxEdgePx`.
 * Pages are scaled to land exactly on the cap (PDF points render at 72 dpi, so
 * small text-sized pages are UPscaled — that keeps small print legible at the
 * model's native resolution; the cap bounds memory either way).
 *
 * @throws on unparseable input, zero pages, or more than `maxPages` pages —
 * callers treat any throw as "send the original PDF instead" (see processOne).
 */
export async function rasterizePdfToImages(pdfBytes: Uint8Array, opts: RasterizeOptions): Promise<RasterizedPage[]> {
    const mupdf = await loadMupdf();
    const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    try {
        const pageCount = doc.countPages();
        if (pageCount === 0) throw new Error("PDF has no pages to rasterize.");
        if (pageCount > opts.maxPages)
            throw new Error(`PDF has ${pageCount} pages, over the ${opts.maxPages}-page rasterization cap.`);

        const pages: RasterizedPage[] = [];
        for (let i = 0; i < pageCount; i++) {
            const page = doc.loadPage(i);
            try {
                const [x0, y0, x1, y1] = page.getBounds();
                const longEdgePts = Math.max(x1 - x0, y1 - y0);
                if (!(longEdgePts > 0)) throw new Error(`Page ${i + 1} has empty bounds.`);
                const scale = opts.maxEdgePx / longEdgePts;
                const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
                try {
                    const jpeg = pixmap.asJPEG(opts.jpegQuality, false);
                    pages.push({
                        base64: Buffer.from(jpeg).toString("base64"),
                        mediaType: "image/jpeg",
                        widthPx: pixmap.getWidth(),
                        heightPx: pixmap.getHeight(),
                    });
                } finally {
                    pixmap.destroy();
                }
            } finally {
                page.destroy();
            }
        }
        return pages;
    } finally {
        doc.destroy();
    }
}
