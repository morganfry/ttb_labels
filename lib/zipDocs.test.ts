import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { extractZipDocs } from "./zipDocs";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Build a ZIP from a {path: contents} map for testing. */
function zip(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(files)) entries[k] = bytes(v);
    return zipSync(entries);
}

const BIG = { maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

describe("extractZipDocs", () => {
    it("returns PDF and image entries, by basename, tagged by kind", () => {
        const z = zip({ "a.pdf": "PDF-A", "docs/b.PNG": "PNG-B", "c.jpg": "JPG-C", "notes.txt": "skip me" });
        const { docs, skipped } = extractZipDocs(z, BIG);
        expect(docs.map((d) => `${d.name}:${d.kind}`).sort()).toEqual(["a.pdf:pdf", "b.PNG:image", "c.jpg:image"]);
        expect(skipped).toEqual([]);
        expect(new TextDecoder().decode(docs.find((d) => d.name === "a.pdf")!.bytes)).toBe("PDF-A");
    });

    it("matches extensions case-insensitively", () => {
        const z = zip({ "LOUD.PDF": "x", "SHOUT.JPEG": "y" });
        expect(extractZipDocs(z, BIG).docs.map((d) => d.name).sort()).toEqual(["LOUD.PDF", "SHOUT.JPEG"]);
    });

    it("skips archive cruft and directory entries", () => {
        const z = zip({ "__MACOSX/a.pdf": "junk", ".DS_Store": "junk", "real.png": "ok" });
        expect(extractZipDocs(z, BIG).docs.map((d) => d.name)).toEqual(["real.png"]);
    });

    it("enforces a per-entry decompressed budget", () => {
        const z = zip({ "small.pdf": "ok", "huge.jpg": "X".repeat(5000) });
        const { docs, skipped } = extractZipDocs(z, { maxEntryBytes: 1000, maxTotalBytes: 1_000_000 });
        expect(docs.map((d) => d.name)).toEqual(["small.pdf"]);
        expect(skipped).toEqual(["huge.jpg"]);
    });

    it("enforces a cumulative-total budget", () => {
        const z = zip({ "a.pdf": "X".repeat(600), "b.png": "Y".repeat(600) });
        const { docs, skipped } = extractZipDocs(z, { maxEntryBytes: 1000, maxTotalBytes: 1000 });
        expect(docs.length).toBe(1);          // first fits, second pushes over total
        expect(skipped.length).toBe(1);
    });

    it("returns nothing for an archive with no PDFs or images", () => {
        const z = zip({ "readme.txt": "nope" });
        expect(extractZipDocs(z, BIG).docs).toEqual([]);
    });

    it("throws on non-ZIP bytes", () => {
        expect(() => extractZipDocs(bytes("not a zip"), BIG)).toThrow();
    });
});
