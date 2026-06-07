import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { extractZipPdfs } from "./zipPdfs";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Build a ZIP from a {path: contents} map for testing. */
function zip(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(files)) entries[k] = bytes(v);
    return zipSync(entries);
}

const BIG = { maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

describe("extractZipPdfs", () => {
    it("returns only PDF entries, by basename", () => {
        const z = zip({ "a.pdf": "PDF-A", "docs/b.pdf": "PDF-B", "notes.txt": "skip me" });
        const { pdfs, skipped } = extractZipPdfs(z, BIG);
        expect(pdfs.map((p) => p.name).sort()).toEqual(["a.pdf", "b.pdf"]);
        expect(skipped).toEqual([]);
        expect(new TextDecoder().decode(pdfs.find((p) => p.name === "a.pdf")!.bytes)).toBe("PDF-A");
    });

    it("matches .pdf case-insensitively", () => {
        const z = zip({ "LOUD.PDF": "x" });
        expect(extractZipPdfs(z, BIG).pdfs.map((p) => p.name)).toEqual(["LOUD.PDF"]);
    });

    it("skips archive cruft and directory entries", () => {
        const z = zip({ "__MACOSX/a.pdf": "junk", ".DS_Store": "junk", "real.pdf": "ok" });
        expect(extractZipPdfs(z, BIG).pdfs.map((p) => p.name)).toEqual(["real.pdf"]);
    });

    it("enforces a per-entry decompressed budget", () => {
        const z = zip({ "small.pdf": "ok", "huge.pdf": "X".repeat(5000) });
        const { pdfs, skipped } = extractZipPdfs(z, { maxEntryBytes: 1000, maxTotalBytes: 1_000_000 });
        expect(pdfs.map((p) => p.name)).toEqual(["small.pdf"]);
        expect(skipped).toEqual(["huge.pdf"]);
    });

    it("enforces a cumulative-total budget", () => {
        const z = zip({ "a.pdf": "X".repeat(600), "b.pdf": "Y".repeat(600) });
        const { pdfs, skipped } = extractZipPdfs(z, { maxEntryBytes: 1000, maxTotalBytes: 1000 });
        expect(pdfs.length).toBe(1);          // first fits, second pushes over total
        expect(skipped.length).toBe(1);
    });

    it("returns no PDFs for an archive without any", () => {
        const z = zip({ "readme.txt": "nope" });
        expect(extractZipPdfs(z, BIG).pdfs).toEqual([]);
    });

    it("throws on non-ZIP bytes", () => {
        expect(() => extractZipPdfs(bytes("not a zip"), BIG)).toThrow();
    });
});
