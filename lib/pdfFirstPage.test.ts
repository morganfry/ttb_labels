import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractFirstPage, extractLabelArtwork } from "./pdfFirstPage";

// Smallest valid 1x1 PNG, used to give a page a real image XObject.
const PNG_1x1 = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
    (c) => c.charCodeAt(0),
);

/** Build a PDF of `pageCount` pages; pages whose index is in `imagePages` get a PNG. */
async function makePdf(pageCount: number, imagePages: number[] = []): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const png = await doc.embedPng(PNG_1x1);
    for (let i = 0; i < pageCount; i++) {
        const page = doc.addPage([200, 200]);
        if (imagePages.includes(i)) page.drawImage(png, { x: 10, y: 10, width: 20, height: 20 });
    }
    return doc.save();
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
    return (await PDFDocument.load(bytes)).getPageCount();
}

describe("extractFirstPage", () => {
    it("reduces a multi-page PDF to page 1", async () => {
        const r = await extractFirstPage(await makePdf(4));
        expect(r.originalPageCount).toBe(4);
        expect(await pageCountOf(r.bytes)).toBe(1);
    });
});

describe("extractLabelArtwork", () => {
    it("keeps only the image-bearing pages", async () => {
        const pdf = await makePdf(4, [2, 3]); // artwork on the last two pages
        const r = await extractLabelArtwork(pdf);
        expect(r.sliced).toBe(true);
        expect(r.usedPages).toEqual([2, 3]);
        expect(await pageCountOf(r.bytes)).toBe(2);
    });

    it("never drops a page that has an image (form-page logo rides along)", async () => {
        const pdf = await makePdf(3, [0, 2]); // page 0 is the form but carries a logo
        const r = await extractLabelArtwork(pdf);
        expect(r.usedPages).toEqual([0, 2]);
        expect(await pageCountOf(r.bytes)).toBe(2);
    });

    it("passes a single-page PDF through unchanged", async () => {
        const pdf = await makePdf(1, [0]);
        const r = await extractLabelArtwork(pdf);
        expect(r.sliced).toBe(false);
        expect(r.bytes).toBe(pdf); // same reference — no re-encode
    });

    it("falls back to the whole PDF when no images are detected", async () => {
        const pdf = await makePdf(3, []); // text-only; nothing to slice to
        const r = await extractLabelArtwork(pdf);
        expect(r.sliced).toBe(false);
        expect(r.bytes).toBe(pdf);
    });

    it("passes through when every page has an image (nothing to gain)", async () => {
        const pdf = await makePdf(2, [0, 1]);
        const r = await extractLabelArtwork(pdf);
        expect(r.sliced).toBe(false);
        expect(r.bytes).toBe(pdf);
    });

    it("returns the original bytes on unreadable input rather than throwing", async () => {
        const garbage = new TextEncoder().encode("not a pdf");
        const r = await extractLabelArtwork(garbage);
        expect(r.sliced).toBe(false);
        expect(r.bytes).toBe(garbage);
    });
});
