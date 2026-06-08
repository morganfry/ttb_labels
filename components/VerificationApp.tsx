"use client";

import { useReducer, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { uid, isPdf, isImage, isZip, OVERALL_META } from "@/lib/uiTypes";
import { config } from "@/lib/config";
import { extractZipDocs } from "@/lib/zipDocs";
import { Dropzone } from "./Dropzone";
import { FileQueue } from "./FileQueue";
import { ResultsTable } from "./ResultsTable";
import { ReviewHistoryLink } from "./ReviewHistoryLink";
import { LatencySummary } from "./LatencySummary";
import { useRegisterProcessing } from "./ProcessingGuard";

/**
 * The PDF tab's run state as one machine: the file queue plus whether a batch is
 * in flight. Modeling it as a reducer keeps the per-item transitions
 * (queued → processing → done) atomic and rules out impossible combinations that
 * scattered useState calls allow.
 */
type State = { items: Item[]; processing: boolean; processError: string | null; notice: string | null };
type Action =
    | { type: "add"; items: Item[] }
    | { type: "notice"; message: string | null }
    | { type: "buffered"; id: string; bytes: Blob }
    | { type: "remove"; id: string }
    | { type: "reset" }
    | { type: "runStart"; ids: string[] }
    | { type: "result"; id: string; ok: boolean; result: unknown; error: unknown; latencyMs?: number; timings?: Item["timings"] }
    | { type: "runError"; message: string }
    | { type: "runDone" };

function reducer(s: State, a: Action): State {
    switch (a.type) {
        case "add":
            return { ...s, items: [...s.items, ...a.items] };
        case "notice":
            return { ...s, notice: a.message };
        case "buffered":
            return { ...s, items: s.items.map((x) => x.id === a.id ? { ...x, bytes: a.bytes, status: "queued" } : x) };
        case "remove":
            return { ...s, items: s.items.filter((x) => x.id !== a.id) };
        case "reset":
            return { items: [], processing: false, processError: null, notice: null };
        case "runStart": {
            const ids = new Set(a.ids);
            return { ...s, processing: true, processError: null, items: s.items.map((x) => ids.has(x.id) ? { ...x, status: "processing" } : x) };
        }
        case "result":
            return { ...s, items: s.items.map((x) => x.id === a.id ? { ...x, status: "done", result: a.ok ? a.result : null, error: a.ok ? null : a.error, latencyMs: a.latencyMs, timings: a.timings } : x) };
        case "runError":
            // Revert any still-processing rows to queued so they can be retried.
            return { ...s, processError: a.message, items: s.items.map((x) => x.status === "processing" ? { ...x, status: "queued" } : x) };
        case "runDone":
            return { ...s, processing: false };
    }
}

export default function VerificationApp() {
    const [state, dispatch] = useReducer(reducer, { items: [], processing: false, processError: null, notice: null });
    const { items, processing, processError, notice } = state;
    useRegisterProcessing(processing); // warn on navigation while a run is active

    // Add applications (PDFs and/or images) as work items. `fromZip` tags those
    // that came out of an archive (display only). The server verifies every
    // queued item directly; the confidence-gated matcher is the guarantee, so
    // there is no client pre-flight gate.
    //
    // CHROME LARGE-UPLOAD FIX: read each file's bytes NOW, at intake, while its
    // on-disk snapshot is fresh, and hold them in memory — then upload those
    // bytes (see runVerification). Holding only the File and reading it lazily at
    // submit fails on managed devices: a sync daemon touching the file in between
    // drifts its snapshot, and Chrome then rejects the read with NOT_FOUND ("a
    // requested file or directory could not be found"). Reading at intake closes
    // that window; a genuinely unreadable file is reported now, not mid-run.
    const addDocs = useCallback((files: File[], fromZip: string | null) => {
        const incoming: Item[] = files.map((f) => ({
            id: uid(), name: f.name, kind: isPdf(f.name) ? "pdf" : "image", fromZip,
            status: "reading", result: null, file: f,
        }));
        if (!incoming.length) return;
        dispatch({ type: "add", items: incoming });
        for (const it of incoming) {
            it.file!.arrayBuffer().then(
                (buf) => dispatch({ type: "buffered", id: it.id, bytes: new Blob([buf], { type: it.file!.type || "application/pdf" }) }),
                () => {
                    dispatch({ type: "remove", id: it.id });
                    dispatch({ type: "notice", message: `Couldn't read "${it.name}". If it's on a cloud or network drive, copy it to a local folder and add it again.` });
                },
            );
        }
    }, []);

    // Expand a dropped ZIP in the browser; its PDFs/images join the same pipeline.
    const ingestZip = useCallback(async (file: File) => {
        const limitMb = Math.round(config.pdfZipMaxBytes / (1024 * 1024));
        if (file.size > config.pdfZipMaxBytes) {
            dispatch({ type: "notice", message: `${file.name} is too large to expand (over ${limitMb} MB).` });
            return;
        }
        dispatch({ type: "notice", message: `Extracting ${file.name}…` });
        await new Promise((r) => setTimeout(r, 0)); // let the notice paint before the synchronous unzip
        let result;
        try {
            result = extractZipDocs(new Uint8Array(await file.arrayBuffer()), {
                maxEntryBytes: config.pdfZipMaxEntryBytes,
                maxTotalBytes: config.pdfZipMaxTotalBytes,
            });
        } catch {
            dispatch({ type: "notice", message: `Couldn't read ${file.name} — not a valid ZIP.` });
            return;
        }
        if (!result.docs.length) {
            dispatch({ type: "notice", message: result.skipped.length
                ? `${file.name}: every file exceeded the size limit and was skipped.`
                : `${file.name} contained no PDFs or images.` });
            return;
        }
        addDocs(result.docs.map((d) =>
            new File([d.bytes as BlobPart], d.name, { type: d.kind === "pdf" ? "application/pdf" : "image/*" })), file.name);
        const n = result.docs.length;
        dispatch({ type: "notice", message: result.skipped.length
            ? `Added ${n} file${n === 1 ? "" : "s"} from ${file.name}; skipped ${result.skipped.length} oversized.`
            : null });
    }, [addDocs]);

    const addFiles = useCallback((fileList: FileList) => {
        const docs: File[] = [];
        for (const f of Array.from(fileList)) {
            if (isPdf(f.name) || isImage(f.name)) docs.push(f);
            else if (isZip(f.name)) void ingestZip(f);
        }
        addDocs(docs, null);
    }, [addDocs, ingestZip]);

    const removeItem = (id: string) => dispatch({ type: "remove", id });
    const reset = () => dispatch({ type: "reset" });

    const handleStreamLine = (evt: any) => {
        if (evt.type === "result") {
            dispatch({ type: "result", id: evt.id, ok: evt.ok, result: evt.result, error: evt.error, latencyMs: evt.latencyMs, timings: evt.timings });
        }
    };

    const runVerification = async () => {
        const pending = items.filter((it) => (it.kind === "pdf" || it.kind === "image") && it.status === "queued");
        if (pending.length === 0) return;
        dispatch({ type: "runStart", ids: pending.map((it) => it.id) });

        const body = new FormData();
        body.append("pairs", JSON.stringify(pending.map((it) => ({ id: it.id, name: it.name }))));
        // Upload the bytes captured at intake (see addDocs), not the File — this
        // is the Chrome large-upload fix: the browser sends from memory, never
        // re-reading a file whose on-disk snapshot may have drifted since drop.
        // One combined document per item is both form and label regions, so its
        // bytes are uploaded once and the server reuses them for both.
        // Tradeoff: buffered files live in memory until the run; fine for a
        // handful, but a 200-300 file bulk run wants per-file (or chunked) uploads.
        for (const it of pending) {
            body.append(`file_${it.id}`, it.bytes!, it.name);
        }

        try {
            const res = await fetch("/api/verify", { method: "POST", body });
            if (!res.ok || !res.body) {
                const msg = await res.text().catch(() => "");
                throw new Error(msg || `Server returned ${res.status}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
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

    const docItems = items.filter((it) => it.kind === "pdf" || it.kind === "image");
    const queuedCount = docItems.filter((it) => it.status === "queued").length;
    const readingCount = docItems.filter((it) => it.status === "reading").length;
    const doneCount = docItems.filter((it) => it.status === "done").length;
    const hasResults = doneCount > 0;
    const allDone = docItems.length > 0 && doneCount === docItems.length;

    const summary = docItems.reduce((a: Record<string, number>, it) => {
        if (it.result) a[it.result.overall] = (a[it.result.overall] || 0) + 1;
        return a;
    }, {});

    return (
        <>
            <Dropzone onFiles={addFiles} />

                {notice && (
                    <div className="mb-4 flex items-center justify-between gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                        <span>{notice}</span>
                        <button onClick={() => dispatch({ type: "notice", message: null })} aria-label="Dismiss"
                                className="flex shrink-0 rounded-md p-1 text-blue-400 hover:text-blue-600">
                            <X size={16} />
                        </button>
                    </div>
                )}

                {items.length > 0 && (
                    <FileQueue items={items} pdfCount={docItems.length} disabled={processing}
                               onRemove={removeItem} onClear={reset} />
                )}

                {processError && (
                    <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">
                        <AlertTriangle size={18} className="text-red-700" /> <span>{processError}</span>
                    </div>
                )}

                {items.length > 0 && (
                    <div className="mb-5">
                        {processing ? (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                                <Loader2 size={22} className="animate-spin text-blue-600" />
                                <span className="whitespace-nowrap text-base font-medium">Processing… {doneCount} of {docItems.length} done</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                                    <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${(doneCount / docItems.length) * 100}%` }} />
                                </div>
                            </div>
                        ) : (
                            <button onClick={runVerification} disabled={queuedCount === 0 || readingCount > 0}
                                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-6 py-5 text-xl font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                                <CheckCircle2 size={24} />
                                {readingCount > 0 ? "Reading files…" : hasResults ? "Process remaining" : `Process ${queuedCount} ${queuedCount === 1 ? "application" : "applications"}`}
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
                        <LatencySummary items={docItems.filter((it) => it.result)} />
                    </div>
                )}

                {hasResults && <ResultsTable items={docItems.filter((it) => it.result)} />}

                {/* Only when a verdict was actually persisted (errored items save
                    nothing), so the link never points at an empty history of this run. */}
                {docItems.some((it) => it.result) && !processing && <ReviewHistoryLink />}
        </>
    );
}
