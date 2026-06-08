import React from "react";
import { FileText, X, Loader2, RotateCcw } from "lucide-react";
import type { Item } from "@/lib/uiTypes";
import { OverallBadge } from "./StatusBadges";

export function FileQueue({ items, pdfCount, onRemove, onClear, disabled }: {
    items: Item[]; pdfCount: number; disabled: boolean;
    onRemove: (id: string) => void; onClear: () => void;
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
                    <FileRow key={it.id} item={it} onRemove={() => onRemove(it.id)} disabled={disabled} />
                ))}
            </div>
        </div>
    );
}

function FileRow({ item, onRemove, disabled }:
                 { item: Item; onRemove: () => void; disabled: boolean }) {
    const Icon = FileText;

    const stateText: Record<string, React.ReactNode> = {
        reading:      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-blue-600"><Loader2 size={14} className="animate-spin" /> Loading…</span>,
        queued:       <span className="whitespace-nowrap text-xs font-medium text-green-700">Ready</span>,
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
                {item.result && <OverallBadge overall={item.result.overall} small />}
                {statusNode}
                {item.status !== "processing" && (
                    <button onClick={onRemove} disabled={disabled} aria-label="Remove" className="flex rounded-md p-1 text-slate-300 hover:text-slate-500">
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
