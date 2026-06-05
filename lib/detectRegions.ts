/**
 * Server-side detection adapter (authoritative). Reads detection signals from
 * the PDF using pdf-lib for a real page count, then delegates the verdict to
 * the shared {@link evaluateRegions} rules. This is the trust boundary: the
 * verify route re-validates here regardless of what the client reported,
 * because a client "ready" flag can be bypassed or wrong.
 */
import { PDFDocument } from "pdf-lib";
import {
    evaluateRegions, IMAGE_XOBJECT_RE, TEXT_LAYER_RE,
    type RegionDetection,
} from "./detectionRules";

export type { RegionDetection } from "./detectionRules";

/**
 * @returns the detection verdict plus the document's page count.
 * @remarks The byte-scan for markers is adequate for digitally-produced forms;
 *   production should swap in a real text extractor (pdf.js) for scans.
 */
export async function detectRegions(pdfBytes: Uint8Array, _fileName?: string): Promise<RegionDetection & { pageCount: number }> {
    let doc: PDFDocument;
    try {
        doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    } catch {
        return { hasForm: false, formConfidence: "low", hasLabel: false, labelConfidence: "low",
            status: "review", notes: ["File could not be opened as a PDF."], pageCount: 0 };
    }
    const pageCount = doc.getPageCount();
    if (pageCount === 0) {
        return { hasForm: false, formConfidence: "low", hasLabel: false, labelConfidence: "low",
            status: "review", notes: ["PDF has no pages."], pageCount: 0 };
    }

    const text = decodeBytes(pdfBytes);
    const verdict = evaluateRegions({
        text,
        hasTextLayer: TEXT_LAYER_RE.test(text),
        imageCount: (text.match(IMAGE_XOBJECT_RE) || []).length,
    });
    return { ...verdict, pageCount };
}

function decodeBytes(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

export interface DetectedItem {
    id: string;
    name: string;
    detection: RegionDetection & { pageCount: number };
}

/** Detect a batch sequentially (cheap, CPU-bound; keeps memory flat). */
export async function detectBatch(files: { id: string; name: string; bytes: Uint8Array }[]): Promise<DetectedItem[]> {
    const out: DetectedItem[] = [];
    for (const f of files) out.push({ id: f.id, name: f.name, detection: await detectRegions(f.bytes, f.name) });
    return out;
}
