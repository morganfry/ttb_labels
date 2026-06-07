"use client";

import Link from "next/link";
import { History } from "lucide-react";

/**
 * Shortcut to the searchable Review History, shown under the results once a run
 * finishes. Every verdict is persisted as a side effect of the run, so this is
 * just navigation — no extra fetch. Shared by both verify screens (PDF and CSV)
 * so the affordance stays identical.
 */
export function ReviewHistoryLink() {
    return (
        <div className="mt-5 flex justify-center">
            <Link href="/search"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900">
                <History size={18} /> View in Review History
            </Link>
        </div>
    );
}
