/**
 * Builds an in-memory index of label images for the CSV bulk path. A CSV cell
 * names an image the agent uploads; the app resolves it from this index and
 * never fetches anything over the network — so artwork can be bulk-verified
 * without hosting it anywhere, and there is no outbound/SSRF surface.
 *
 * The images arrive as one of two transports — a ZIP archive, or individually
 * added image files — but converge on ONE index ({@link indexImageSources}), so
 * the per-row resolve (imageResolve.ts) and the client preview behave identically
 * regardless of how the images were uploaded. A ZIP is just bulk transport.
 *
 * Pure and framework-free so it runs both server-side (resolve real bytes) and
 * client-side (pre-flight: confirm every referenced file is present before the
 * run). Bytes live only in memory for the request — nothing is persisted, the
 * same retention stance as the rest of the pipeline.
 *
 * Zip-bomb guard: pass a {@link ZipBudget} and ZIP entries are filtered by their
 * declared uncompressed size BEFORE expansion (per-entry and cumulative), so a
 * crafted archive can't balloon RAM — parity with zipDocs.ts. (Loose image files
 * don't decompress, so they carry no such risk; they're bounded by the upload cap.)
 */
import { unzipSync } from "fflate";
import { isImageName } from "./mediaType";

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
 * Decompressed-size budget for ZIP sources (the zip-bomb guard). Without one,
 * unzipSync expands the whole archive into memory; with one, an entry is rejected
 * by its DECLARED uncompressed size before expansion. Production callers always
 * pass this; the bare {@link indexZipImages} test wrapper omits it.
 */
export interface ZipBudget {
    /** Skip (never decompress) any single entry whose decompressed size exceeds this. */
    maxEntryBytes: number;
    /** Stop accepting entries once cumulative decompressed bytes would exceed this. */
    maxTotalBytes: number;
}

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
 *
 * When `budget` is given, ZIP entries are filtered against it (and to image
 * names) BEFORE decompression, so a crafted archive can't balloon memory.
 */
export function indexImageSources(sources: readonly RawImageSource[], budget?: ZipBudget): ZipImageIndex {
    const byPath = new Map<string, Uint8Array>();
    const pathCount = new Map<string, number>();
    const baseCount = new Map<string, number>();
    const baseFirst = new Map<string, Uint8Array>();

    const add = (rawPath: string, data: Uint8Array) => {
        if (rawPath.endsWith("/")) return; // directory entry
        if (ZIP_JUNK_RE.test(rawPath)) return; // archive cruft
        const path = normalizeZipPath(rawPath);
        if (path === "") return;
        // Never index a traversal-style path. Resolution is in-memory only (no fs
        // access), so this can't be exploited — but it keeps the index free of
        // ".." keys rather than relying on csvParse's ref validation alone.
        if (path.split("/").includes("..")) return;
        pathCount.set(path, (pathCount.get(path) ?? 0) + 1);
        byPath.set(path, data);
        const base = path.split("/").pop()!;
        baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
        if (!baseFirst.has(base)) baseFirst.set(base, data);
    };

    let total = 0; // running decompressed bytes across all ZIP sources (budget guard)
    for (const src of sources) {
        if ("zip" in src) {
            const files = budget
                ? unzipSync(src.zip, {
                    // Reject by central-directory metadata BEFORE decompressing.
                    filter: ({ name, originalSize }) => {
                        if (name.endsWith("/") || ZIP_JUNK_RE.test(name) || !isImageName(name)) return false;
                        if (originalSize > budget.maxEntryBytes || total + originalSize > budget.maxTotalBytes) return false;
                        total += originalSize;
                        return true;
                    },
                })
                : unzipSync(src.zip);
            for (const [rawPath, data] of Object.entries(files)) add(rawPath, data);
        } else {
            add(src.name, src.bytes);
        }
    }

    // A full path supplied by two sources (e.g. a loose "a.png" and a ZIP entry
    // "a.png") is ambiguous: drop it rather than silently resolving to whichever
    // was added last. The ref then reads as "not found" so the user disambiguates.
    for (const [path, count] of pathCount) {
        if (count > 1) byPath.delete(path);
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
