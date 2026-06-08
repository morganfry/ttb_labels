"use client";

import { useRef, useReducer, useMemo, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Upload, FileSpreadsheet, FileArchive, Images, Download, X } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { OVERALL_META, isZip, isImage } from "@/lib/uiTypes";
import { parseCsv, isLocalImageRef, CSV_COLUMNS, IMAGE_URLS_COLUMN, type CsvRow } from "@/lib/csvParse";
import { indexImageSources, zipHasImage, type RawImageSource, type ZipImageIndex } from "@/lib/zipImages";
import { ResultsTable } from "./ResultsTable";
import { ReviewHistoryLink } from "./ReviewHistoryLink";
import { LatencySummary } from "./LatencySummary";
import { useRegisterProcessing } from "./ProcessingGuard";

/** Client-side guard on total uploaded image bytes (MB); the server enforces the
 *  authoritative cap. Covers loose images and ZIPs alike. */
const IMAGES_MAX_MB = 100;

/** Read the dropped image sources (ZIPs and/or loose image files) into one index
 *  for the preview cross-check. Rebuilt from the full set on every change so
 *  basename uniqueness stays correct as files are added or removed. */
async function indexImageFiles(files: File[]): Promise<ZipImageIndex> {
    const sources: RawImageSource[] = await Promise.all(files.map(async (f): Promise<RawImageSource> => {
        const bytes = new Uint8Array(await f.arrayBuffer());
        return isZip(f.name) ? { zip: bytes } : { name: f.name, bytes };
    }));
    return indexImageSources(sources);
}

/** A worked example shown on the page and offered as a downloadable template. */
const SAMPLE_CSV = `${CSV_COLUMNS.join(",")}
24-1,wine,domestic,Sunset Ridge,Reserve,"Sunset Ridge Winery, 100 Vine St, Napa, CA 94558",Cabernet Sauvignon,Napa Valley,"[""https://example.com/labels/24-1-front.jpg"",""https://example.com/labels/24-1-back.jpg""]"
24-2,distilledSpirits,imported,Old Pier Rum,,"Old Pier Distillers, London, UK",,,"[""https://example.com/labels/24-2.jpg""]"
`;

const COLUMN_NOTES: Record<string, string> = {
    serialNumber: "Required. COLA item 4, e.g. 24-1.",
    productType: "Required. One of: wine, distilledSpirits, maltBeverages (maltBeverage is also accepted).",
    source: "Required. One of: domestic, imported.",
    brandName: "Required. COLA item 6.",
    fancifulName: "Optional. COLA item 7.",
    applicantNameAddress: "Required. COLA item 8 — name + address.",
    grapeVarietals: "Optional, wine only. COLA item 10. If set, an appellation becomes required on the label.",
    wineAppellation: "Optional, wine only. COLA item 11.",
    [IMAGE_URLS_COLUMN]: "Required. JSON array of image references — http(s) URLs and/or names of images you upload (loose files or in a ZIP), e.g. [\"front.jpg\",\"back.jpg\"]. Multiple entries are treated as views of one label.",
};

type RowIssue = { rowNumber: number; error: string };
type Preview = {
    validCount: number;
    invalid: RowIssue[];
    /** Local-file references that still need (or are missing from) the uploads. */
    imageIssues: RowIssue[];
    /** True if any valid row references a local file (so images are expected). */
    needsImages: boolean;
};

/** Derive the preview from parsed rows and the (optional) uploaded-image index. */
function buildPreview(rows: CsvRow[], imageIndex: ZipImageIndex | null): Preview {
    const invalid = rows.filter((r) => r.error).map((r) => ({ rowNumber: r.rowNumber, error: r.error! }));
    const imageIssues: RowIssue[] = [];
    let needsImages = false;
    for (const r of rows) {
        if (r.error || !r.imageRefs) continue;
        const locals = r.imageRefs.filter(isLocalImageRef);
        if (locals.length === 0) continue;
        needsImages = true;
        if (!imageIndex) {
            imageIssues.push({ rowNumber: r.rowNumber, error: `needs ${locals.length} uploaded image${locals.length === 1 ? "" : "s"}` });
            continue;
        }
        const missing = locals.filter((n) => !zipHasImage(imageIndex, n));
        if (missing.length) imageIssues.push({ rowNumber: r.rowNumber, error: `not found among uploads: ${missing.join(", ")}` });
    }
    return { validCount: rows.length - invalid.length, invalid, imageIssues, needsImages };
}

/**
 * One CSV verification session as a state machine: CSV parse → optional label
 * images (loose files and/or ZIPs) → streamed run. Consolidating these into a
 * reducer keeps the phase transitions atomic and rules out impossible
 * combinations (e.g. a parse error showing alongside an in-flight run) that a
 * dozen useState calls allowed. `preview` is derived (useMemo), and `dragging`
 * stays local — it's pure UI.
 */
type CsvState = {
    file: File | null; rows: CsvRow[] | null; parseError: string | null;
    imageFiles: File[]; imageIndex: ZipImageIndex | null; imageError: string | null;
    items: Item[]; total: number; done: number; processing: boolean; processError: string | null;
};
type CsvAction =
    | { type: "csvAccepted"; file: File; rows: CsvRow[] }
    | { type: "csvRejected"; file: File; message: string }
    | { type: "imagesSet"; files: File[]; index: ZipImageIndex | null }
    | { type: "imagesError"; message: string }
    | { type: "reset" }
    | { type: "runStart" }
    | { type: "streamStart"; total: number }
    | { type: "streamProgress"; done: number }
    | { type: "streamResult"; item: Item }
    | { type: "runError"; message: string }
    | { type: "runDone" };

const INITIAL_CSV: CsvState = {
    file: null, rows: null, parseError: null, imageFiles: [], imageIndex: null, imageError: null,
    items: [], total: 0, done: 0, processing: false, processError: null,
};

function csvReducer(s: CsvState, a: CsvAction): CsvState {
    switch (a.type) {
        // A new CSV resets the run state but leaves any uploaded images in place.
        case "csvAccepted":
            return { ...s, file: a.file, rows: a.rows, parseError: null, items: [], total: 0, done: 0, processError: null };
        case "csvRejected":
            return { ...s, file: a.file, rows: null, parseError: a.message, items: [], total: 0, done: 0, processError: null };
        case "imagesSet":
            return { ...s, imageFiles: a.files, imageIndex: a.index, imageError: null };
        case "imagesError":
            return { ...s, imageError: a.message };
        case "reset":
            return INITIAL_CSV;
        case "runStart":
            return { ...s, processing: true, processError: null, items: [], done: 0 };
        case "streamStart":
            return { ...s, total: a.total };
        case "streamProgress":
            return { ...s, done: a.done };
        case "streamResult":
            return { ...s, items: [...s.items, a.item] };
        case "runError":
            return { ...s, processError: a.message };
        case "runDone":
            return { ...s, processing: false };
    }
}

export default function CsvVerify() {
    const [state, dispatch] = useReducer(csvReducer, INITIAL_CSV);
    const { file, rows, parseError, imageFiles, imageIndex, imageError, items, total, done, processing, processError } = state;
    const [dragging, setDragging] = useState(false);
    useRegisterProcessing(processing); // warn on navigation while a run is active
    const inputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    // The latest *intended* image set, updated synchronously so back-to-back
    // add/remove clicks each build on the previous one (state lags behind the
    // async index rebuild). `reqIdRef` stamps each rebuild so a slow one that
    // resolves out of order can't clobber a newer set (last-write-wins race).
    const imageFilesRef = useRef<File[]>([]);
    const reqIdRef = useRef(0);

    // Derived from rows + the (optional) uploaded images, so the cross-check stays
    // correct whenever images are added or removed after the CSV.
    const preview = useMemo<Preview | null>(() => (rows ? buildPreview(rows, imageIndex) : null), [rows, imageIndex]);

    const acceptFile = useCallback(async (f: File) => {
        try {
            const text = await f.text();
            const { rows, headerError } = parseCsv(text);
            if (headerError) dispatch({ type: "csvRejected", file: f, message: headerError });
            else dispatch({ type: "csvAccepted", file: f, rows });
        } catch {
            dispatch({ type: "csvRejected", file: f, message: "Could not read the file as text." });
        }
    }, []);

    // Set the label-image uploads to `files` (ZIPs and/or loose images) and
    // rebuild the index from the whole set. Replacing rather than merging keeps
    // basename-uniqueness correct; callers pass the full intended list.
    const applyImageFiles = useCallback(async (files: File[]) => {
        if (files.length === 0) {
            imageFilesRef.current = [];
            reqIdRef.current++; // invalidate any in-flight rebuild
            dispatch({ type: "imagesSet", files: [], index: null });
            return;
        }
        const totalBytes = files.reduce((n, f) => n + f.size, 0);
        if (totalBytes > IMAGES_MAX_MB * 1024 * 1024) {
            // Reject the whole set without touching the accepted one in flight.
            dispatch({ type: "imagesError", message: `Uploaded images total more than the ${IMAGES_MAX_MB} MB limit.` });
            return;
        }
        imageFilesRef.current = files;
        const reqId = ++reqIdRef.current;
        try {
            const index = await indexImageFiles(files);
            if (reqId === reqIdRef.current) dispatch({ type: "imagesSet", files, index });
        } catch {
            if (reqId === reqIdRef.current) dispatch({ type: "imagesError", message: "Couldn't read one of the uploaded archives as a ZIP." });
        }
    }, []);

    const onPick = (files: FileList | null) => {
        const f = files?.[0];
        if (f) acceptFile(f);
    };

    // Add dropped/picked image sources (loose images and/or ZIPs), deduped by
    // name so re-adding a file doesn't pile up duplicates. Merge onto the latest
    // intended set (the ref), not the render-closure value, so rapid adds compose.
    const onPickImages = (files: FileList | null) => {
        const incoming = Array.from(files ?? []).filter((f) => isImage(f.name) || isZip(f.name));
        if (incoming.length === 0) {
            if (files && files.length) dispatch({ type: "imagesError", message: "Only image files (JPG/PNG/…) or a ZIP can be added here." });
            return;
        }
        const byName = new Map(imageFilesRef.current.map((f) => [f.name, f]));
        for (const f of incoming) byName.set(f.name, f);
        void applyImageFiles([...byName.values()]);
    };

    const removeImage = (name: string) => void applyImageFiles(imageFilesRef.current.filter((f) => f.name !== name));
    const reset = () => { imageFilesRef.current = []; reqIdRef.current++; dispatch({ type: "reset" }); };

    const downloadSample = () => {
        const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url; a.download = "ttb-bulk-template.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleStreamLine = (evt: any) => {
        if (evt.type === "start") dispatch({ type: "streamStart", total: evt.total });
        else if (evt.type === "progress") dispatch({ type: "streamProgress", done: evt.done });
        else if (evt.type === "result") {
            dispatch({ type: "streamResult", item: {
                id: evt.id, name: evt.name, kind: "csv", fromZip: null, status: "done",
                result: evt.ok ? evt.result : null, error: evt.ok ? null : evt.error,
                latencyMs: evt.latencyMs, timings: evt.timings,
            } });
        }
    };

    const run = async () => {
        if (!file) return;
        dispatch({ type: "runStart" });

        try {
            const body = new FormData();
            // CHROME LARGE-UPLOAD FIX (see VerificationApp): upload buffered bytes,
            // not disk-backed File objects, so Chrome sends from memory instead of
            // a lazy disk read that fails at byte 0 for large/cloud-backed files
            // (RST_STREAM → net::ERR_FAILED). Firefox/curl buffer and so succeed.
            const buffered = async (f: File) => new Blob([await f.arrayBuffer()], { type: f.type || "application/octet-stream" });
            body.append("csv", await buffered(file), file.name);
            // ZIPs go as `images` (server expands them); loose files as `image`.
            for (const f of imageFiles) body.append(isZip(f.name) ? "images" : "image", await buffered(f), f.name);

            const res = await fetch("/api/verify-csv", { method: "POST", body });
            if (!res.ok || !res.body) {
                let msg = "";
                try { msg = (await res.json())?.error ?? ""; } catch { /* not json */ }
                throw new Error(msg || `Server returned ${res.status}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
                const { value, done: streamDone } = await reader.read();
                if (streamDone) break;
                buf += decoder.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf("\n")) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (line) try { handleStreamLine(JSON.parse(line)); }
                        catch { console.error("Malformed NDJSON line:", line); }
                }
            }
            if (buf.trim()) try { handleStreamLine(JSON.parse(buf.trim())); }
                catch { console.error("Malformed NDJSON trailing data:", buf.trim()); }
        } catch (e) {
            dispatch({ type: "runError", message: e instanceof Error ? e.message : "Processing failed." });
        } finally {
            dispatch({ type: "runDone" });
        }
    };

    const resultItems = items.filter((it) => it.result);
    const errorItems = items.filter((it) => !it.result);
    const hasResults = items.length > 0;
    const allDone = total > 0 && done >= total;
    const summary = resultItems.reduce((a: Record<string, number>, it) => {
        a[it.result.overall] = (a[it.result.overall] || 0) + 1;
        return a;
    }, {});

    return (
        <>
            {!file ? (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); onPick(e.dataTransfer?.files ?? null); }}
                    onClick={() => inputRef.current?.click()}
                    className={`mb-5 cursor-pointer rounded-2xl border-2 border-dashed bg-white px-6 py-11 text-center transition-colors ${
                        dragging ? "border-blue-600 bg-blue-50" : "border-slate-300"}`}
                >
                    <Upload size={40} strokeWidth={1.5} className={`mx-auto mb-3 ${dragging ? "text-blue-600" : "text-slate-500"}`} />
                    <div className="text-lg font-semibold">{dragging ? "Drop the CSV to add it" : "Drag a CSV here, or click to browse"}</div>
                    <div className="text-sm text-slate-400">One application per row; the last column lists label images by URL or by file name (upload the images below).</div>
                    <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
                           onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
                </div>
            ) : (
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                    <FileSpreadsheet size={22} className="shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={file.name}>{file.name}</div>
                        {preview && (
                            <div className="text-sm text-slate-500">
                                {preview.validCount} valid row{preview.validCount === 1 ? "" : "s"}
                                {preview.invalid.length > 0 && <span className="text-amber-700"> · {preview.invalid.length} with errors</span>}
                            </div>
                        )}
                    </div>
                    {!processing && (
                        <button onClick={reset} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Remove file">
                            <X size={18} />
                        </button>
                    )}
                </div>
            )}

            {/* Optional label images (loose files and/or ZIPs), for rows that name
                files instead of URLs. A hidden multi-input is shared by the empty
                dropzone and the "Add more" button. */}
            {file && (
                <input ref={imageInputRef} type="file" multiple accept=".zip,application/zip,image/*" className="hidden"
                       onChange={(e) => { onPickImages(e.target.files); e.target.value = ""; }} />
            )}

            {file && imageFiles.length === 0 && (
                <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onPickImages(e.dataTransfer?.files ?? null); }}
                    onClick={() => imageInputRef.current?.click()}
                    className={`mb-5 flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed bg-white px-4 py-3.5 transition-colors ${
                        preview?.needsImages ? "border-amber-300 hover:border-amber-400" : "border-slate-300 hover:border-slate-400"}`}
                >
                    <Images size={22} className={`shrink-0 ${preview?.needsImages ? "text-amber-600" : "text-slate-400"}`} />
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-700">
                            {preview?.needsImages ? "Upload the label images" : "Optional: label images"}
                        </div>
                        <div className="text-xs text-slate-400">Needed only for rows that reference image files by name. Drag images or a .zip here, or click to browse.</div>
                    </div>
                </div>
            )}

            {file && imageFiles.length > 0 && (
                <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onPickImages(e.dataTransfer?.files ?? null); }}
                    className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                    <div className="mb-2.5 flex items-center gap-3">
                        <Images size={22} className="shrink-0 text-violet-600" />
                        <div className="min-w-0 flex-1 text-sm text-slate-600">
                            {imageFiles.length} upload{imageFiles.length === 1 ? "" : "s"}
                            {imageIndex && <> · <strong>{imageIndex.byPath.size}</strong> image{imageIndex.byPath.size === 1 ? "" : "s"} ready</>}
                        </div>
                        {!processing && (
                            <button onClick={() => imageInputRef.current?.click()}
                                    className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                                Add more
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {imageFiles.map((f) => (
                            <span key={f.name} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1.5 text-xs text-slate-700">
                                {isZip(f.name) ? <FileArchive size={13} className="text-violet-500" /> : <Images size={13} className="text-slate-400" />}
                                <span className="max-w-[16rem] truncate" title={f.name}>{f.name}</span>
                                {!processing && (
                                    <button onClick={() => removeImage(f.name)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" title={`Remove ${f.name}`}>
                                        <X size={13} />
                                    </button>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {imageError && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" /> <span>{imageError}</span>
                </div>
            )}

            {parseError && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" /> <span>{parseError}</span>
                </div>
            )}

            {preview && preview.invalid.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="mb-1.5 flex items-center gap-2 font-medium"><AlertTriangle size={16} className="text-amber-600" /> Rows with errors (they will be reported, not verified):</div>
                    <ul className="ml-1 list-inside list-disc space-y-0.5">
                        {preview.invalid.slice(0, 10).map((r) => <li key={r.rowNumber}>Row {r.rowNumber}: {r.error}</li>)}
                        {preview.invalid.length > 10 && <li>…and {preview.invalid.length - 10} more.</li>}
                    </ul>
                </div>
            )}

            {preview && preview.imageIssues.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="mb-1.5 flex items-center gap-2 font-medium"><AlertTriangle size={16} className="text-amber-600" /> Local image references to resolve (these rows will error until fixed):</div>
                    <ul className="ml-1 list-inside list-disc space-y-0.5">
                        {preview.imageIssues.slice(0, 10).map((r) => <li key={r.rowNumber}>Row {r.rowNumber}: {r.error}</li>)}
                        {preview.imageIssues.length > 10 && <li>…and {preview.imageIssues.length - 10} more.</li>}
                    </ul>
                </div>
            )}

            {processError && (
                <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="text-red-700" /> <span>{processError}</span>
                </div>
            )}

            {file && (
                <div className="mb-5">
                    {processing ? (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                            <Loader2 size={22} className="animate-spin text-blue-600" />
                            <span className="whitespace-nowrap text-base font-medium">Processing… {done} of {total || "?"} done</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                                <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                            </div>
                        </div>
                    ) : (
                        <button onClick={run} disabled={!preview || preview.validCount === 0}
                                className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-6 py-5 text-xl font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                            <CheckCircle2 size={24} />
                            {hasResults ? "Re-run verification" : `Verify ${preview?.validCount ?? 0} row${preview?.validCount === 1 ? "" : "s"}`}
                        </button>
                    )}
                </div>
            )}

            {allDone && (
                <div className="mb-4 flex flex-col gap-2.5">
                    <div className="flex flex-wrap gap-2.5">
                        {Object.entries(OVERALL_META).map(([k, meta]) => (
                            <div key={k} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm ${meta.chipBg} ${meta.chipText}`}>
                                <meta.Icon size={18} /> <strong>{summary[k] || 0}</strong> {meta.label}
                            </div>
                        ))}
                    </div>
                    {resultItems.length > 0 && <LatencySummary items={resultItems} />}
                </div>
            )}

            {errorItems.length > 0 && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                    <div className="mb-1.5 font-medium">{errorItems.length} row{errorItems.length === 1 ? "" : "s"} could not be verified:</div>
                    <ul className="ml-1 list-inside list-disc space-y-0.5">
                        {errorItems.map((it) => <li key={it.id}><span className="font-medium">{it.name}</span>: {it.error?.message ?? "Unknown error."}</li>)}
                    </ul>
                </div>
            )}

            {resultItems.length > 0 && <ResultsTable items={resultItems} />}

            {/* Only when a verdict was actually persisted (errored-only runs save
                nothing), so the link never points at an empty history of this run. */}
            {resultItems.length > 0 && !processing && <ReviewHistoryLink />}

            {!hasResults && <CsvFormatGuide onDownload={downloadSample} />}
        </>
    );
}

function CsvFormatGuide({ onDownload }: { onDownload: () => void }) {
    return (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-bold">Expected CSV format</h2>
                <button onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Download size={16} /> Download template
                </button>
            </div>
            <p className="mb-3 text-sm text-slate-500">
                One application per row. The application (COLA Part I) fields are columns; the label artwork is referenced
                by the final <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{IMAGE_URLS_COLUMN}</code> column,
                a JSON array of image references. The app reads those images, then verifies them against the row.
            </p>
            <p className="mb-3 text-sm text-slate-500">
                Each reference is either an <strong>http(s) URL</strong> (fetched by the server) or the <strong>file name</strong>
                of an image you upload alongside the CSV (e.g. <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{"[\"24-1-front.jpg\"]"}</code>).
                Upload the images — individually or in a ZIP — when the label art lives on your machine rather than at a public URL.
                A name may include a folder path (<code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">labels/24-1.jpg</code>);
                a bare file name resolves if it is unique across everything you uploaded.
            </p>

            <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
                <pre className="whitespace-pre p-3.5 text-[12px] leading-relaxed text-slate-700">{SAMPLE_CSV}</pre>
            </div>

            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr>
                        <th className="border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-600">Column</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-600">Notes</th>
                    </tr>
                </thead>
                <tbody>
                    {CSV_COLUMNS.map((c) => (
                        <tr key={c} className="align-top">
                            <td className="border-b border-slate-100 px-2 py-1.5 font-mono text-[12.5px] text-slate-800">{c}</td>
                            <td className="border-b border-slate-100 px-2 py-1.5 text-slate-600">{COLUMN_NOTES[c]}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
