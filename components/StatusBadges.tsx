import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { OVERALL_META } from "@/lib/uiTypes";

export function OverallBadge({ overall, small }: { overall: string; small?: boolean }) {
    const meta = OVERALL_META[overall];
    return (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg font-semibold ${meta.chipBg} ${meta.chipText} ${
            small ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-[13px]"}`}>
      <meta.Icon size={small ? 13 : 15} /> {meta.label}
    </span>
    );
}

export function DetectChip({ ok, warn, label }: { ok: boolean; warn: boolean; label: string }) {
    const cls = ok ? "bg-green-100 text-green-700" : warn ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
    const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
    return (
        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${cls}`}>
      <Icon size={12} /> {label}
    </span>
    );
}
