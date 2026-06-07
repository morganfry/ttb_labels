/**
 * Reads an uploaded ZIP of label images into an in-memory index for the CSV
 * bulk path. This is the local-file alternative to fetching images by URL: a
 * CSV cell can name a file inside the ZIP instead of a public URL, so agents
 * can bulk-verify artwork they have on disk without hosting it anywhere (and
 * without relaxing the URL-fetch SSRF guard).
 *
 * Pure and framework-free so it runs both server-side (resolve real bytes) and
 * client-side (pre-flight: confirm every referenced file is present before the
 * run). Bytes live only in memory for the request — nothing is persisted, the
 * same retention stance as the rest of the pipeline.
 *
 * Caveat: unzipSync decompresses the whole archive into memory, so a crafted
 * "zip bomb" could balloon RAM. The route caps the uploaded archive size as a
 * blunt mitigation; a production system should stream-extract with a hard
 * decompressed-size budget.
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
 *  ZIP path (zipPdfs.ts) so both intakes skip the same junk. */
export const ZIP_JUNK_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i;

/** Canonicalize a path or CSV reference: backslashes → "/", drop "./" and any
 *  leading slashes. (Traversal like ".." is rejected earlier, in csvParse.) */
export function normalizeZipPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Build the lookup index from raw ZIP bytes. Throws if the bytes aren't a ZIP. */
export function indexZipImages(bytes: Uint8Array): ZipImageIndex {
    const files = unzipSync(bytes);
    const byPath = new Map<string, Uint8Array>();
    const baseCount = new Map<string, number>();
    const baseFirst = new Map<string, Uint8Array>();

    for (const [rawPath, data] of Object.entries(files)) {
        if (rawPath.endsWith("/")) continue; // directory entry
        if (ZIP_JUNK_RE.test(rawPath)) continue; // archive cruft
        const path = normalizeZipPath(rawPath);
        if (path === "") continue;
        byPath.set(path, data);
        const base = path.split("/").pop()!;
        baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
        if (!baseFirst.has(base)) baseFirst.set(base, data);
    }

    const byBase = new Map<string, Uint8Array>();
    for (const [base, count] of baseCount) {
        if (count === 1) byBase.set(base, baseFirst.get(base)!);
    }
    return { byPath, byBase };
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
