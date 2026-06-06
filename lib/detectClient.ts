/**
 * Client-side detection — fast pre-upload feedback so the agent sees Form/Label
 * chips immediately, no round trip. It reads signals from a File in the browser
 * and applies the shared {@link evaluateRegions} rules.
 *
 * This is an ADVISORY pre-flight only: it drives the queue's "needs review /
 * Process anyway" UX, but does not gate processing. Correctness is enforced
 * downstream by the confidence-gated matcher (matching.ts), so a misdetected
 * document still resolves safely (low-confidence reads route to review).
 */
import {
    evaluateRegions, IMAGE_XOBJECT_RE, TEXT_LAYER_RE,
    type RegionDetection,
} from "./detectionRules";

export type { RegionDetection } from "./detectionRules";

export async function detectOne(file: File): Promise<RegionDetection> {
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        // Scan a prefix; the template markers appear early in the document.
        const cap = Math.min(buf.length, 400000);
        let s = "";
        for (let i = 0; i < cap; i++) s += String.fromCharCode(buf[i]);

        return evaluateRegions({
            text: s,
            hasTextLayer: TEXT_LAYER_RE.test(s),
            imageCount: (s.match(IMAGE_XOBJECT_RE) || []).length,
        });
    } catch {
        return { hasForm: false, formConfidence: "low", hasLabel: false, labelConfidence: "low",
            status: "review", notes: ["File could not be read as a PDF."] };
    }
}
