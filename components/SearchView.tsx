"use client";

import { useState, useEffect, useCallback } from "react";
import type { Filters, Page } from "@/lib/searchTypes";
import { EMPTY_FILTERS, PAGE_SIZE } from "@/lib/searchTypes";
import { SearchFilters } from "./SearchFilters";
import { SearchResultsTable } from "./SearchResultsTable";

export default function SearchView() {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState<Page | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const runSearch = useCallback(async (f: Filters, off: number) => {
        setLoading(true); setError(null);
        const qs = new URLSearchParams();
        if (f.serial) qs.set("serial", f.serial);
        if (f.brand) qs.set("brand", f.brand);
        if (f.overall) qs.set("overall", f.overall);
        if (f.productType) qs.set("productType", f.productType);
        if (f.fromDate) qs.set("fromDate", f.fromDate);
        if (f.toDate) qs.set("toDate", new Date(f.toDate + "T23:59:59").toISOString());
        qs.set("limit", String(PAGE_SIZE));
        qs.set("offset", String(off));
        try {
            const res = await fetch(`/api/search?${qs.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
            setPage(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Search failed.");
            setPage(null);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { runSearch(EMPTY_FILTERS, 0); }, [runSearch]);

    const submit = () => { setApplied(filters); setOffset(0); runSearch(filters, 0); };
    const clear = () => { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setOffset(0); runSearch(EMPTY_FILTERS, 0); };
    const goto = (off: number) => { setOffset(off); runSearch(applied, off); };
    const onChange = (k: keyof Filters, v: string) => setFilters((p) => ({ ...p, [k]: v }));
    const hasFilters = Object.values(applied).some(Boolean);

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-900">
            <div className="mx-auto max-w-5xl">
                <header className="mb-6">
                    <h1 className="mb-1.5 text-3xl font-bold">Review History</h1>
                    <p className="text-base text-slate-500">Search past label verification results.</p>
                </header>
                <SearchFilters filters={filters} onChange={onChange} onSubmit={submit} onClear={clear} hasFilters={hasFilters} />
                {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">{error}</div>}
                <SearchResultsTable page={page} loading={loading} hasFilters={hasFilters} offset={offset} onPage={goto} />
            </div>
        </div>
    );
}
