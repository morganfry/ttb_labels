import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { rasterizePdfToImages } from "./pdfRaster";

const OPTS = { maxEdgePx: 1568, jpegQuality: 85, maxPages: 8 };

/** A PDF with the given page sizes (in points), built with pdf-lib. */
async function makePdf(...pageSizes: Array<[number, number]>): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (const [w, h] of pageSizes) doc.addPage([w, h]);
    return doc.save();
}

/** A one-page PDF with a real text layer. */
async function makeTextPdf(text: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 700, size: 14 });
    return doc.save();
}

const JPEG_SIG = (b64: string) => {
    const bytes = Buffer.from(b64, "base64");
    return [bytes[0], bytes[1]];
};

describe("rasterizePdfToImages", () => {
    it("renders one JPEG per page with the long edge on the cap", async () => {
        const pdf = await makePdf([612, 792], [2000, 1000]);
        const pages = await rasterizePdfToImages(pdf, OPTS);
        expect(pages).toHaveLength(2);
        for (const p of pages) {
            expect(p.mediaType).toBe("image/jpeg");
            expect(JPEG_SIG(p.base64)).toEqual([0xff, 0xd8]);
            // Long edge lands on the cap (±1 px rounding); the short edge keeps
            // the aspect ratio — small pages are upscaled, large ones downscaled.
            expect(Math.max(p.widthPx, p.heightPx)).toBeGreaterThanOrEqual(OPTS.maxEdgePx - 1);
            expect(Math.max(p.widthPx, p.heightPx)).toBeLessThanOrEqual(OPTS.maxEdgePx + 1);
        }
        // Aspect ratios survive: portrait page stays portrait, landscape landscape.
        expect(pages[0].heightPx).toBeGreaterThan(pages[0].widthPx);
        expect(pages[1].widthPx).toBeGreaterThan(pages[1].heightPx);
    });

    it("extracts the text layer when asked, and omits it otherwise", async () => {
        const pdf = await makeTextPdf("SERIAL 24-0001");
        const [withText] = await rasterizePdfToImages(pdf, { ...OPTS, extractText: true });
        expect(withText.text).toContain("SERIAL 24-0001");
        const [without] = await rasterizePdfToImages(pdf, OPTS);
        expect(without.text).toBeUndefined();
    });

    it("returns an empty text layer (not undefined) for a textless page when asked", async () => {
        const pdf = await makePdf([400, 400]);
        const [page] = await rasterizePdfToImages(pdf, { ...OPTS, extractText: true });
        expect(page.text).toBe("");
    });

    it("refuses documents over the page cap (caller falls back to the PDF)", async () => {
        const pdf = await makePdf(...Array.from({ length: 3 }, () => [200, 200] as [number, number]));
        await expect(rasterizePdfToImages(pdf, { ...OPTS, maxPages: 2 })).rejects.toThrow(/page/i);
    });

    it("throws on garbage input rather than returning empty output", async () => {
        await expect(rasterizePdfToImages(new TextEncoder().encode("not a pdf"), OPTS)).rejects.toThrow();
    });
});
