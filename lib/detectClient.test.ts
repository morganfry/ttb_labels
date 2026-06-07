import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfSignals } from "./detectClient";
import { evaluateRegions } from "./detectionRules";

// Smallest valid 1x1 PNG, used to give a page a real image XObject.
const PNG_1x1 = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
    (c) => c.charCodeAt(0),
);

/** Build a one-page PDF with the given text lines and (optionally) an image. */
async function makePdf(text: string[], withImage: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 600]);
    let y = 560;
    for (const line of text) { page.drawText(line, { x: 20, y, size: 12, font }); y -= 20; }
    if (withImage) {
        const png = await doc.embedPng(PNG_1x1);
        page.drawImage(png, { x: 20, y: 20, width: 40, height: 40 });
    }
    return doc.save();
}

describe("extractPdfSignals + evaluateRegions", () => {
    // The bug: markers and images lived in compressed streams, so a byte scan
    // found neither and EVERY document got both false flags. Parsing fixes it.
    it("does not raise the always-on false positives on a COLA-like PDF", async () => {
        const pdf = await makePdf(["TTB F 5100.31", "BRAND NAME", "SERIAL NUMBER"], true);
        const sig = await extractPdfSignals(pdf);
        expect(sig.imageCount).toBeGreaterThanOrEqual(1);
        expect(sig.hasTextLayer).toBe(true);

        const r = evaluateRegions(sig);
        expect(r.hasForm).toBe(true);
        expect(r.hasLabel).toBe(true);
        expect(r.status).toBe("ready");
        expect(r.notes.join(" ")).not.toMatch(/Could not find COLA form markers/);
        expect(r.notes.join(" ")).not.toMatch(/No affixed label artwork/);
    });

    it("flags a non-COLA document (text present, no markers, no image)", async () => {
        const pdf = await makePdf(["Acme Invoice", "Total due", "Thank you"], false);
        const r = evaluateRegions(await extractPdfSignals(pdf));
        expect(r.status).toBe("review");
        expect(r.notes.some((n) => /Could not find COLA form markers/.test(n))).toBe(true);
        expect(r.notes.some((n) => /No affixed label artwork/.test(n))).toBe(true);
    });

    it("treats an image-only (scanned) form as low-confidence, not a hard miss", async () => {
        const pdf = await makePdf([], true);
        const sig = await extractPdfSignals(pdf);
        expect(sig.hasTextLayer).toBe(false);
        expect(sig.imageCount).toBeGreaterThanOrEqual(1);

        const r = evaluateRegions(sig);
        expect(r.hasLabel).toBe(true);
        expect(r.formConfidence).toBe("low");
        expect(r.status).toBe("review");
        expect(r.notes.some((n) => /scanned/.test(n))).toBe(true);
    });

    it("needs at least two markers — a single stray match is not a form", async () => {
        const pdf = await makePdf(["Net contents 750 mL on this random flyer"], true);
        const sig = await extractPdfSignals(pdf);
        const r = evaluateRegions(sig);
        // "NET CONTENTS" is one hit; one is not enough.
        expect(r.hasForm).toBe(false);
        expect(r.status).toBe("review");
    });
});
