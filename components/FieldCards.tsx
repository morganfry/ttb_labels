import { FIELD_LABELS, STATUS_META } from "@/lib/uiTypes";

export function FieldCards({ fields }: { fields: any[] }) {
    return (
        <div className="grid gap-3 p-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {fields.map((fr) => {
                const meta = STATUS_META[fr.status];
                return (
                    <div key={fr.field} className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                        <span className="text-xs font-semibold text-slate-500">{FIELD_LABELS[fr.field] || fr.field}</span>
                        <span className={`text-[13px] font-bold ${meta.text}`}>{meta.label}</span>
                        {fr.labelValue != null && <span className="truncate text-[13px] text-slate-900">{fr.labelValue}</span>}
                        {fr.issues?.length > 0 && <span className="mt-0.5 text-xs text-amber-600">{fr.issues[0]}</span>}
                    </div>
                );
            })}
        </div>
    );
}
