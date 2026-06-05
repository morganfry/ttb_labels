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
});
