/**
 * Pure region-detection heuristic — "does this document look like a filled COLA
 * form with an affixed label?". It operates on already-extracted SIGNALS (text +
 * image count), never on a file or any I/O, so it stays framework-free and
 * unit-testable. The runtime-specific work (reading those signals from a File in
 * the browser) lives in the thin adapter detectClient.ts.
 */

type DetectConfidence = "high" | "low";

export interface RegionDetection {
    hasForm: boolean;
    formConfidence: DetectConfidence;
    hasLabel: boolean;
    labelConfidence: DetectConfidence;
    /** "ready" only when both regions are found with high confidence. */
    status: "ready" | "review";
    notes: string[];
}

/** Signals an adapter must extract from the document for the rules to judge. */
export interface DetectionSignals {
    /** Decoded text (a real text layer, or a raw byte scan as a fallback). */
    text: string;
    /** Whether the document appears to contain a text layer at all. */
    hasTextLayer: boolean;
    /** Count of embedded raster images (the affixed label is one). */
    imageCount: number;
}

/**
 * TTB F 5100.31 template strings; ≥2 hits (whitespace-normalized) is a confident
 * "this is a COLA form". The form number and agency name are the most specific;
 * the field labels add margin. Markers like "PART I" and "OMB NO. 1513-0020" are
 * deliberately omitted — the template splits them across text runs, so they never
 * survive extraction and would only weaken the signal.
 */
const FORM_MARKERS = [
    "5100.31", "ALCOHOL AND TOBACCO TAX", "BRAND NAME", "SERIAL NUMBER",
    "PLANT REGISTRY", "TYPE OF PRODUCT", "NET CONTENTS", "CERTIFICATION",
];

/**
 * Apply the heuristic. Conservative by design: when a signal is ambiguous it
 * flags for review rather than guessing, because a wrong auto-pass feeds a
 * broken comparison downstream.
 */
export function evaluateRegions(signals: DetectionSignals): RegionDetection {
    const notes: string[] = [];
    // Normalize whitespace: PDF text extraction can leave odd spacing between
    // words, so collapse runs to a single space before matching multi-word markers.
    const up = signals.text.toUpperCase().replace(/\s+/g, " ");

    const hits = FORM_MARKERS.filter((m) => up.includes(m)).length;
    let hasForm = hits >= 2;
    let formConfidence: DetectConfidence = hits >= 2 ? "high" : "low";
    if (!hasForm && !signals.hasTextLayer) {
        // Flattened scan: no text layer to match. Assume present but
        // low-confidence so it routes to review, not rejection.
        hasForm = true;
        formConfidence = "low";
        notes.push("Form appears scanned (no text layer); Part I confirmed during extraction.");
    } else if (!hasForm) {
        notes.push("Could not find COLA form markers — is this the right document?");
    }

    const hasLabel = signals.imageCount > 0;
    const labelConfidence: DetectConfidence = signals.imageCount > 0 ? "high" : "low";
    if (!hasLabel) notes.push("No affixed label artwork detected — the label image may be missing.");

    const status: RegionDetection["status"] =
        hasForm && hasLabel && formConfidence === "high" && labelConfidence === "high" ? "ready" : "review";

    return { hasForm, formConfidence, hasLabel, labelConfidence, status, notes };
}
