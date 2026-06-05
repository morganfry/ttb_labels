import { ChevronLeft, ChevronRight, Loader2, Inbox } from "lucide-react";
import type { Page } from "@/lib/searchTypes";
import { PAGE_SIZE } from "@/lib/searchTypes";
import { SearchResultRow } from "./SearchResultRow";

export function SearchResultsTable({ page, loading, hasFilters, offset, onPage }: {
    page: Page | null; loading: boolean; hasFilters: boolean; offset: number; onPage: (offset: number) => void;
}) {
    const total = page?.total ?? 0;
    const showingFrom = total === 0 ? 0 : offset + 1;
    const showingTo = Math.min(offset + PAGE_SIZE, total);
    const th = "border-b-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500";

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm text-slate-500">{loading ? "Searching…" : total === 0 ? "No results" : `${total} result${total === 1 ? "" : "s"}`}</span>
                {total > 0 && <span className="text-sm text-slate-500">Showing {showingFrom}–{showingTo}</span>}
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 size={20} className="animate-spin" /> Loading…</div>
            ) : !page || page.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
                    <Inbox size={32} strokeWidth={1.5} />
                    <span className="text-sm">{hasFilters ? "No reviews match these filters." : "No reviews yet."}</span>
                </div>
            ) : (
                <table className="w-full border-collapse text-sm">
                    <thead>
                    <tr>
                        <th className={`${th} text-left`}>Serial</th>
                        <th className={`${th} text-left`}>Brand</th>
                        <th className={`${th} text-left`}>Type</th>
                        <th className={`${th} text-center`}>Outcome</th>
                        <th className={`${th} text-left`}>Reviewed</th>
                    </tr>
                    </thead>
                    <tbody>{page.rows.map((r) => <SearchResultRow key={r.id} row={r} />)}</tbody>
                </table>
            )}

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                    <button onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                        <ChevronLeft size={16} /> Previous
                    </button>
                    <span className="text-sm text-slate-500">Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
                    <button onClick={() => onPage(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                        Next <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
