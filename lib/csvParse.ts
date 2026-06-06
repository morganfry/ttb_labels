/**
 * CSV ingestion for the bulk-verification path. Each row carries the COLA
 * Part I values (the application side) in named columns, plus a final column
 * holding a JSON array of label-image references the vision model will
 * transcribe. A reference is either an http(s) URL (fetched server-side) or a
 * file name inside an uploaded ZIP of images (resolved from memory).
 *
 * This is the CSV analogue of the form parser: it produces {@link ApplicationData}
 * directly from columns instead of from a model read of a PDF form. The label
 * side is still model-read (from the image URLs) — the "model transcribes,
 * deterministic code judges" invariant is preserved; only the form-extraction
 * step is replaced by explicit columns.
 *
 * Framework-free and pure so it can be unit-tested and reused on the client
 * for a pre-submit preview.
 */
import type { ApplicationData, ProductType, ProductSource } from "./schema";

/** The column that holds the JSON array of label image references (URLs or ZIP file names). */
export const IMAGE_URLS_COLUMN = "labelImageUrls";

/** Recognized image extensions for a local (ZIP) file reference. */
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

/** True for an http(s) URL reference (fetched), false for a local ZIP file name. */
export function isHttpImageRef(ref: string): boolean {
    return /^https?:\/\//i.test(ref);
}

/** True for a local-file reference (resolved from the uploaded image ZIP). */
export function isLocalImageRef(ref: string): boolean {
    return !isHttpImageRef(ref);
}

/** Canonical column order — also drives the on-screen example and sample file. */
export const CSV_COLUMNS = [
    "serialNumber",
    "productType",
    "source",
    "brandName",
    "fancifulName",
    "applicantNameAddress",
    "grapeVarietals",
    "wineAppellation",
    IMAGE_URLS_COLUMN,
] as const;

const REQUIRED_COLUMNS = ["serialNumber", "productType", "source", "brandName", "applicantNameAddress", IMAGE_URLS_COLUMN];

const PRODUCT_TYPES: ProductType[] = ["wine", "distilledSpirits", "maltBeverages"];
const SOURCES: ProductSource[] = ["domestic", "imported"];

/** One parsed row: either a usable application + image references, or an error. */
export interface CsvRow {
    /** 1-based row number as it appears in the file (excluding the header). */
    rowNumber: number;
    app?: ApplicationData;
    /** Image references: http(s) URLs and/or file names inside the image ZIP. */
    imageRefs?: string[];
    /** Set when the row is unusable; app/imageRefs are then undefined. */
    error?: string;
}

export interface CsvParseResult {
    rows: CsvRow[];
    /** A header-level problem (missing required columns). Rows are empty then. */
    headerError?: string;
}

/**
 * Parse the full CSV text into validated rows. Header-level problems (e.g. a
 * missing required column) short-circuit; otherwise every data row is returned,
 * each independently flagged valid or in error so one bad row never sinks the
 * batch.
 */
export function parseCsv(text: string, maxImagesPerRow = Infinity): CsvParseResult {
    const records = tokenizeCsv(text);
    if (records.length === 0) return { rows: [], headerError: "The CSV file is empty." };

    const header = records[0].map((h) => h.trim());
    const index: Record<string, number> = {};
    header.forEach((h, i) => { if (!(h in index)) index[h] = i; });

    const missing = REQUIRED_COLUMNS.filter((c) => !(c in index));
    if (missing.length > 0) {
        return { rows: [], headerError: `Missing required column(s): ${missing.join(", ")}. Expected header: ${CSV_COLUMNS.join(", ")}.` };
    }

    const rows: CsvRow[] = [];
    for (let r = 1; r < records.length; r++) {
        const cells = records[r];
        // Skip blank trailing lines (a single empty cell from a trailing newline).
        if (cells.length === 1 && cells[0].trim() === "") continue;
        rows.push(parseRow(cells, index, r, maxImagesPerRow));
    }
    return { rows };
}

function parseRow(cells: string[], index: Record<string, number>, rowNumber: number, maxImagesPerRow: number): CsvRow {
    const get = (col: string): string => {
        const i = index[col];
        return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const fail = (error: string): CsvRow => ({ rowNumber, error });

    const productTypeRaw = get("productType");
    if (!PRODUCT_TYPES.includes(productTypeRaw as ProductType)) {
        return fail(`Invalid productType "${productTypeRaw}" (expected one of ${PRODUCT_TYPES.join(", ")}).`);
    }
    const sourceRaw = get("source");
    if (!SOURCES.includes(sourceRaw as ProductSource)) {
        return fail(`Invalid source "${sourceRaw}" (expected one of ${SOURCES.join(", ")}).`);
    }

    for (const c of ["serialNumber", "brandName", "applicantNameAddress"]) {
        if (get(c) === "") return fail(`Missing required value for "${c}".`);
    }

    const imageRefs = parseImageRefs(get(IMAGE_URLS_COLUMN));
    if (typeof imageRefs === "string") return fail(imageRefs); // error message
    if (imageRefs.length === 0) return fail(`"${IMAGE_URLS_COLUMN}" must contain at least one image URL.`);
    if (imageRefs.length > maxImagesPerRow) {
        return fail(`"${IMAGE_URLS_COLUMN}" has ${imageRefs.length} images; the limit is ${maxImagesPerRow} per row.`);
    }

    const optional = (col: string): string | undefined => {
        const v = get(col);
        return v === "" ? undefined : v;
    };

    const app: ApplicationData = {
        serialNumber: get("serialNumber"),
        productType: productTypeRaw as ProductType,
        source: sourceRaw as ProductSource,
        brandName: get("brandName"),
        fancifulName: optional("fancifulName"),
        applicantNameAddress: get("applicantNameAddress"),
        grapeVarietals: optional("grapeVarietals"),
        wineAppellation: optional("wineAppellation"),
    };
    return { rowNumber, app, imageRefs };
}

/**
 * Validate one image reference. Returns the cleaned reference, or `{error}`
 * describing why it's rejected. Two accepted shapes:
 *  - an http(s) URL — fetched server-side (still subject to the SSRF guard).
 *  - a relative file name — resolved from the uploaded image ZIP.
 * Anything with a different scheme (ftp:, file:, data:, a Windows drive), an
 * absolute path, a traversal segment, or no image extension is rejected here so
 * the user gets feedback at parse time rather than mid-run.
 */
function validateImageRef(raw: string): string | { error: string } {
    const u = raw.trim();
    if (u === "") return { error: "empty" }; // caller skips empties
    if (isHttpImageRef(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
        return { error: `Image reference must be an http(s) URL or a ZIP file name: ${truncate(u)}` };
    }
    if (u.startsWith("/") || u.includes("\\") || u.split("/").includes("..")) {
        return { error: `Local image path must be a relative name without "..": ${truncate(u)}` };
    }
    if (!IMG_EXT_RE.test(u)) {
        return { error: `Local image "${truncate(u)}" must end in .jpg, .jpeg, .png, .webp, or .gif` };
    }
    return u;
}

/**
 * Parse the JSON-array image-reference cell. Returns the reference list on
 * success, or an error string describing what's wrong. A bare single reference
 * (not JSON) is also accepted as a one-element list — a forgiving convenience
 * for hand-edited files.
 */
function parseImageRefs(raw: string): string[] | string {
    if (raw === "") return `"${IMAGE_URLS_COLUMN}" is empty.`;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Not JSON: accept a lone URL or ZIP file name as a single-image shorthand.
        const one = validateImageRef(raw);
        if (typeof one === "string") return [one];
        return `"${IMAGE_URLS_COLUMN}" must be a JSON array of image references (URLs or ZIP file names), e.g. ["front.jpg"]. ${one.error}`;
    }

    if (typeof parsed === "string") parsed = [parsed];
    if (!Array.isArray(parsed)) return `"${IMAGE_URLS_COLUMN}" must be a JSON array of image references.`;

    const refs: string[] = [];
    for (const item of parsed) {
        if (typeof item !== "string") return `"${IMAGE_URLS_COLUMN}" contains a non-string entry.`;
        if (item.trim() === "") continue;
        const r = validateImageRef(item);
        if (typeof r !== "string") return r.error;
        refs.push(r);
    }
    return refs;
}

function truncate(s: string, n = 60): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Minimal RFC-4180 tokenizer: handles quoted fields, escaped quotes (""),
 * and commas / newlines inside quotes (the image-URL JSON column needs this).
 * Returns an array of records, each an array of cell strings.
 */
export function tokenizeCsv(text: string): string[][] {
    const records: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    // Normalize CRLF so newline handling is uniform.
    const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cell += '"'; i++; } // escaped quote
                else inQuotes = false;
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            row.push(cell); cell = "";
        } else if (ch === "\n") {
            row.push(cell); cell = "";
            records.push(row); row = [];
        } else {
            cell += ch;
        }
    }
    // Flush the final cell/row unless the input ended exactly on a newline.
    if (cell !== "" || row.length > 0) { row.push(cell); records.push(row); }
    return records;
}
