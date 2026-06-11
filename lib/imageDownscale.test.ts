import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { downscaleImageInput } from "./imageDownscale";
import { config } from "./config";
import type { ExtractionInput } from "./extraction";

/** Solid-color test image of the given size/format, as an ExtractionInput. */
async function makeImage(width: number, height: number, format: "jpeg" | "png", alpha = false): Promise<ExtractionInput> {
    const base = sharp({
        create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 20, b: 30, alpha: 0.5 } : { r: 10, g: 20, b: 30 } },
    });
    const buf = await (format === "png" ? base.png() : base.jpeg()).toBuffer();
    return { base64: buf.toString("base64"), mediaType: format === "png" ? "image/png" : "image/jpeg" };
}

const dims = async (input: ExtractionInput) => {
    const meta = await sharp(Buffer.from(input.base64, "base64")).metadata();
    return { width: meta.width!, height: meta.height!, format: meta.format };
};

describe("downscaleImageInput", () => {
    it("shrinks an oversized image to the vision cap and re-encodes as JPEG", async () => {
        const input = await makeImage(4000, 2000, "png");
        const out = await downscaleImageInput(input);
        expect(out.mediaType).toBe("image/jpeg");
        const d = await dims(out);
        expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(config.visionMaxEdgePx);
        expect(d.format).toBe("jpeg");
        // Aspect ratio preserved (2:1).
        expect(d.width / d.height).toBeCloseTo(2, 1);
    });

    it("flattens alpha instead of failing on transparent PNGs", async () => {
        const input = await makeImage(3000, 3000, "png", true);
        const out = await downscaleImageInput(input);
        expect(out.mediaType).toBe("image/jpeg");
        expect((await dims(out)).format).toBe("jpeg");
    });

    it("passes a small image through unchanged (format and bytes intact)", async () => {
        const input = await makeImage(800, 600, "png");
        const out = await downscaleImageInput(input);
        expect(out).toBe(input); // same object — no re-encode
    });

    it("passes PDFs and undecodable bytes through unchanged", async () => {
        const pdf: ExtractionInput = { base64: "JVBERi0=", mediaType: "application/pdf" };
        expect(await downscaleImageInput(pdf)).toBe(pdf);
        const junk: ExtractionInput = { base64: Buffer.from("not an image").toString("base64"), mediaType: "image/png" };
        expect(await downscaleImageInput(junk)).toBe(junk);
    });
});
