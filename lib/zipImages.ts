/**
 * Builds an in-memory index of label images for the CSV bulk path. This is the
 * local-file alternative to fetching images by URL: a CSV cell can name an image
 * the agent uploads instead of a public URL, so artwork on disk can be
 * bulk-verified without hosting it anywhere (and without relaxing the URL-fetch
 * SSRF guard).
 *
 * The images arrive as one of two transports — a ZIP archive, or individually
 * added image files — but converge on ONE index ({@link indexImageSources}), so
 * the per-row resolve (imageFetch.ts) and the client preview behave identically
 * regardless of how the images were uploaded. A ZIP is just bulk transport.
 *
 * Pure and framework-free so it runs both server-side (resolve real bytes) and
 * client-side (pre-flight: confirm every referenced file is present before the
 * run). Bytes live only in memory for the request — nothing is persisted, the
 * same retention stance as the rest of the pipeline.
 *
 * Caveat: unzipSync decompresses the whole archive into memory, so a crafted
 * "zip bomb" could balloon RAM. The route caps the uploaded image bytes as a
 * blunt mitigation; a production system should stream-extract with a hard
 * decompressed-size budget. (Loose image files don't decompress, so they carry
 * no such risk.)
 */
import { unzipSync } from "fflate";

export interface ZipImageIndex {
    /** Normalized full path within the archive → file bytes. */
    byPath: Map<string, Uint8Array>;
    /** Basename → bytes, but only for basenames unique across the archive, so a
     *  bare filename reference is unambiguous (collisions require a full path). */
    byBase: Map<string, Uint8Array>;
}

/** Archive cruft some zip tools add; never a real entry. Shared with the PDF
 *  ZIP path (zipDocs.ts) so both intakes skip the same junk. */
export const ZIP_JUNK_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i;

/** Canonicalize a path or CSV reference: backslashes → "/", drop "./" and any
 *  leading slashes. (Traversal like ".." is rejected earlier, in csvParse.) */
export function normalizeZipPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * One label-image source: a ZIP to expand, or a single named image file. Both
 * the client (collecting dropped files) and the server (reading upload parts)
 * describe their inputs as a list of these, then build one index from them.
 */
export type RawImageSource =
    | { zip: Uint8Array }
    | { name: string; bytes: Uint8Array };

/**
 * Build one index from any mix of sources — ZIP archives (expanded) and/or
 * individually added image files. This is the single convergence point that
 * keeps "an image is an image" true no matter the transport. Throws only if a
 * ZIP source can't be parsed (a loose file can't fail to "unzip"), so a caller
 * that catches can attribute the failure to a bad archive.
 *
 * Basename uniqueness (for bare-name references) is computed across the whole
 * merged set, so a name unique within one ZIP but colliding with a loose file
 * is correctly treated as ambiguous — the safe behavior.
 */
export function indexImageSources(sources: readonly RawImageSource[]): ZipImageIndex {
    const byPath = new Map<string, Uint8Array>();
    const baseCount = new Map<string, number>();
    const baseFirst = new Map<string, Uint8Array>();

    const add = (rawPath: string, data: Uint8Array) => {
        if (rawPath.endsWith("/")) return; // directory entry
        if (ZIP_JUNK_RE.test(rawPath)) return; // archive cruft
        const path = normalizeZipPath(rawPath);
        if (path === "") return;
        byPath.set(path, data);
        const base = path.split("/").pop()!;
        baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
        if (!baseFirst.has(base)) baseFirst.set(base, data);
    };

    for (const src of sources) {
        if ("zip" in src) {
            for (const [rawPath, data] of Object.entries(unzipSync(src.zip))) add(rawPath, data);
        } else {
            add(src.name, src.bytes);
        }
    }

    const byBase = new Map<string, Uint8Array>();
    for (const [base, count] of baseCount) {
        if (count === 1) byBase.set(base, baseFirst.get(base)!);
    }
    return { byPath, byBase };
}

/** Build the lookup index from raw ZIP bytes. Throws if the bytes aren't a ZIP.
 *  A thin wrapper over {@link indexImageSources} for the single-ZIP case. */
export function indexZipImages(bytes: Uint8Array): ZipImageIndex {
    return indexImageSources([{ zip: bytes }]);
}

/** Resolve a CSV reference to bytes: exact path first, then unique basename. */
export function lookupZipImage(index: ZipImageIndex, ref: string): Uint8Array | undefined {
    const norm = normalizeZipPath(ref);
    return index.byPath.get(norm) ?? index.byBase.get(norm.split("/").pop()!);
}

/** True if the reference resolves to a file in the archive. */
export function zipHasImage(index: ZipImageIndex, ref: string): boolean {
    return lookupZipImage(index, ref) !== undefined;
}
