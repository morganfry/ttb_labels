/**
 * Server-side downscaling of flat label/application images before the model
 * call — the raster-image counterpart of pdfRaster.ts, at the same layer.
 *
 * Why server-side (not in the browser): one choke point covers every image
 * intake — the upload tab's flat images, CSV loose images, AND images inside
 * the CSV ZIP (which the client could not touch without rebuilding the
 * archive) — and it holds for any client, not just our UI. The model API caps
 * images at config.visionMaxEdgePx anyway, so pixels beyond that only cost
 * payload bytes; and its 10 MB-per-image (base64) limit stops being an intake
 * concern because oversized images are shrunk here rather than rejected.
 *
 * Never breaks a read: any decode/encode failure returns the input unchanged.
 */
import sharp from "sharp";
import { config } from "./config";
import type { ExtractionInput } from "./extraction";

/** Within the edge cap and under this size, re-encoding buys ~nothing — pass
 *  the original through untouched (also keeps small PNGs lossless). */
const PASSTHROUGH_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Downscale one model input to the vision cap, re-encoding as JPEG. PDFs and
 * already-small images pass through unchanged; so does anything that fails to
 * decode (the model call is the judge of unusable bytes, not this step).
 */
export async function downscaleImageInput(input: ExtractionInput): Promise<ExtractionInput> {
    if (input.mediaType === "application/pdf") return input;
    try {
        const bytes = Buffer.from(input.base64, "base64");
        const meta = await sharp(bytes).metadata();
        const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
        if (longEdge === 0) return input;
        if (longEdge <= config.visionMaxEdgePx && bytes.byteLength <= PASSTHROUGH_MAX_BYTES) return input;
        const out = await sharp(bytes)
            .resize({
                width: config.visionMaxEdgePx,
                height: config.visionMaxEdgePx,
                fit: "inside",
                withoutEnlargement: true, // upscaling a raster buys no fidelity, unlike PDF text
            })
            // JPEG has no alpha; composite on white (default is black, which can
            // swallow dark label text on transparent backgrounds).
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: config.rasterJpegQuality })
            .toBuffer();
        if (out.byteLength >= bytes.byteLength) return input; // re-encode made it bigger — keep original
        return { base64: out.toString("base64"), mediaType: "image/jpeg" };
    } catch (e) {
        console.warn(`Image downscale skipped (${e instanceof Error ? e.message : String(e)}); sending original.`);
        return input;
    }
}

/** Downscale a set of inputs (e.g. one CSV row's label views), concurrently. */
export function downscaleImageInputs(inputs: ExtractionInput[]): Promise<ExtractionInput[]> {
    return Promise.all(inputs.map(downscaleImageInput));
}
