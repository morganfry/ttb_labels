"use client";

import { useState } from "react";
import { FileText, FileSpreadsheet } from "lucide-react";
import VerificationApp from "./VerificationApp";
import CsvVerify from "./CsvVerify";

type Mode = "pdf" | "csv";

const TABS: { mode: Mode; label: string; Icon: typeof FileText; hint: string }[] = [
    { mode: "pdf", label: "PDF upload", Icon: FileText, hint: "Upload combined application PDFs to check them against TTB requirements." },
    { mode: "csv", label: "CSV bulk", Icon: FileSpreadsheet, hint: "Upload a CSV of applications with label image URLs for bulk verification." },
];

export default function HomeTabs() {
    const [mode, setMode] = useState<Mode>("pdf");
    const active = TABS.find((t) => t.mode === mode)!;

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-900">
            <div className="mx-auto max-w-3xl">
                <header className="mb-5">
                    <h1 className="mb-1.5 text-3xl font-bold">Label Verification</h1>
                    <p className="text-base text-slate-500">{active.hint}</p>
                </header>

                <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
                    {TABS.map(({ mode: m, label, Icon }) => (
                        <button key={m} onClick={() => setMode(m)}
                                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                                    mode === m ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                            <Icon size={16} /> {label}
                        </button>
                    ))}
                </div>

                {mode === "pdf" ? <VerificationApp /> : <CsvVerify />}
            </div>
        </div>
    );
}
