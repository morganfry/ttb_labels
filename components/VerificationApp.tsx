"use client";

import { useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { uid, isPdf, isZip, OVERALL_META } from "@/lib/uiTypes";
import { detectOne } from "@/lib/detectClient";
import { Dropzone } from "./Dropzone";
import { FileQueue } from "./FileQueue";
import { ResultsTable } from "./ResultsTable";
import { useRegisterProcessing } from "./ProcessingGuard";

export default function VerificationApp() {
    const [items, setItems] = useState<Item[]>([]);
    const [processing, setProcessing] = useState(false);
    const [processError, setProcessError] = useState<string | null>(null);
    useRegisterProcessing(processing); // warn on navigation while a run is active

    const addFiles = useCallback((fileList: FileList) => {
        const incoming: Item[] = [];
        for (const f of Array.from(fileList)) {
            if (isPdf(f.name)) incoming.push({ id: uid(), name: f.name, kind: "pdf", fromZip: null, status: "detecting", result: null, file: f, detection: null });
            else if (isZip(f.name)) incoming.push({ id: uid(), name: f.name, kind: "zip", fromZip: null, status: "needsExtract", result: null, file: f });
        }
        if (!incoming.length) return;
        setItems((prev) => [...prev, ...incoming]);
        incoming.filter((it) => it.kind === "pdf").forEach((it) => {
            detectOne(it.file!).then((detection) => {
                setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, detection, status: detection.status === "ready" ? "queued" : "review" } : x));
            });
        });
    }, []);

    const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));
    const overrideToReady = (id: string) => setItems((prev) => prev.map((x) => x.id === id ? { ...x, status: "queued" } : x));
    const reset = () => { setItems([]); setProcessing(false); setProcessError(null); };

    const handleStreamLine = (evt: any) => {
        if (evt.type === "result") {
            setItems((prev) => prev.map((x) => x.id === evt.id ? { ...x, status: "done", result: evt.ok ? evt.result : null, error: evt.ok ? null : evt.error } : x));
        }
    };

    const runVerification = async () => {
        const pending = items.filter((it) => it.kind === "pdf" && it.status === "queued");
        if (pending.length === 0) return;
        setProcessing(true); setProcessError(null);

        const body = new FormData();
        body.append("pairs", JSON.stringify(pending.map((it) => ({ id: it.id, name: it.name }))));
        for (const it of pending) {
            body.append(`label_${it.id}`, it.file!, it.name);
            body.append(`form_${it.id}`, it.file!, it.name);
            setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, status: "processing" } : x));
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
            setProcessError(e instanceof Error ? e.message : "Processing failed.");
            setItems((prev) => prev.map((x) => x.status === "processing" ? { ...x, status: "queued" } : x));
        } finally {
            setProcessing(false);
        }
    };

    const pdfItems = items.filter((it) => it.kind === "pdf");
    const queuedCount = pdfItems.filter((it) => it.status === "queued").length;
    const reviewCount = pdfItems.filter((it) => it.status === "review").length;
    const detectingCount = pdfItems.filter((it) => it.status === "detecting").length;
    const doneCount = pdfItems.filter((it) => it.status === "done").length;
    const hasResults = doneCount > 0;
    const allDone = pdfItems.length > 0 && doneCount === pdfItems.length;

    const summary = pdfItems.reduce((a: Record<string, number>, it) => {
        if (it.result) a[it.result.overall] = (a[it.result.overall] || 0) + 1;
        return a;
    }, {});

    return (
        <>
            <Dropzone onFiles={addFiles} />

                {items.length > 0 && (
                    <FileQueue items={items} pdfCount={pdfItems.length} disabled={processing}
                               onRemove={removeItem} onOverride={overrideToReady} onClear={reset} />
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
                                <span className="whitespace-nowrap text-base font-medium">Processing… {doneCount} of {pdfItems.length} done</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                                    <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${(doneCount / pdfItems.length) * 100}%` }} />
                                </div>
                            </div>
                        ) : (
                            <>
                                <button onClick={runVerification} disabled={queuedCount === 0 || detectingCount > 0}
                                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-6 py-5 text-xl font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                                    <CheckCircle2 size={24} />
                                    {detectingCount > 0 ? "Checking documents…" : hasResults ? "Process remaining" : `Process ${queuedCount} ${queuedCount === 1 ? "application" : "applications"}`}
                                </button>
                                {reviewCount > 0 && (
                                    <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
                                        <AlertTriangle size={16} className="text-amber-600" />
                                        {reviewCount} {reviewCount === 1 ? "document needs" : "documents need"} review before processing — check the flagged rows above.
                                    </div>
                                )}
                            </>
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

                {hasResults && <ResultsTable items={pdfItems.filter((it) => it.result)} />}
        </>
    );
}
