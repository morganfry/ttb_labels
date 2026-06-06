import type { ComponentType } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Eye } from "lucide-react";

export type Detection = {
    hasForm: boolean; formConfidence: "high" | "low";
    hasLabel: boolean; labelConfidence: "high" | "low";
    status: "ready" | "review"; notes: string[];
};

export type Item = {
    id: string; name: string; kind: "pdf" | "zip" | "csv"; fromZip: string | null;
    status: string; result: any; error?: any; file?: File; detection?: Detection | null;
};

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
export const isPdf = (n: string) => /\.pdf$/i.test(n);
export const isZip = (n: string) => /\.(zip|7z|rar|tar|gz)$/i.test(n);

