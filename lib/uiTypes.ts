import type { ComponentType } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Eye } from "lucide-react";
import type { ItemTimings, BatchErrorInfo } from "./orchestration";
import type { VerificationResult } from "./schema";

export type ItemStatus = "queued" | "processing" | "done";

export type Item = {
    id: string; name: string; kind: "pdf" | "image" | "csv"; fromZip: string | null;
    status: ItemStatus;
    /** The verdict once done; null while queued/processing or on a failed read. */
    result: VerificationResult | null;
    /** Present on a failed read (no verdict). */
    error?: BatchErrorInfo | null;
    file?: File;
    /** End-to-end processing time and per-stage breakdown, from the stream. */
    latencyMs?: number; timings?: ItemTimings;
};

/** An item that has a verdict — what the results table / summaries render. */
export type CompletedItem = Item & { result: VerificationResult };
export const isCompleted = (it: Item): it is CompletedItem => it.result !== null;

/** Compact human duration: "840 ms" under a second, "3.2s" above. */
export function formatLatency(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export const FIELD_LABELS: Record<string, string> = {
    brandName: "Brand name",
    classType: "Class / type",
    alcoholContent: "Alcohol content",
    netContents: "Net contents",
    producerNameAddress: "Producer & address",
    countryOfOrigin: "Country of origin",
    wineAppellation: "Wine appellation",
    sulfitesDeclaration: "Sulfite declaration",
    governmentWarning: "Government warning",
};

export const FIELD_ORDER = [
    "brandName", "classType", "alcoholContent", "netContents",
    "producerNameAddress", "countryOfOrigin", "wineAppellation", "sulfitesDeclaration", "governmentWarning",
];

type StatusMeta = { label: string; text: string; chipBg: string; chipText: string; Icon: ComponentType<any> | null };

export const STATUS_META: Record<string, StatusMeta> = {
    pass:          { label: "Pass",       text: "text-green-700", chipBg: "bg-green-100", chipText: "text-green-700", Icon: CheckCircle2 },
    review:        { label: "Review",     text: "text-amber-600", chipBg: "bg-amber-100", chipText: "text-amber-700", Icon: AlertTriangle },
    unreadable:    { label: "Unreadable", text: "text-amber-600", chipBg: "bg-amber-100", chipText: "text-amber-700", Icon: Eye },
    fail:          { label: "Fail",       text: "text-red-700",   chipBg: "bg-red-100",   chipText: "text-red-700",   Icon: XCircle },
    notApplicable: { label: "N/A",        text: "text-slate-400", chipBg: "bg-slate-100", chipText: "text-slate-500", Icon: null },
};

type OverallMeta = { label: string; chipBg: string; chipText: string; Icon: ComponentType<any> };

export const OVERALL_META: Record<string, OverallMeta> = {
    pass:        { label: "Passed",       chipBg: "bg-green-100", chipText: "text-green-700", Icon: CheckCircle2 },
    needsReview: { label: "Needs review", chipBg: "bg-amber-100", chipText: "text-amber-700", Icon: AlertTriangle },
    fail:        { label: "Failed",       chipBg: "bg-red-100",   chipText: "text-red-700",   Icon: XCircle },
};

let idc = 0;
export const uid = () => `f${++idc}`;
// File-type checks live in the framework-free mediaType module (shared with the
// server); re-exported here so UI code keeps importing them from one place.
export { isPdfName as isPdf, isImageName as isImage, isZipName as isZip, isCsvName as isCsv } from "./mediaType";

