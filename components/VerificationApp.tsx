"use client";

import { useReducer, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { uid, isPdf, isImage, isZip, OVERALL_META, isCompleted } from "@/lib/uiTypes";
import { readNdjsonStream, type StreamEvent } from "@/lib/ndjsonStream";
import type { VerificationResult } from "@/lib/schema";
import type { BatchErrorInfo } from "@/lib/orchestration";
import { useClientConfig } from "./ClientConfigProvider";
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
    | { type: "remove"; id: string }
    | { type: "reset" }
    | { type: "runStart"; ids: string[] }
    | { type: "result"; id: string; ok: boolean; result: VerificationResult | null; error: BatchErrorInfo | null; latencyMs?: number; timings?: Item["timings"] }
    | { type: "runError"; message: string }
    | { type: "runDone" };

function reducer(s: State, a: Action): State {
    switch (a.type) {
        case "add":
            return { ...s, items: [...s.items, ...a.items] };
        case "notice":
            return { ...s, notice: a.message };
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
    const cfg = useClientConfig();
    const [state, dispatch] = useReducer(reducer, { items: [], processing: false, processError: null, notice: null });
    const { items, processing, processError, notice } = state;
    useRegisterProcessing(processing); // warn on navigation while a run is active

    // Add applications (PDFs and/or images) as work items, queued for the run.
    // `fromZip` tags those that came out of an archive (display only). The server
    // verifies every queued item directly; the confidence-gated matcher is the
    // guarantee, so there is no client pre-flight gate.
    const addDocs = useCallback((files: File[], fromZip: string | null) => {
        const incoming: Item[] = files.map((f) => ({
            id: uid(), name: f.name, kind: isPdf(f.name) ? "pdf" : "image", fromZip,
            status: "queued", result: null, file: f,
        }));
        if (!incoming.length) return;
        dispatch({ type: "add", items: incoming });
    }, []);

    // Expand a dropped ZIP in the browser; its PDFs/images join the same pipeline.
    const ingestZip = useCallback(async (file: File) => {
        const limitMb = Math.round(cfg.pdfZipMaxBytes / (1024 * 1024));
        if (file.size > cfg.pdfZipMaxBytes) {
            dispatch({ type: "notice", message: `${file.name} is too large to expand (over ${limitMb} MB).` });
            return;
        }
        dispatch({ type: "notice", message: `Extracting ${file.name}…` });
        await new Promise((r) => setTimeout(r, 0)); // let the notice paint before the synchronous unzip
        let result;
        try {
            result = extractZipDocs(new Uint8Array(await file.arrayBuffer()), {
                maxEntryBytes: cfg.pdfZipMaxEntryBytes,
                maxTotalBytes: cfg.pdfZipMaxTotalBytes,
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
    }, [addDocs, cfg]);

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

    const handleStreamLine = (evt: StreamEvent) => {
        if (evt.type === "result") {
            dispatch({ type: "result", id: evt.id, ok: evt.ok, result: evt.ok ? evt.result : null, error: evt.ok ? null : evt.error, latencyMs: evt.latencyMs, timings: evt.timings });
        } else if (evt.type === "error") {
            // The server hit a fatal error after the stream opened. Surface it and
            // revert still-"processing" rows to queued — otherwise they stick in
            // "processing" forever (runDone only flips the processing flag).
            dispatch({ type: "runError", message: evt.message || "Processing failed on the server." });
        }
    };

    const runVerification = async () => {
        const pending = items.filter((it) => (it.kind === "pdf" || it.kind === "image") && it.status === "queued");
        if (pending.length === 0) return;
        dispatch({ type: "runStart", ids: pending.map((it) => it.id) });

        const body = new FormData();
        body.append("pairs", JSON.stringify(pending.map((it) => ({ id: it.id, name: it.name }))));
        // One combined document per item serves as both the form and label
        // regions, so upload its bytes once — the server reuses them for both.
        for (const it of pending) {
            body.append(`file_${it.id}`, it.file!, it.name);
        }

        try {
            const res = await fetch("/api/verify", { method: "POST", body });
            if (!res.ok || !res.body) {
                const msg = await res.text().catch(() => "");
                throw new Error(msg || `Server returned ${res.status}`);
            }
            await readNdjsonStream(res, handleStreamLine);
        } catch (e) {
            dispatch({ type: "runError", message: e instanceof Error ? e.message : "Processing failed." });
        } finally {
            dispatch({ type: "runDone" });
        }
    };

    const docItems = items.filter((it) => it.kind === "pdf" || it.kind === "image");
    const queuedCount = docItems.filter((it) => it.status === "queued").length;
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
                            <button onClick={runVerification} disabled={queuedCount === 0}
                                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-6 py-5 text-xl font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                                <CheckCircle2 size={24} />
                                {hasResults ? "Process remaining" : `Process ${queuedCount} ${queuedCount === 1 ? "application" : "applications"}`}
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
                        <LatencySummary items={docItems.filter(isCompleted)} />
                    </div>
                )}

                {hasResults && <ResultsTable items={docItems.filter(isCompleted)} />}

                {/* Only when a verdict was actually persisted (errored items save
                    nothing), so the link never points at an empty history of this run. */}
                {docItems.some((it) => it.result) && !processing && <ReviewHistoryLink />}
        </>
    );
}
