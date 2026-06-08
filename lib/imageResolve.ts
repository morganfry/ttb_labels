/**
 * Resolve a CSV row's label-image references into {@link ExtractionInput}s for
 * the vision model. Every reference is the name of an image the agent uploaded
 * alongside the CSV (loose files and/or a ZIP), read from the in-memory index
 * (zipImages.ts). The app never fetches anything over the network — there is no
 * outbound request and so no SSRF surface, a deliberate choice for a locked-down
 * deployment. Per-image size and type bounds still apply.
 */
import { config } from "./config";
import type { ExtractionInput } from "./extraction";
import { imageMediaType, IMAGE_MEDIA_TYPES } from "./mediaType";
import { lookupZipImage, type ZipImageIndex } from "./zipImages";

const ALLOWED_MEDIA = IMAGE_MEDIA_TYPES;

/** Raised when a reference can't be resolved to a usable image; the orchestrator
 *  classifies it. */
export class ImageResolveError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImageResolveError";
    }
}

/**
 * Resolve every image reference for one label, in order, into model inputs.
 * `images` is the in-memory index of everything the agent uploaded; a reference
 * that isn't present (or isn't a usable image type/size) fails the row.
 */
export async function resolveLabelImages(refs: string[], images?: ZipImageIndex): Promise<ExtractionInput[]> {
    return refs.map((ref) => resolveOne(ref, images));
}

function resolveOne(ref: string, images?: ZipImageIndex): ExtractionInput {
    if (!images) throw new ImageResolveError(`"${ref}" needs an uploaded image, but none were uploaded.`);
    const bytes = lookupZipImage(images, ref);
    if (!bytes) throw new ImageResolveError(`Image not found among the uploaded images: ${ref}`);
    const mediaType = imageMediaType(ref);
    if (!mediaType) throw new ImageResolveError(`Unsupported image type for ${ref} (allowed: ${ALLOWED_MEDIA.join(", ")}).`);
    if (bytes.byteLength === 0) throw new ImageResolveError(`Image is empty: ${ref}`);
    if (bytes.byteLength > config.csvImageMaxBytes) throw new ImageResolveError(`Image exceeds ${config.csvImageMaxBytes} bytes: ${ref}`);
    return { base64: toBase64(bytes), mediaType };
}

function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
