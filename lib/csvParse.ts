/**
 * CSV ingestion for the bulk-verification path. Each row carries the COLA
 * Part I values (the application side) in named columns, plus a final column
 * holding a JSON array of label-image references the vision model will
 * transcribe. A reference is the file name of an image the agent uploaded
 * alongside the CSV (loose files and/or a ZIP), resolved from memory — the app
 * never fetches images over the network.
 *
 * This is the CSV analogue of the form parser: it produces {@link ApplicationData}
 * directly from columns instead of from a model read of a PDF form. The label
 * side is still model-read (from the uploaded images) — the "model transcribes,
 * deterministic code judges" invariant is preserved; only the form-extraction
 * step is replaced by explicit columns.
 *
 * Framework-free and pure so it can be unit-tested and reused on the client
 * for a pre-submit preview.
 */
import type { ApplicationData, ProductType, ProductSource } from "./schema";
import { isImageName } from "./mediaType";

/** The column that holds the JSON array of label-image file names (uploaded images). */
export const IMAGE_REFS_COLUMN = "labelImages";

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
    IMAGE_REFS_COLUMN,
] as const;

const REQUIRED_COLUMNS = ["serialNumber", "productType", "source", "brandName", "applicantNameAddress", IMAGE_REFS_COLUMN];

const PRODUCT_TYPES: ProductType[] = ["wine", "distilledSpirits", "maltBeverages"];
const SOURCES: ProductSource[] = ["domestic", "imported"];

/**
 * Accepted CSV `productType` inputs → canonical {@link ProductType}. The
 * singular "maltBeverage" is accepted as an alias for "maltBeverages" because
 * agents commonly type it that way; the rest of the app keeps the plural enum.
 */
const PRODUCT_TYPE_ALIASES: Record<string, ProductType> = {
    wine: "wine",
    distilledSpirits: "distilledSpirits",
    maltBeverages: "maltBeverages",
    maltBeverage: "maltBeverages",
};

/** One parsed row: either a usable application + image references, or an error. */
export interface CsvRow {
    /** 1-based row number as it appears in the file (excluding the header). */
    rowNumber: number;
    app?: ApplicationData;
    /** Image references: file names of uploaded images (loose files and/or a ZIP). */
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
export function parseCsv(text: string, maxImagesPerRow = Infinity, maxRows = Infinity): CsvParseResult {
    let records: string[][];
    try { records = tokenizeCsv(text); }
    catch (e) { return { rows: [], headerError: e instanceof Error ? e.message : "Malformed CSV." }; }
    if (records.length === 0) return { rows: [], headerError: "The CSV file is empty." };

    // Bound the work: reject an over-row-cap file before building a work item per
    // row (records[0] is the header, so data rows ≈ records.length - 1).
    if (records.length - 1 > maxRows) {
        return { rows: [], headerError: `The CSV has more than ${maxRows} rows; split it into smaller files.` };
    }

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
    const productType = PRODUCT_TYPE_ALIASES[productTypeRaw];
    if (!productType) {
        return fail(`Invalid productType "${productTypeRaw}" (expected one of ${PRODUCT_TYPES.join(", ")}).`);
    }
    const sourceRaw = get("source");
    if (!SOURCES.includes(sourceRaw as ProductSource)) {
        return fail(`Invalid source "${sourceRaw}" (expected one of ${SOURCES.join(", ")}).`);
    }

    for (const c of ["serialNumber", "brandName", "applicantNameAddress"]) {
        if (get(c) === "") return fail(`Missing required value for "${c}".`);
    }

    const imageRefs = parseImageRefs(get(IMAGE_REFS_COLUMN));
    if (typeof imageRefs === "string") return fail(imageRefs); // error message
    if (imageRefs.length === 0) return fail(`"${IMAGE_REFS_COLUMN}" must list at least one image.`);
    if (imageRefs.length > maxImagesPerRow) {
        return fail(`"${IMAGE_REFS_COLUMN}" has ${imageRefs.length} images; the limit is ${maxImagesPerRow} per row.`);
    }

    const optional = (col: string): string | undefined => {
        const v = get(col);
        return v === "" ? undefined : v;
    };

    const app: ApplicationData = {
        serialNumber: get("serialNumber"),
        productType,
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
 * Validate one image reference: the file name of an uploaded image, resolved
 * later from the in-memory index. Returns the cleaned name, or `{error}`.
 * A URL (or any scheme: http, ftp, file, data, a Windows drive), an absolute
 * path, a traversal segment, or a non-image extension is rejected here — images
 * must be uploaded, not linked — so the user gets feedback at parse time rather
 * than mid-run.
 */
function validateImageRef(raw: string): string | { error: string } {
    const u = raw.trim();
    if (u === "") return { error: "empty" }; // caller skips empties
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
        return { error: `Reference an uploaded image by file name, not a URL: ${truncate(u)}` };
    }
    if (u.startsWith("/") || u.includes("\\") || u.split("/").includes("..")) {
        return { error: `Image name must be a relative file name without "..": ${truncate(u)}` };
    }
    if (!isImageName(u)) {
        return { error: `Image "${truncate(u)}" must end in .jpg, .jpeg, .png, .webp, or .gif` };
    }
    return u;
}

/**
 * Parse the JSON-array image cell into a list of uploaded-image file names.
 * Returns the list on success, or an error string. A bare single name (not
 * JSON) is also accepted as a one-element list — a forgiving convenience for
 * hand-edited files.
 */
function parseImageRefs(raw: string): string[] | string {
    if (raw === "") return `"${IMAGE_REFS_COLUMN}" is empty.`;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Not JSON: accept a lone file name as a single-image shorthand.
        const one = validateImageRef(raw);
        if (typeof one === "string") return [one];
        return `"${IMAGE_REFS_COLUMN}" must be a JSON array of uploaded-image file names, e.g. ["front.jpg"]. ${one.error}`;
    }

    if (typeof parsed === "string") parsed = [parsed];
    if (!Array.isArray(parsed)) return `"${IMAGE_REFS_COLUMN}" must be a JSON array of image file names.`;

    const refs: string[] = [];
    for (const item of parsed) {
        if (typeof item !== "string") return `"${IMAGE_REFS_COLUMN}" contains a non-string entry.`;
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
        } else if (ch === '"' && cell === "") {
            inQuotes = true; // a quote only opens a field at its START (RFC 4180)
        } else if (ch === ",") {
            row.push(cell); cell = "";
        } else if (ch === "\n") {
            row.push(cell); cell = "";
            records.push(row); row = [];
        } else {
            cell += ch; // a '"' that isn't at field start is a literal char, not a toggle
        }
    }
    // A still-open quote means a malformed file: without this, an unescaped " would
    // swallow every remaining row into one cell and they'd silently vanish.
    if (inQuotes) throw new Error('Unterminated quoted field — check the CSV for an unescaped " (use "" for a literal quote).');
    // Flush the final cell/row unless the input ended exactly on a newline.
    if (cell !== "" || row.length > 0) { row.push(cell); records.push(row); }
    return records;
}
