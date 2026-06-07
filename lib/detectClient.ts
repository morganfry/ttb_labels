/**
 * Client-side detection — fast pre-upload feedback so the agent sees Form/Label
 * chips immediately, no round trip. It reads signals from a PDF in the browser
 * and applies the shared {@link evaluateRegions} rules.
 *
 * This is an ADVISORY pre-flight only: it drives the queue's "needs review /
 * Process anyway" UX, but does not gate processing. Correctness is enforced
 * downstream by the confidence-gated matcher (matching.ts), so a misdetected
 * document still resolves safely (low-confidence reads route to review).
 *
 * Signals come from PARSING the PDF (pdf-lib), not a raw byte scan. Combined COLA
 * PDFs are PDF 1.5+: their visible text and image XObjects live inside
 * FlateDecode-compressed object/content streams, so a byte scan sees only
 * compressed bytes and finds neither the form markers nor the label image —
 * which made every document falsely flag "no form" and "no label". Decoding the
 * streams recovers both.
 */
import { PDFName, PDFRawStream, PDFDocument, decodePDFRawStream } from "pdf-lib";
import { evaluateRegions, type DetectionSignals, type RegionDetection } from "./detectionRules";

export type { RegionDetection } from "./detectionRules";

const NOT_A_PDF: RegionDetection = {
    hasForm: false, formConfidence: "low", hasLabel: false, labelConfidence: "low",
    status: "review", notes: ["File could not be read as a PDF."],
};

export async function detectOne(file: File): Promise<RegionDetection> {
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return evaluateRegions(await extractPdfSignals(bytes));
    } catch {
        return NOT_A_PDF;
    }
}

/** latin1 maps bytes 1:1 to U+0000–00FF, preserving literal parens + ASCII text. */
const LATIN1 = new TextDecoder("latin1");

/**
 * Read detection signals from a PDF by decoding its streams.
 *  - imageCount: image XObjects anywhere in the document. The affixed label is a
 *    raster image; a template logo may add one too — fine, the rule only asks
 *    "is any artwork present".
 *  - text: visible text reconstructed from string literals in every non-image,
 *    non-font stream — page content AND Form XObjects, where the template's field
 *    labels live (so page-1 content alone is not enough). Pulling literals rather
 *    than raw operators joins kerned runs, so multi-word markers survive.
 *
 * Exported for unit testing; the File-reading half stays in {@link detectOne}.
 */
export async function extractPdfSignals(bytes: Uint8Array): Promise<DetectionSignals> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    let imageCount = 0;
    let text = "";
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const subtype = obj.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.toString();
        if (subtype === "/Image") { imageCount++; continue; }
        // Skip embedded font programs (Length1 marks them): decoding only yields
        // binary noise and wastes time inflating large glyph tables.
        if (obj.dict.get(PDFName.of("Length1")) !== undefined) continue;
        try {
            text += pullLiterals(decodePDFRawStream(obj).decode());
        } catch {
            // Unsupported filter (e.g. an image we didn't tag /Image) — skip it.
        }
    }
    return { text, hasTextLayer: /[A-Za-z]/.test(text), imageCount };
}

/**
 * Reconstruct visible text from a content stream's PDF string literals. Text is
 * shown as either literal strings `( ... )` or hex strings `< ... >`, and
 * generators differ (the TTB fixtures use literals; pdf-lib and many others use
 * hex) — so handle both, or detection breaks on half of real-world PDFs.
 * Concatenating string pieces also rejoins kerned `TJ` runs, so multi-word
 * markers like "BRAND NAME" survive.
 */
function pullLiterals(decoded: Uint8Array): string {
    const s = LATIN1.decode(decoded);
    let out = "";
    // Literal strings: ( ... ); leave escapes as-is (marker matching needs no
    // octal decoding).
    for (const m of s.match(/\((?:[^()\\]|\\.)*\)/g) || []) out += m.slice(1, -1);
    // Hex strings: < ... > (but not the `<<` dictionary delimiter — its contents
    // aren't pure hex, so the character class below never matches it).
    for (const m of s.match(/<([0-9A-Fa-f\s]+)>/g) || []) out += hexToStr(m.slice(1, -1));
    return out ? out + " " : "";
}

/** Decode a PDF hex string to characters (a trailing odd nibble pads with 0). */
function hexToStr(hex: string): string {
    const h = hex.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt((h.slice(i, i + 2) + "0").slice(0, 2), 16));
    return out;
}
