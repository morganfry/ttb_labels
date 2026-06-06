"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Filters, Page } from "@/lib/searchTypes";
import { EMPTY_FILTERS, PAGE_SIZE } from "@/lib/searchTypes";
import { SearchFilters } from "./SearchFilters";
import { SearchResultsTable } from "./SearchResultsTable";

const FILTER_KEYS = ["serial", "brand", "overall", "productType", "fromDate", "toDate"] as const;

/** The applied filters live in the URL — shareable, refresh-safe, back/forward-aware. */
function filtersFromParams(params: ReadonlyURLSearchParams | URLSearchParams): Filters {
    const f = { ...EMPTY_FILTERS };
    for (const k of FILTER_KEYS) f[k] = params.get(k) ?? "";
    return f;
}

async function fetchPage(applied: Filters, offset: number): Promise<Page> {
    const qs = new URLSearchParams();
    if (applied.serial) qs.set("serial", applied.serial);
    if (applied.brand) qs.set("brand", applied.brand);
    if (applied.overall) qs.set("overall", applied.overall);
    if (applied.productType) qs.set("productType", applied.productType);
    if (applied.fromDate) qs.set("fromDate", applied.fromDate);
    if (applied.toDate) qs.set("toDate", new Date(applied.toDate + "T23:59:59").toISOString());
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(offset));
    const res = await fetch(`/api/search?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
    return data as Page;
}

export default function SearchView() {
    const router = useRouter();
    const params = useSearchParams();
    const paramKey = params.toString();

    const applied = filtersFromParams(params);
    const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
    const hasFilters = FILTER_KEYS.some((k) => applied[k]);

    // Draft = the form inputs, edited locally until Search commits them to the URL.
    // Re-seed from the URL whenever it changes (covers back/forward and Clear).
    const [draft, setDraft] = useState<Filters>(applied);
    useEffect(() => { setDraft(filtersFromParams(params)); }, [paramKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const { data: page, isPending, error } = useQuery({
        queryKey: ["search", applied, offset],
        queryFn: () => fetchPage(applied, offset),
        placeholderData: keepPreviousData, // keep prior rows visible across pagination
    });

    const writeUrl = (f: Filters, off: number) => {
        const qs = new URLSearchParams();
        for (const k of FILTER_KEYS) if (f[k]) qs.set(k, f[k]);
        if (off) qs.set("offset", String(off));
        router.replace(qs.toString() ? `/search?${qs.toString()}` : "/search");
    };

    const submit = () => writeUrl(draft, 0);
    const clear = () => { setDraft(EMPTY_FILTERS); writeUrl(EMPTY_FILTERS, 0); };
    const goto = (off: number) => writeUrl(applied, off);
    const onChange = (k: keyof Filters, v: string) => setDraft((p) => ({ ...p, [k]: v }));

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-900">
            <div className="mx-auto max-w-5xl">
                <header className="mb-6">
                    <h1 className="mb-1.5 text-3xl font-bold">Review History</h1>
                    <p className="text-base text-slate-500">Search past label verification results.</p>
                </header>
                <SearchFilters filters={draft} onChange={onChange} onSubmit={submit} onClear={clear} hasFilters={hasFilters} />
                {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800">{error instanceof Error ? error.message : "Search failed."}</div>}
                <SearchResultsTable page={page ?? null} loading={isPending} hasFilters={hasFilters} offset={offset} onPage={goto} />
            </div>
        </div>
    );
}
