/**
 * Expands a dropped ZIP of applications in the browser, for the PDF/image upload
 * tab. Each entry — a combined-application PDF or a flat image (JPG/PNG/…) of an
 * application — becomes an ordinary work item that flows through the SAME detect
 * → verify pipeline as a directly-uploaded file. The ZIP is a transport
 * convenience, never a second code path.
 *
 * Unlike the CSV image ZIP (zipImages.ts), this enforces a REAL decompressed
 * budget: fflate's filter runs against each entry's central-directory metadata
 * BEFORE decompression, so an oversized or over-budget entry (a zip bomb) is
 * skipped without ever being expanded into memory. Per fflate, `originalSize` is
 * the uncompressed size and `size` is the compressed size.
 *
 * Pure and framework-free so it can be unit-tested; the component wraps the
 * returned bytes into File objects.
 */
import { unzipSync } from "fflate";
import { ZIP_JUNK_RE, normalizeZipPath } from "./zipImages";
import { isPdfName, isImageName } from "./mediaType";

export interface ExtractedDoc {
    /** Basename within the archive, used as the work item's display name. */
    name: string;
    bytes: Uint8Array;
    /** Drives how the orchestrator handles it: PDFs are sliced, images are not. */
    kind: "pdf" | "image";
}

export interface ExtractZipDocsOptions {
    /** Skip any single entry whose decompressed size exceeds this. */
    maxEntryBytes: number;
    /** Stop accepting entries once cumulative decompressed bytes would exceed this. */
    maxTotalBytes: number;
}

export interface ZipDocsResult {
    docs: ExtractedDoc[];
    /** Entry paths skipped for exceeding a size budget — surfaced to the user. */
    skipped: string[];
}

/** Extract the PDF and image entries from raw ZIP bytes. Throws if not a ZIP. */
export function extractZipDocs(bytes: Uint8Array, opts: ExtractZipDocsOptions): ZipDocsResult {
    const skipped: string[] = [];
    let total = 0;
    const files = unzipSync(bytes, {
        filter: ({ name, originalSize }) => {
            if (name.endsWith("/")) return false;                       // directory entry
            if (ZIP_JUNK_RE.test(name)) return false;                   // archive cruft
            if (!isPdfName(name) && !isImageName(name)) return false;    // PDFs and images only
            // Reject before decompressing: a single huge entry, or one that
            // would push the running total over budget.
            if (originalSize > opts.maxEntryBytes || total + originalSize > opts.maxTotalBytes) {
                skipped.push(normalizeZipPath(name));
                return false;
            }
            total += originalSize;
            return true;
        },
    });

    const docs: ExtractedDoc[] = [];
    for (const [rawPath, data] of Object.entries(files)) {
        const path = normalizeZipPath(rawPath);
        if (!path) continue;
        const base = path.split("/").pop()!;
        docs.push({ name: base, bytes: data, kind: isPdfName(base) ? "pdf" : "image" });
    }
    return { docs, skipped };
}
