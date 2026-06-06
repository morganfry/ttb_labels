import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, FileText } from "lucide-react";
import type { Summary } from "@/lib/searchTypes";
import { PRODUCT_LABELS, formatDate } from "@/lib/searchTypes";
import { OverallBadge } from "./StatusBadges";
import { FieldCards } from "./FieldCards";

export function SearchResultRow({ row }: { row: Summary }) {
    const [open, setOpen] = useState(false);

    // Detail loads only when the row is expanded; cached afterward, so collapsing
    // and re-expanding doesn't re-fetch.
    const { data: detail, isLoading: loadingDetail, error: detailError } = useQuery({
        queryKey: ["result", row.id],
        enabled: open,
        queryFn: async () => {
            const res = await fetch(`/api/results/${encodeURIComponent(row.id)}`);
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            return res.json();
        },
    });

    const toggle = () => setOpen((o) => !o);

    return (
        <>
            <tr onClick={toggle} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700">{row.serialNumber}</td>
                <td className="px-4 py-3 text-slate-700">{row.brandName ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-3 text-slate-600">{PRODUCT_LABELS[row.productType] ?? row.productType}</td>
                <td className="px-4 py-3 text-center"><OverallBadge overall={row.overall} small /></td>
                <td className="px-4 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
            </tr>
            {open && (
                <tr>
                    <td colSpan={5} className="border-b border-slate-200 bg-slate-50 p-0">
                        {loadingDetail ? (
                            <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading details…</div>
                        ) : detailError ? (
                            <div className="flex items-center gap-2 px-4 py-5 text-sm text-red-500"><FileText size={16} /> {detailError instanceof Error ? detailError.message : "Failed to load details."}</div>
                        ) : detail ? (
                            <FieldCards fields={detail.fields} />
                        ) : (
                            <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-400"><FileText size={16} /> Detail unavailable.</div>
                        )}
                    </td>
                </tr>
            )}
        </>
    );
}
