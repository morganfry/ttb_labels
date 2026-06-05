/**
 * Mock extraction fixtures for end-to-end tests. Each scenario pairs a
 * LabelExtraction with a FormExtraction, representing what the parsers WOULD
 * return for a given combined PDF — so the pipeline can be exercised
 * deterministically without a model call. Scenarios trace to interview cases.
 */
import type { LabelExtraction, ExtractedField, Confidence } from "./schema";
import { TTB_GOVERNMENT_WARNING } from "./schema";
import type { FormExtraction, FormField } from "./parsers";

function f(value: string | null, confidence: Confidence = "high"): ExtractedField {
    return { value, found: value !== null, confidence };
}
function ff<V>(value: V, confidence?: Confidence): FormField<V>;
function ff(value: null, confidence?: Confidence): FormField<string>;
function ff(value: unknown, confidence: Confidence = "high"): FormField<unknown> {
    return { value, confidence };
}

export interface Scenario {
    name: string;
    label: LabelExtraction;
    form: FormExtraction;
    /** The verdict the pipeline should produce — asserted by the E2E test. */
    expectedOverall: "pass" | "needsReview" | "fail";
}

/** A clean, fully-compliant distilled-spirits application. */
const cleanLabel: LabelExtraction = {
    brandName: f("OLD TOM DISTILLERY"),
    fancifulName: f(null),
    classType: f("Kentucky Straight Bourbon Whiskey"),
    alcoholContent: f("45% Alc./Vol. (90 Proof)"),
    netContents: f("750 mL"),
    producerNameAddress: f("Old Tom Distillery, Bardstown, KY"),
    countryOfOrigin: f(null),
    wineAppellation: f(null),
    governmentWarning: f(TTB_GOVERNMENT_WARNING),
    warningFormatting: { headerAllCaps: true, headerBold: true },
};
const cleanForm: FormExtraction = {
    serialNumber: ff("24-1"),
    productType: ff("distilledSpirits"),
    source: ff("domestic"),
    brandName: ff("OLD TOM DISTILLERY"),
    fancifulName: ff(null),
    applicantNameAddress: ff("Old Tom Distillery, Bardstown, KY"),
    grapeVarietals: ff(null),
    wineAppellation: ff(null),
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const SCENARIOS: Scenario[] = [
    {
        name: "clean pass",
        label: cleanLabel,
        form: cleanForm,
        expectedOverall: "pass",
    },
    {
        name: "Dave: brand case/punctuation variant still passes",
        label: { ...clone(cleanLabel), brandName: f("STONE'S THROW") },
        form: { ...clone(cleanForm), brandName: ff("Stone's Throw") },
        expectedOverall: "pass",
    },
    {
        name: "brand near-match routes to review",
        label: { ...clone(cleanLabel), brandName: f("Stone's Throw Distillery") },
        form: { ...clone(cleanForm), brandName: ff("Stone's Throw Distillers") },
        expectedOverall: "needsReview",
    },
    {
        name: "Jenny: title-case warning header fails",
        label: { ...clone(cleanLabel), warningFormatting: { headerAllCaps: false, headerBold: true } },
        form: clone(cleanForm),
        expectedOverall: "fail",
    },
    {
        name: "missing warning fails",
        label: { ...clone(cleanLabel), governmentWarning: f(null) },
        form: clone(cleanForm),
        expectedOverall: "fail",
    },
    {
        name: "low-confidence brand read routes to unreadable (needsReview)",
        label: { ...clone(cleanLabel), brandName: f("0ld T0m Distillery", "low") },
        form: clone(cleanForm),
        expectedOverall: "needsReview",
    },
    {
        name: "imported product missing country of origin fails",
        label: { ...clone(cleanLabel), countryOfOrigin: f(null) },
        form: { ...clone(cleanForm), source: ff("imported") },
        expectedOverall: "fail",
    },
    {
        name: "wine with matching appellation passes",
        label: {
            ...clone(cleanLabel),
            classType: f("Cabernet Sauvignon"),
            alcoholContent: f("13.5% Alc./Vol."),
            wineAppellation: f("Napa Valley"),
        },
        form: {
            ...clone(cleanForm),
            productType: ff("wine"),
            wineAppellation: ff("Napa Valley"),
        },
        expectedOverall: "pass",
    },
    {
        name: "brand mismatch fails",
        label: { ...clone(cleanLabel), brandName: f("Eagle Rare") },
        form: clone(cleanForm),
        expectedOverall: "fail",
    },
];
