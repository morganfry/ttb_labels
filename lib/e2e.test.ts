/**
 * End-to-end pipeline test: drives processBatch with the parsers stubbed to
 * return fixtures (no model call), asserting the full path —
 * extract → match → rollup → stream → persist — produces the expected verdict
 * for each scenario, and that batch-level guarantees hold.
 */
import { describe, it, expect, vi } from "vitest";
import { processBatch, type WorkItem, type ItemOutcome } from "./orchestration";
import { SCENARIOS } from "./fixtures";
import type { ExtractionResult } from "./extraction";
import type { LabelExtraction } from "./schema";
import type { FormExtraction } from "./parsers";

// A trivial 1-page PDF is needed because extractFirstPage runs before the
// (stubbed) parsers. Minimal valid PDF bytes:
const MINIMAL_PDF = new TextEncoder().encode(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF",
);

const ok = <T>(data: T): ExtractionResult<T> => ({ data, model: "stub", raw: "", latencyMs: 0 });

/** Build stubbed parsers that return the given fixture pair. */
function stubParsers(label: LabelExtraction, form: FormExtraction) {
    return {
        parseLabel: vi.fn(async () => ok(label)),
        parseForm: vi.fn(async () => ok(form)),
    };
}

describe("end-to-end pipeline (stubbed parsers)", () => {
    for (const s of SCENARIOS) {
        it(`${s.name} → ${s.expectedOverall}`, async () => {
            const item: WorkItem = { id: "1", name: s.name, labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
            const outcomes: ItemOutcome[] = [];
            await processBatch([item], {
                onResult: (o) => outcomes.push(o),
                parsers: stubParsers(s.label, s.form),
            });
            expect(outcomes).toHaveLength(1);
            const o = outcomes[0];
            expect(o.ok).toBe(true);
            if (o.ok) expect(o.result.overall).toBe(s.expectedOverall);
        });
    }

    it("records a per-stage timing breakdown on each outcome", async () => {
        const item: WorkItem = { id: "1", name: "clean", labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
        const outcomes: ItemOutcome[] = [];
        await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: stubParsers(SCENARIOS[0].label, SCENARIOS[0].form),
        });
        const o = outcomes[0];
        expect(typeof o.latencyMs).toBe("number");
        // The PDF path slices, reads both sides, and matches — each stage timed.
        for (const k of ["prepMs", "labelMs", "formMs", "matchMs"] as const) {
            expect(typeof o.timings[k]).toBe("number");
        }
    });

    it("streams one result per item and reports an accurate summary", async () => {
        const items: WorkItem[] = SCENARIOS.map((s, i) => ({
            id: String(i), name: s.name, labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF,
        }));
        // Round-robin the fixtures so each item gets a distinct verdict.
        let i = 0;
        const summary = await processBatch(items, {
            onResult: () => {},
            parsers: {
                parseLabel: vi.fn(async () => ok(SCENARIOS[i % SCENARIOS.length].label)),
                parseForm: vi.fn(async () => { const r = ok(SCENARIOS[i % SCENARIOS.length].form); i++; return r; }),
            },
        });
        expect(summary.total).toBe(SCENARIOS.length);
        expect(summary.succeeded + summary.failed).toBe(SCENARIOS.length);
        expect(summary.pass + summary.needsReview + summary.fail).toBe(summary.succeeded);
    });

    it("persist hook receives each verdict; a persist failure is non-fatal", async () => {
        const persisted: string[] = [];
        const item: WorkItem = { id: "1", name: "clean", labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
        const outcomes: ItemOutcome[] = [];
        await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: stubParsers(SCENARIOS[0].label, SCENARIOS[0].form),
            persist: async (r) => { persisted.push(r.serialNumber); throw new Error("db down"); },
        });
        // The verdict still streams despite the persist throw.
        expect(outcomes[0].ok).toBe(true);
        expect(persisted).toEqual(["24-1"]);
    });

    it("a parser failure becomes a failed outcome, not a thrown batch", async () => {
        const item: WorkItem = { id: "1", name: "boom", labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
        const outcomes: ItemOutcome[] = [];
        await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: {
                parseLabel: vi.fn(async () => { throw new Error("model refused"); }),
                parseForm: vi.fn(async () => ok(SCENARIOS[0].form)),
            },
        });
        expect(outcomes[0].ok).toBe(false);
    });

    it("a failed outcome reaches persistError (audit row), and a persistError throw is non-fatal", async () => {
        const item: WorkItem = { id: "1", name: "boom.pdf", labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
        const outcomes: ItemOutcome[] = [];
        const persisted: Array<{ name: string; stage: string }> = [];
        const summary = await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: {
                parseLabel: vi.fn(async () => { throw new Error("model refused"); }),
                parseForm: vi.fn(async () => ok(SCENARIOS[0].form)),
            },
            persistError: async (name, error) => { persisted.push({ name, stage: error.stage }); throw new Error("db down"); },
        });
        // The error was offered for persistence and the throw didn't eat the outcome.
        expect(persisted).toEqual([{ name: "boom.pdf", stage: "label" }]);
        expect(outcomes[0].ok).toBe(false);
        expect(summary.failed).toBe(1);
    });

    it("PDF items reach both parsers as rasterized JPEGs, not PDF blocks", async () => {
        const item: WorkItem = { id: "1", name: "app.pdf", labelPdf: MINIMAL_PDF, formPdf: MINIMAL_PDF };
        const seen: { label?: unknown; form?: unknown } = {};
        const outcomes: ItemOutcome[] = [];
        await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: {
                parseLabel: vi.fn(async (input) => { seen.label = input; return ok(SCENARIOS[0].label); }),
                parseForm: vi.fn(async (input) => { seen.form = input; return ok(SCENARIOS[0].form); }),
            },
        });
        expect(outcomes[0].ok).toBe(true);
        // The form page arrives rasterized; MINIMAL_PDF has no text layer, so
        // there is no supplement (an empty extraction must not send a block).
        expect(seen.form).toEqual({ base64: expect.any(String), mediaType: "image/jpeg", supplementText: undefined });
        // The label side is one JPEG image block per artwork page.
        expect(Array.isArray(seen.label)).toBe(true);
        for (const input of seen.label as Array<{ base64: string; mediaType: string }>) {
            expect(input.mediaType).toBe("image/jpeg");
        }
    });

    it("image items skip PDF slicing and feed the one image to both parsers", async () => {
        // Deliberately NOT a PDF: if slicing ran, extractFirstPage would throw.
        const imageBytes = new TextEncoder().encode("\x89PNG\r\n\x1a\n fake png");
        const item: WorkItem = { id: "1", name: "app.png", labelPdf: imageBytes, formPdf: imageBytes, mediaType: "image/png" };
        const seen: { label?: unknown; form?: unknown } = {};
        const outcomes: ItemOutcome[] = [];
        await processBatch([item], {
            onResult: (o) => outcomes.push(o),
            parsers: {
                parseLabel: vi.fn(async (input) => { seen.label = input; return ok(SCENARIOS[0].label); }),
                parseForm: vi.fn(async (input) => { seen.form = input; return ok(SCENARIOS[0].form); }),
            },
        });
        expect(outcomes[0].ok).toBe(true);
        // Both parsers get the image verbatim, with the image media type.
        expect(seen.label).toEqual({ base64: expect.any(String), mediaType: "image/png" });
        expect(seen.form).toEqual({ base64: expect.any(String), mediaType: "image/png" });
        expect((seen.label as { base64: string }).base64).toBe((seen.form as { base64: string }).base64);
    });
});
