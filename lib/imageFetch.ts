/**
 * Fetch label images by URL and turn them into {@link ExtractionInput}s for
 * the vision model. Used only by the CSV bulk path, where the label artwork is
 * referenced by URL rather than uploaded.
 *
 * Bounds (size, timeout) come from config so a single hostile or oversized URL
 * can't stall or balloon a batch. A lightweight SSRF guard rejects non-public
 * targets; note it is best-effort (no DNS-rebinding defense) and a production
 * deployment should front this with an allow-list or egress proxy.
 */
import { config } from "./config";
import type { ExtractionInput, MediaType } from "./extraction";
import { imageMediaType, IMAGE_MEDIA_TYPES } from "./mediaType";
import { lookupZipImage, type ZipImageIndex } from "./zipImages";

const ALLOWED_MEDIA = IMAGE_MEDIA_TYPES;

/** Raised for any fetch/validation failure; the orchestrator classifies it. */
export class ImageFetchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImageFetchError";
    }
}

/**
 * Resolve every image reference for one label, in order, into model inputs.
 * Each reference is either an http(s) URL (fetched) or a file name inside the
 * uploaded ZIP (read from memory). csvParse has already classified them; this
 * just dispatches and applies the same size/type bounds to both sources.
 */
export function resolveLabelImages(refs: string[], zip?: ZipImageIndex): Promise<ExtractionInput[]> {
    return Promise.all(refs.map((ref) => resolveOne(ref, zip)));
}

async function resolveOne(ref: string, zip?: ZipImageIndex): Promise<ExtractionInput> {
    if (/^https?:\/\//i.test(ref)) return fetchImage(ref);
    // Local reference: must come from the uploaded images (a ZIP or loose files).
    if (!zip) throw new ImageFetchError(`"${ref}" refers to a local image file, but no images were uploaded.`);
    const bytes = lookupZipImage(zip, ref);
    if (!bytes) throw new ImageFetchError(`Image not found among the uploaded images: ${ref}`);
    const mediaType = resolveMediaType(null, ref);
    if (!mediaType) throw new ImageFetchError(`Unsupported image type for ${ref} (allowed: ${ALLOWED_MEDIA.join(", ")}).`);
    if (bytes.byteLength === 0) throw new ImageFetchError(`Image is empty: ${ref}`);
    if (bytes.byteLength > config.csvImageMaxBytes) throw new ImageFetchError(`Image exceeds ${config.csvImageMaxBytes} bytes: ${ref}`);
    return { base64: toBase64(bytes), mediaType };
}

async function fetchImage(url: string): Promise<ExtractionInput> {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new ImageFetchError(`Invalid image URL: ${url}`); }
    assertSafeUrl(parsed);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.csvImageFetchTimeoutMs);
    let res: Response;
    try {
        res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        throw new ImageFetchError(aborted ? `Timed out fetching image: ${url}` : `Could not fetch image: ${url} (${msg(e)})`);
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) throw new ImageFetchError(`Image URL returned ${res.status}: ${url}`);

    const mediaType = resolveMediaType(res.headers.get("content-type"), parsed.pathname);
    if (!mediaType) {
        throw new ImageFetchError(`Unsupported image type for ${url} (allowed: ${ALLOWED_MEDIA.join(", ")}).`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new ImageFetchError(`Image is empty: ${url}`);
    if (buf.byteLength > config.csvImageMaxBytes) {
        throw new ImageFetchError(`Image exceeds ${config.csvImageMaxBytes} bytes: ${url}`);
    }

    return { base64: toBase64(buf), mediaType };
}

/** Prefer the served content-type; fall back to the file extension. */
function resolveMediaType(contentType: string | null, pathname: string): MediaType | null {
    const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (ALLOWED_MEDIA.includes(ct as MediaType)) return ct as MediaType;
    if (ct === "image/jpg") return "image/jpeg";
    return imageMediaType(pathname);
}

/**
 * Best-effort SSRF guard: only http(s), and reject obvious internal targets
 * (loopback, link-local, RFC-1918, and bare hostnames). Not a substitute for a
 * network egress policy.
 */
function assertSafeUrl(u: URL): void {
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new ImageFetchError(`Image URL must use http(s): ${u.href}`);
    }
    const host = u.hostname.toLowerCase();
    if (
        host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
        throw new ImageFetchError(`Refusing to fetch a non-public address: ${host}`);
    }
}

function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
