import React from "react";
import { FileText, X, Loader2, RotateCcw } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { OverallBadge, DetectChip } from "./StatusBadges";

export function FileQueue({ items, pdfCount, onRemove, onOverride, onClear, disabled }: {
    items: Item[]; pdfCount: number; disabled: boolean;
    onRemove: (id: string) => void; onOverride: (id: string) => void; onClear: () => void;
}) {
    return (
        <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
                <span className="text-sm font-semibold">{pdfCount} {pdfCount === 1 ? "application" : "applications"} to verify</span>
                <button onClick={onClear} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
                    <RotateCcw size={15} /> Clear all
                </button>
            </div>
            <div>
                {items.map((it) => (
                    <FileRow key={it.id} item={it} onRemove={() => onRemove(it.id)} onOverride={() => onOverride(it.id)} disabled={disabled} />
                ))}
            </div>
        </div>
    );
}

function FileRow({ item, onRemove, onOverride, disabled }:
                 { item: Item; onRemove: () => void; onOverride: () => void; disabled: boolean }) {
    const Icon = FileText;
    const d = item.detection;

    const stateText: Record<string, React.ReactNode> = {
        detecting:    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-blue-600"><Loader2 size={14} className="animate-spin" /> Checking…</span>,
        queued:       <span className="whitespace-nowrap text-xs font-medium text-green-700">Ready</span>,
        review:       <span className="whitespace-nowrap text-xs text-amber-600">Needs review</span>,
        processing:   <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-blue-600"><Loader2 size={14} className="animate-spin" /> Reading…</span>,
    };
    const statusNode = item.status === "done"
        ? (item.error ? <span className="whitespace-nowrap text-xs text-red-700">Failed</span> : null)
        : stateText[item.status];

    return (
        <div className="border-b border-slate-50 last:border-b-0">
            <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                <Icon size={18} className="shrink-0 text-slate-500" />
                <span className="flex-1 truncate text-slate-700">
                    {item.name}
                    {item.fromZip && <span className="ml-1.5 text-xs text-slate-400">in {item.fromZip}</span>}
                </span>
                {d && (
                    <span className="flex shrink-0 gap-1.5">
            <DetectChip ok={d.hasForm && d.formConfidence === "high"} warn={d.hasForm && d.formConfidence === "low"} label="Form" />
            <DetectChip ok={d.hasLabel && d.labelConfidence === "high"} warn={d.hasLabel && d.labelConfidence === "low"} label="Label" />
          </span>
                )}
                {item.result && <OverallBadge overall={item.result.overall} small />}
                {statusNode}
                {item.status !== "processing" && item.status !== "detecting" && (
                    <button onClick={onRemove} disabled={disabled} aria-label="Remove" className="flex rounded-md p-1 text-slate-300 hover:text-slate-500">
                        <X size={16} />
                    </button>
                )}
            </div>
            {item.status === "review" && d && (
                <div className="flex items-start justify-between gap-3 bg-amber-50 px-4 pb-3 pl-[46px]">
                    <div className="flex flex-1 flex-col gap-0.5">
                        {d.notes.map((n, i) => <div key={i} className="text-xs text-amber-800">• {n}</div>)}
                    </div>
                    <button onClick={onOverride} disabled={disabled}
                            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-100">
                        Process anyway
                    </button>
                </div>
            )}
        </div>
    );
}
