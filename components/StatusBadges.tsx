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
