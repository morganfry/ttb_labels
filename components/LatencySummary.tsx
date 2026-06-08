"use client";

import { Clock } from "lucide-react";
import { useClientConfig } from "./ClientConfigProvider";
import { formatLatency, type Item } from "@/lib/uiTypes";

/**
 * Run-level latency rollup, shown once a batch finishes. The compliance team's
 * acceptance bar is a per-label time ("about 5 seconds"), so this reports the
 * distribution (median / p95) and, most importantly, how many items cleared the
 * target — turning the requirement into something the agent can actually see and
 * the evaluator can verify, rather than an unstated hope.
 */

/** Nearest-rank percentile on an already-ascending array. */
function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.ceil(p * sortedAsc.length) - 1;
    return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))];
}

export function LatencySummary({ items }: { items: Item[] }) {
    const TARGET = useClientConfig().latencyTargetMs;
    const times = items
        .map((it) => it.latencyMs)
        .filter((n): n is number => typeof n === "number")
        .sort((a, b) => a - b);
    if (times.length === 0) return null;

    const median = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    const underTarget = times.filter((t) => t <= TARGET).length;
    const allUnder = underTarget === times.length;
    const tone = allUnder ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900";

    return (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3.5 py-2.5 text-sm ${tone}`}>
            <span className="inline-flex items-center gap-1.5 font-semibold"><Clock size={15} /> Processing time</span>
            <span>median <strong>{formatLatency(median)}</strong></span>
            <span>p95 <strong>{formatLatency(p95)}</strong></span>
            <span className={allUnder ? "" : "font-semibold"}>{underTarget}/{times.length} under {formatLatency(TARGET)} target</span>
        </div>
    );
}
