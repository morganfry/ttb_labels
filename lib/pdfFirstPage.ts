/**
 * Slices a combined application PDF down to page 1 before form extraction.
 *
 * This is the HARD guarantee that the model never sees the instruction,
 * certification, or allowable-revisions pages of TTB F 5100.31 — Part I is
 * always page 1. A prompt instruction is a soft constraint; truncating the
 * input is enforceable, so we do both (the form prompt also states its scope).
 */
import { PDFDocument } from "pdf-lib";

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

/** Base64-encode bytes for the model API. Works in Node and the browser. */
export function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
