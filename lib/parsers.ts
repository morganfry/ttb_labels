/**
 * The two parsers — thin wrappers that pair a prompt with a validator and
 * call the shared {@link extract}. They differ only in prompt, output type,
 * and validation; the model is the same per-call parameter for both, so
 * tuning one independently is a single argument, not a refactor.
 */
import { extract, ExtractionInput, ExtractionResult } from "./extraction";
import { LABEL_PROMPT, FORM_PROMPT } from "./prompts";
import type { LabelExtraction, ExtractedField, ProductType, ProductSource } from "./schema";

/** Form fields carry a value + confidence (no `found` flag; the form is structured). */
export interface FormField<V = string> {
    value: V | null;
    confidence: "high" | "medium" | "low";
}

/** The form parser's output — COLA Part I values. */
export interface FormExtraction {
    serialNumber: FormField;
    productType: FormField<ProductType>;
    source: FormField<ProductSource>;
    brandName: FormField;
    fancifulName: FormField;
    applicantNameAddress: FormField;
    grapeVarietals: FormField;
    wineAppellation: FormField;
}

/** Extract label fields from a label image/PDF. Pass an array of inputs to
 *  transcribe several views (front/back/neck) of one label in a single call. */
export function parseLabel(input: ExtractionInput | ExtractionInput[], model?: string, signal?: AbortSignal): Promise<ExtractionResult<LabelExtraction>> {
    return extract<LabelExtraction>({ input, systemPrompt: LABEL_PROMPT, model, signal, validate: validateLabel });
}

/** Extract Part I from a COLA form (page 1). */
export function parseForm(input: ExtractionInput, model?: string, signal?: AbortSignal): Promise<ExtractionResult<FormExtraction>> {
    return extract<FormExtraction>({ input, systemPrompt: FORM_PROMPT, model, signal, validate: validateForm });
}

const CONF = new Set(["high", "medium", "low"]);

// Validators narrow `unknown` to the expected shape: lenient about extra
// keys, strict about the keys we depend on. Returning null signals a shape
// mismatch, which extract() converts into a classified ExtractionError.

function isField(x: unknown): x is ExtractedField {
    if (typeof x !== "object" || x === null) return false;
    const f = x as Record<string, unknown>;
    return (typeof f.value === "string" || f.value === null)
        && typeof f.found === "boolean"
        && typeof f.confidence === "string" && CONF.has(f.confidence);
}

function isFormField(x: unknown): x is FormField {
    if (typeof x !== "object" || x === null) return false;
    const f = x as Record<string, unknown>;
    return (typeof f.value === "string" || f.value === null)
        && typeof f.confidence === "string" && CONF.has(f.confidence);
}

function validateLabel(parsed: unknown): LabelExtraction | null {
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const fieldKeys: (keyof LabelExtraction)[] = [
        "brandName", "fancifulName", "classType", "alcoholContent", "netContents",
        "producerNameAddress", "countryOfOrigin", "wineAppellation", "sulfitesDeclaration", "governmentWarning",
    ];
    for (const k of fieldKeys) if (!isField(p[k])) return null;
    const wf = p.warningFormatting as Record<string, unknown> | undefined;
    if (!wf || typeof wf.headerAllCaps !== "boolean" || typeof wf.headerBold !== "boolean") return null;
    return parsed as LabelExtraction;
}

function validateForm(parsed: unknown): FormExtraction | null {
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const keys: (keyof FormExtraction)[] = [
        "serialNumber", "productType", "source", "brandName",
        "fancifulName", "applicantNameAddress", "grapeVarietals", "wineAppellation",
    ];
    for (const k of keys) if (!isFormField(p[k])) return null;
    // Enum sanity on the two controlling fields (null = not checked is allowed).
    const pt = (p.productType as FormField).value;
    if (pt !== null && !["wine", "distilledSpirits", "maltBeverages"].includes(pt as string)) return null;
    const src = (p.source as FormField).value;
    if (src !== null && !["domestic", "imported"].includes(src as string)) return null;
    return parsed as FormExtraction;
}

/** Test-only access to the private validators. Not part of the public API;
 *  the underscore prefix marks it as internal. */
export const __test = { validateLabel, validateForm };
