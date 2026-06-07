/**
 * Expands a dropped ZIP of combined-application PDFs in the browser, for the PDF
 * upload tab. Each PDF entry becomes an ordinary work item that flows through
 * the SAME detect → verify pipeline as a directly-uploaded PDF — the ZIP is a
 * transport convenience, never a second code path.
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

export interface ExtractedPdf {
    /** Basename within the archive, used as the work item's display name. */
    name: string;
    bytes: Uint8Array;
}

export interface ExtractZipPdfsOptions {
    /** Skip any single entry whose decompressed size exceeds this. */
    maxEntryBytes: number;
    /** Stop accepting entries once cumulative decompressed bytes would exceed this. */
    maxTotalBytes: number;
}

export interface ZipPdfsResult {
    pdfs: ExtractedPdf[];
    /** Entry paths skipped for exceeding a size budget — surfaced to the user. */
    skipped: string[];
}

const isPdfPath = (p: string) => /\.pdf$/i.test(p);

/** Extract the PDF entries from raw ZIP bytes. Throws if the bytes aren't a ZIP. */
export function extractZipPdfs(bytes: Uint8Array, opts: ExtractZipPdfsOptions): ZipPdfsResult {
    const skipped: string[] = [];
    let total = 0;
    const files = unzipSync(bytes, {
        filter: ({ name, originalSize }) => {
            if (name.endsWith("/")) return false;        // directory entry
            if (ZIP_JUNK_RE.test(name)) return false;    // archive cruft
            if (!isPdfPath(name)) return false;          // PDFs only
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

    const pdfs: ExtractedPdf[] = [];
    for (const [rawPath, data] of Object.entries(files)) {
        const path = normalizeZipPath(rawPath);
        if (path) pdfs.push({ name: path.split("/").pop()!, bytes: data });
    }
    return { pdfs, skipped };
}
