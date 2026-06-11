import { Search, X } from "lucide-react";
import type { Filters } from "@/lib/searchTypes";

export function SearchFilters({ filters, onChange, onSubmit, onClear, hasFilters }: {
    filters: Filters;
    onChange: (k: keyof Filters, v: string) => void;
    onSubmit: () => void; onClear: () => void; hasFilters: boolean;
}) {
    const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
    const select = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
    return (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Serial number">
                    <input value={filters.serial} onChange={(e) => onChange("serial", e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="e.g. 24-1" className={input} />
                </Field>
                <Field label="Brand">
                    <input value={filters.brand} onChange={(e) => onChange("brand", e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="partial name ok" className={input} />
                </Field>
                <Field label="Outcome">
                    <select value={filters.overall} onChange={(e) => onChange("overall", e.target.value)} className={select}>
                        <option value="">Any</option><option value="pass">Passed</option><option value="needsReview">Needs review</option><option value="fail">Failed</option><option value="error">Error</option>
                    </select>
                </Field>
                <Field label="Product type">
                    <select value={filters.productType} onChange={(e) => onChange("productType", e.target.value)} className={select}>
                        <option value="">Any</option><option value="wine">Wine</option><option value="distilledSpirits">Distilled Spirits</option><option value="maltBeverages">Malt Beverages</option>
                    </select>
                </Field>
                <Field label="From date">
                    <input type="date" value={filters.fromDate} onChange={(e) => onChange("fromDate", e.target.value)} className={input} />
                </Field>
                <Field label="To date">
                    <input type="date" value={filters.toDate} onChange={(e) => onChange("toDate", e.target.value)} className={input} />
                </Field>
            </div>
            <div className="mt-4 flex items-center gap-3">
                <button onClick={onSubmit} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                    <Search size={16} /> Search
                </button>
                {hasFilters && (
                    <button onClick={onClear} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
                        <X size={15} /> Clear filters
                    </button>
                )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            {children}
        </label>
    );
}

