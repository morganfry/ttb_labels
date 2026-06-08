import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { indexZipImages, indexImageSources, lookupZipImage, zipHasImage, normalizeZipPath } from "./zipImages";
import { resolveLabelImages, ImageResolveError } from "./imageResolve";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Build a ZIP from a {path: contents} map for testing. */
function zip(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(files)) entries[k] = bytes(v);
    return zipSync(entries);
}

describe("normalizeZipPath", () => {
    it("canonicalizes separators and leading markers", () => {
        expect(normalizeZipPath("\\labels\\a.jpg")).toBe("labels/a.jpg");
        expect(normalizeZipPath("./a.jpg")).toBe("a.jpg");
        expect(normalizeZipPath("/a.jpg")).toBe("a.jpg");
    });
});

describe("indexZipImages", () => {
    it("indexes by full path and by unique basename", () => {
        const idx = indexZipImages(zip({ "front.jpg": "F", "labels/back.png": "B" }));
        expect(zipHasImage(idx, "front.jpg")).toBe(true);
        expect(zipHasImage(idx, "labels/back.png")).toBe(true);
        expect(zipHasImage(idx, "back.png")).toBe(true); // unique basename resolves
        expect(lookupZipImage(idx, "front.jpg")).toEqual(bytes("F"));
    });

    it("requires a full path when a basename is ambiguous", () => {
        const idx = indexZipImages(zip({ "a/logo.png": "A", "b/logo.png": "B" }));
        expect(zipHasImage(idx, "logo.png")).toBe(false);       // ambiguous → not by basename
        expect(lookupZipImage(idx, "a/logo.png")).toEqual(bytes("A"));
        expect(lookupZipImage(idx, "b/logo.png")).toEqual(bytes("B"));
    });

    it("skips archive cruft", () => {
        const idx = indexZipImages(zip({ "front.jpg": "F", "__MACOSX/front.jpg": "junk", ".DS_Store": "junk" }));
        expect(idx.byPath.size).toBe(1);
        expect(zipHasImage(idx, "front.jpg")).toBe(true);
    });

    it("throws on bytes that are not a ZIP", () => {
        expect(() => indexZipImages(bytes("not a zip"))).toThrow();
    });
});

describe("indexImageSources (loose files and ZIPs in one index)", () => {
    it("merges loose image files with ZIP members", () => {
        const idx = indexImageSources([
            { name: "front.jpg", bytes: bytes("F") },
            { zip: zip({ "labels/back.png": "B" }) },
        ]);
        expect(lookupZipImage(idx, "front.jpg")).toEqual(bytes("F"));       // loose file
        expect(lookupZipImage(idx, "labels/back.png")).toEqual(bytes("B")); // zip, by path
        expect(zipHasImage(idx, "back.png")).toBe(true);                    // zip, by unique basename
    });

    it("indexes loose files with no ZIP at all", () => {
        const idx = indexImageSources([
            { name: "a.png", bytes: bytes("A") },
            { name: "b.png", bytes: bytes("B") },
        ]);
        expect(idx.byPath.size).toBe(2);
        expect(lookupZipImage(idx, "b.png")).toEqual(bytes("B"));
    });

    it("counts basename uniqueness across all sources, not within each", () => {
        // The same basename appears in two separate ZIP sources (each in its own
        // folder), so a bare name must be ambiguous across the merged set.
        const idx = indexImageSources([
            { zip: zip({ "a/logo.png": "A" }) },
            { zip: zip({ "b/logo.png": "B" }) },
        ]);
        expect(zipHasImage(idx, "logo.png")).toBe(false);          // ambiguous across sources
        expect(lookupZipImage(idx, "a/logo.png")).toEqual(bytes("A")); // full paths still work
        expect(lookupZipImage(idx, "b/logo.png")).toEqual(bytes("B"));
    });
});

describe("resolveLabelImages (from uploaded images)", () => {
    it("resolves an uploaded file to a model input", async () => {
        const idx = indexZipImages(zip({ "front.png": "PNGDATA" }));
        const inputs = await resolveLabelImages(["front.png"], idx);
        expect(inputs).toHaveLength(1);
        expect(inputs[0].mediaType).toBe("image/png");
        expect(typeof inputs[0].base64).toBe("string");
        expect(inputs[0].base64.length).toBeGreaterThan(0);
    });

    it("rejects a reference when nothing was uploaded", async () => {
        await expect(resolveLabelImages(["front.png"])).rejects.toBeInstanceOf(ImageResolveError);
    });

    it("rejects a reference missing from the uploads", async () => {
        const idx = indexZipImages(zip({ "front.png": "X" }));
        await expect(resolveLabelImages(["back.png"], idx)).rejects.toThrow(/not found among the uploaded images/);
    });
});
