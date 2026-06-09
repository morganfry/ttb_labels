/**
 * Pure, framework-free file-type helpers shared by the client (intake/queue) and
 * the server (work-item media type). Dependency-light on purpose: the only
 * import is a type, so this is safe to pull into a client bundle (no SDK, no fs).
 *
 * An application can arrive as a combined PDF or as a flat image (JPG/PNG/…) that
 * shows the whole application — form Part I plus the affixed label. PDFs get
 * sliced (page 1 = form, artwork pages = label); an image can't be sliced, so the
 * one image is read by both parsers. {@link workItemMediaType} is what tells the
 * orchestrator which path an item takes.
 */
import type { MediaType } from "./extraction";

const IMAGE_BY_EXT: Record<string, MediaType> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
};

/** The image media types the pipeline accepts (derived from the extension map so
 *  the two can't drift). Used to validate served/declared content types. */
export const IMAGE_MEDIA_TYPES: MediaType[] = [...new Set(Object.values(IMAGE_BY_EXT))];

/** The image media type for a file name, or null if it isn't a supported image. */
export function imageMediaType(name: string): MediaType | null {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_BY_EXT[ext] ?? null;
}

export const isImageName = (n: string) => imageMediaType(n) !== null;
export const isPdfName = (n: string) => /\.pdf$/i.test(n);
/** Only real ZIPs — that's all the browser extractor (fflate) handles. */
export const isZipName = (n: string) => /\.zip$/i.test(n);
/** The bulk tab only accepts a .csv — reject anything else by name up front. */
export const isCsvName = (n: string) => /\.csv$/i.test(n);
/** A document we can verify directly (not an archive): a PDF or a supported image. */
export const isDocName = (n: string) => isPdfName(n) || isImageName(n);

/**
 * Media type to feed the model for a work item, inferred from its file name. A
 * supported image returns its image type; everything else (PDFs, unknowns)
 * defaults to application/pdf, the original combined-PDF path.
 */
export function workItemMediaType(name: string): MediaType {
    return imageMediaType(name) ?? "application/pdf";
}
