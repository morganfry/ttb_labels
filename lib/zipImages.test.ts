import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { indexZipImages, lookupZipImage, zipHasImage, normalizeZipPath } from "./zipImages";
import { resolveLabelImages, ImageFetchError } from "./imageFetch";

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

describe("resolveLabelImages (local references)", () => {
    it("resolves a local file from the ZIP to a model input", async () => {
        const idx = indexZipImages(zip({ "front.png": "PNGDATA" }));
        const inputs = await resolveLabelImages(["front.png"], idx);
        expect(inputs).toHaveLength(1);
        expect(inputs[0].mediaType).toBe("image/png");
        expect(typeof inputs[0].base64).toBe("string");
        expect(inputs[0].base64.length).toBeGreaterThan(0);
    });

    it("rejects a local reference when no ZIP was provided", async () => {
        await expect(resolveLabelImages(["front.png"])).rejects.toBeInstanceOf(ImageFetchError);
    });

    it("rejects a local reference missing from the ZIP", async () => {
        const idx = indexZipImages(zip({ "front.png": "X" }));
        await expect(resolveLabelImages(["back.png"], idx)).rejects.toThrow(/not found in the uploaded ZIP/);
    });
});
