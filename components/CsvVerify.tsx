"use client";

import { useRef, useReducer, useMemo, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Upload, FileSpreadsheet, FileArchive, Download, X } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { OVERALL_META } from "@/lib/uiTypes";
import { parseCsv, isLocalImageRef, CSV_COLUMNS, IMAGE_URLS_COLUMN, type CsvRow } from "@/lib/csvParse";
import { indexZipImages, zipHasImage, type ZipImageIndex } from "@/lib/zipImages";
import { ResultsTable } from "./ResultsTable";
import { useRegisterProcessing } from "./ProcessingGuard";

/** Client-side ZIP size guard (MB); the server enforces the authoritative cap. */
const ZIP_MAX_MB = 100;

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
    [IMAGE_URLS_COLUMN]: "Required. JSON array of image references — http(s) URLs and/or file names inside an uploaded ZIP, e.g. [\"front.jpg\",\"back.jpg\"]. Multiple entries are treated as views of one label.",
};

type RowIssue = { rowNumber: number; error: string };
type Preview = {
    validCount: number;
    invalid: RowIssue[];
    /** Local-file references that still need (or are missing from) the ZIP. */
    imageIssues: RowIssue[];
    /** True if any valid row references a local file (so a ZIP is expected). */
    needsZip: boolean;
};

/** Derive the preview from parsed rows and the (optional) uploaded ZIP index. */
function buildPreview(rows: CsvRow[], zipIndex: ZipImageIndex | null): Preview {
    const invalid = rows.filter((r) => r.error).map((r) => ({ rowNumber: r.rowNumber, error: r.error! }));
    const imageIssues: RowIssue[] = [];
    let needsZip = false;
    for (const r of rows) {
        if (r.error || !r.imageRefs) continue;
        const locals = r.imageRefs.filter(isLocalImageRef);
        if (locals.length === 0) continue;
        needsZip = true;
        if (!zipIndex) {
            imageIssues.push({ rowNumber: r.rowNumber, error: `needs the image ZIP (${locals.length} local file${locals.length === 1 ? "" : "s"})` });
            continue;
        }
        const missing = locals.filter((n) => !zipHasImage(zipIndex, n));
        if (missing.length) imageIssues.push({ rowNumber: r.rowNumber, error: `not found in ZIP: ${missing.join(", ")}` });
    }
    return { validCount: rows.length - invalid.length, invalid, imageIssues, needsZip };
}

/**
 * One CSV verification session as a state machine: CSV parse → optional image
 * ZIP → streamed run. Consolidating these into a reducer keeps the phase
 * transitions atomic and rules out impossible combinations (e.g. a parse error
 * showing alongside an in-flight run) that a dozen useState calls allowed.
 * `preview` is derived (useMemo), and `dragging` stays local — it's pure UI.
 */
type CsvState = {
    file: File | null; rows: CsvRow[] | null; parseError: string | null;
    zipFile: File | null; zipIndex: ZipImageIndex | null; zipError: string | null;
    items: Item[]; total: number; done: number; processing: boolean; processError: string | null;
};
type CsvAction =
    | { type: "csvAccepted"; file: File; rows: CsvRow[] }
    | { type: "csvRejected"; file: File; message: string }
    | { type: "zipTooBig"; message: string }
    | { type: "zipAccepted"; file: File; index: ZipImageIndex }
    | { type: "zipReadError"; message: string }
    | { type: "removeZip" }
    | { type: "reset" }
    | { type: "runStart" }
    | { type: "streamStart"; total: number }
    | { type: "streamProgress"; done: number }
    | { type: "streamResult"; item: Item }
    | { type: "runError"; message: string }
    | { type: "runDone" };

const INITIAL_CSV: CsvState = {
    file: null, rows: null, parseError: null, zipFile: null, zipIndex: null, zipError: null,
    items: [], total: 0, done: 0, processing: false, processError: null,
};

function csvReducer(s: CsvState, a: CsvAction): CsvState {
    switch (a.type) {
        // A new CSV resets the run state but leaves any uploaded ZIP in place.
        case "csvAccepted":
            return { ...s, file: a.file, rows: a.rows, parseError: null, items: [], total: 0, done: 0, processError: null };
        case "csvRejected":
            return { ...s, file: a.file, rows: null, parseError: a.message, items: [], total: 0, done: 0, processError: null };
        case "zipTooBig":
            return { ...s, zipError: a.message };
        case "zipAccepted":
            return { ...s, zipFile: a.file, zipIndex: a.index, zipError: null };
        case "zipReadError":
            return { ...s, zipError: a.message, zipFile: null, zipIndex: null };
        case "removeZip":
            return { ...s, zipFile: null, zipIndex: null, zipError: null };
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
    const { file, rows, parseError, zipFile, zipIndex, zipError, items, total, done, processing, processError } = state;
    const [dragging, setDragging] = useState(false);
    useRegisterProcessing(processing); // warn on navigation while a run is active
    const inputRef = useRef<HTMLInputElement>(null);
    const zipInputRef = useRef<HTMLInputElement>(null);

    // Derived from rows + the (optional) ZIP, so the cross-check stays correct
    // whenever the ZIP is added, swapped, or removed after the CSV.
    const preview = useMemo<Preview | null>(() => (rows ? buildPreview(rows, zipIndex) : null), [rows, zipIndex]);

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

    const acceptZip = useCallback(async (f: File) => {
        if (f.size > ZIP_MAX_MB * 1024 * 1024) {
            dispatch({ type: "zipTooBig", message: `ZIP is larger than the ${ZIP_MAX_MB} MB limit.` });
            return;
        }
        try {
            const idx = indexZipImages(new Uint8Array(await f.arrayBuffer()));
            dispatch({ type: "zipAccepted", file: f, index: idx });
        } catch {
            dispatch({ type: "zipReadError", message: "Could not read this file as a ZIP archive." });
        }
    }, []);

    const onPick = (files: FileList | null) => {
        const f = files?.[0];
        if (f) acceptFile(f);
    };

    const onPickZip = (files: FileList | null) => {
        const f = files?.[0];
        if (f) acceptZip(f);
    };

    const removeZip = () => dispatch({ type: "removeZip" });
    const reset = () => dispatch({ type: "reset" });

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
            } });
        }
    };

    const run = async () => {
        if (!file) return;
        dispatch({ type: "runStart" });

        const body = new FormData();
        body.append("csv", file, file.name);
        if (zipFile) body.append("images", zipFile, zipFile.name);
        try {
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
                    <div className="text-sm text-slate-400">One application per row; the last column lists label images by URL or by file name (with a ZIP).</div>
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

            {/* Optional ZIP of label images, for rows that name files instead of URLs. */}
            {file && !zipFile && (
                <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onPickZip(e.dataTransfer?.files ?? null); }}
                    onClick={() => zipInputRef.current?.click()}
                    className={`mb-5 flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed bg-white px-4 py-3.5 transition-colors ${
                        preview?.needsZip ? "border-amber-300 hover:border-amber-400" : "border-slate-300 hover:border-slate-400"}`}
                >
                    <FileArchive size={22} className={`shrink-0 ${preview?.needsZip ? "text-amber-600" : "text-slate-400"}`} />
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-700">
                            {preview?.needsZip ? "Upload the image ZIP" : "Optional: ZIP of label images"}
                        </div>
                        <div className="text-xs text-slate-400">Needed only for rows that reference image files by name. Drag a .zip here, or click to browse.</div>
                    </div>
                    <input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden"
                           onChange={(e) => { onPickZip(e.target.files); e.target.value = ""; }} />
                </div>
            )}

            {file && zipFile && (
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                    <FileArchive size={22} className="shrink-0 text-violet-600" />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={zipFile.name}>{zipFile.name}</div>
                        {zipIndex && <div className="text-sm text-slate-500">{zipIndex.byPath.size} image{zipIndex.byPath.size === 1 ? "" : "s"} in archive</div>}
                    </div>
                    {!processing && (
                        <button onClick={removeZip} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Remove ZIP">
                            <X size={18} />
                        </button>
                    )}
                </div>
            )}

            {zipError && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" /> <span>{zipError}</span>
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
                <div className="mb-4 flex flex-wrap gap-2.5">
                    {Object.entries(OVERALL_META).map(([k, meta]) => (
                        <div key={k} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm ${meta.chipBg} ${meta.chipText}`}>
                            <meta.Icon size={18} /> <strong>{summary[k] || 0}</strong> {meta.label}
                        </div>
                    ))}
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
                Each reference is either an <strong>http(s) URL</strong> (fetched by the server) or a <strong>file name</strong>
                inside a ZIP you upload alongside the CSV (e.g. <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{"[\"24-1-front.jpg\"]"}</code>).
                Use the ZIP option when the label images live on your machine rather than at a public URL. Names may include
                a folder path (<code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">labels/24-1.jpg</code>); a bare file
                name resolves if it is unique in the archive.
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
