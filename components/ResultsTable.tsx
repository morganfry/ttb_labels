import { useState } from "react";
import type { Item } from "@/lib/uiTypes";
import { FIELD_LABELS, FIELD_ORDER, STATUS_META } from "@/lib/uiTypes";
import { OverallBadge } from "./StatusBadges";
import { FieldCards } from "./FieldCards";

export function ResultsTable({ items }: { items: Item[] }) {
    const [expanded, setExpanded] = useState<string | null>(null);
    return (
        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px]">
                    <thead>
                    <tr>
                        <th className="sticky left-0 z-20 border-b-2 border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Application</th>
                        <th className="whitespace-nowrap border-b-2 border-slate-200 bg-slate-50 px-3.5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Overall</th>
                        {FIELD_ORDER.map((f) => (
                            <th key={f} className="whitespace-nowrap border-b-2 border-slate-200 bg-slate-50 px-3.5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{FIELD_LABELS[f]}</th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {items.map((it) => {
                        const byField = Object.fromEntries(it.result.fields.map((f: any) => [f.field, f]));
                        const open = expanded === it.id;
                        return <ResultRow key={it.id} it={it} byField={byField} open={open} onToggle={() => setExpanded(open ? null : it.id)} />;
                    })}
                    </tbody>
                </table>
            </div>
            <div className="border-t border-slate-100 px-3.5 py-2.5 text-center text-xs text-slate-400">
                Click any row to see extracted values and reasons.
            </div>
        </div>
    );
}

function ResultRow({ it, byField, open, onToggle }:
                   { it: Item; byField: Record<string, any>; open: boolean; onToggle: () => void }) {
    return (
        <>
            <tr onClick={onToggle} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white px-3.5 py-3 text-left">
                    <span className="inline-block max-w-[200px] truncate align-middle font-medium text-slate-700" title={it.name}>{it.name}</span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-3 text-center"><OverallBadge overall={it.result.overall} small /></td>
                {FIELD_ORDER.map((f) => {
                    const fr = byField[f];
                    const meta = STATUS_META[fr?.status || "notApplicable"];
                    return (
                        <td key={f} className={`whitespace-nowrap px-3.5 py-3 text-center ${meta.text} ${fr?.status === "pass" ? "font-medium" : "font-semibold"}`}>
                            {meta.label}
                        </td>
                    );
                })}
            </tr>
            {open && (
                <tr>
                    <td colSpan={2 + FIELD_ORDER.length} className="border-b border-slate-200 bg-slate-50 p-0">
                        <FieldCards fields={it.result.fields} />
                    </td>
                </tr>
            )}
        </>
    );
}
