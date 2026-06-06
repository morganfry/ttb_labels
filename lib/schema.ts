/**
 * Domain types and the rule configuration that drives verification.
 *
 * This module is the data contract for the whole pipeline. It deliberately
 * holds the matcher thresholds and product-type rulesets (not a generic
 * config file), because these values ARE the compliance logic — they belong
 * next to the field definitions they qualify, where a reviewer reads them
 * together.
 */

/** TTB product categories (COLA form item 5). Sake is filed as "wine". */
export type ProductType = "wine" | "distilledSpirits" | "maltBeverages";

/** Domestic vs. imported (COLA form item 3); drives the origin requirement. */
export type ProductSource = "domestic" | "imported";

/**
 * The application side of every comparison — values taken from the COLA
 * form's Part I. Field names track the form item numbers for traceability.
 *
 * Note: ABV and net contents have no Part I field; they are validated on the
 * label alone (see {@link FIELD_RULES}), never compared to the form.
 */
export interface ApplicationData {
    /** Item 4, e.g. "24-1". */
    serialNumber: string;
    /** Item 5 — selects which {@link ProductRuleset} applies. */
    productType: ProductType;
    /** Item 3 — when "imported", country of origin becomes required. */
    source: ProductSource;
    /** Item 6, required, matched against the label. */
    brandName: string;
    /** Item 7, optional. */
    fancifulName?: string;
    /** Item 8 — combined name + address block, matched against the label. */
    applicantNameAddress: string;
    /** Item 10, wine only. */
    grapeVarietals?: string;
    /** Item 11, wine only, present only if stated on the label. */
    wineAppellation?: string;
}

/** Per-field reading confidence reported by the extraction model. */
export type Confidence = "high" | "medium" | "low";

/**
 * One extracted field. The model transcribes verbatim and never judges:
 * `found: false` is a valid, meaningful answer (e.g. a missing warning),
 * and `confidence` lets the matcher down-rank a shaky read rather than
 * trusting it.
 */
export interface ExtractedField {
    /** Verbatim transcription, or null when the field is absent. */
    value: string | null;
    /** False when the field is not present on the label. */
    found: boolean;
    confidence: Confidence;
}

/**
 * Visual properties of the government-warning header that pure text loses.
 * Judged by the model from the image; the strict matcher consumes these.
 */
export interface WarningFormatting {
    headerAllCaps: boolean;
    headerBold: boolean;
}

/** Everything extracted from a label image, one ExtractedField per field. */
export interface LabelExtraction {
    brandName: ExtractedField;
    fancifulName: ExtractedField;
    classType: ExtractedField;
    alcoholContent: ExtractedField;
    netContents: ExtractedField;
    producerNameAddress: ExtractedField;
    countryOfOrigin: ExtractedField;
    wineAppellation: ExtractedField;
    sulfitesDeclaration: ExtractedField;
    governmentWarning: ExtractedField;
    warningFormatting: WarningFormatting;
}

/**
 * Which comparison strategy a field uses:
 * - `tolerant` — normalize + similarity score, with a review band
 * - `numeric`  — parse value + unit, compare within a tolerance
 * - `strict`   — exact canonical match, no tolerance
 * - `presence` — field must simply be present & well-formed
 */
type MatcherKind = "tolerant" | "numeric" | "strict" | "presence";

/** Per-field rule consumed by the matching dispatcher. */
export interface FieldRule {
    matcher: MatcherKind;
    /** Source of the value to compare against: the form, the label alone, or statute. */
    comparesTo: "form" | "labelOnly" | "statute";
    /** Whether absence is a failure (may be overridden per product type). */
    required: boolean;
    /** tolerant: fail below this similarity. */
    threshold?: number;
    /** tolerant: flag for review below this (but at/above `threshold`). */
    reviewBand?: number;
    /** tolerant: compare word sets, ignoring order. */
    tokenSet?: boolean;
    /**
     * tolerant: extra field-aware cleanup applied to BOTH sides before scoring,
     * to fold away label boilerplate the form omits.
     * - "address": strip a "BOTTLED BY"-style prefix and map full state names
     *   to abbreviations (so "…Charleston, South Carolina" ≡ "…Charleston, SC").
     * - "designation": drop a leading vintage year ("2023 Rosé" ≡ "Rosé").
     */
    normalize?: "address" | "designation";
    /** numeric: allowed absolute difference. */
    tolerance?: number;
    /** numeric: unit to normalize to before comparing. */
    unit?: "percent" | "ml";
}

/** Maps a label field to the {@link ApplicationData} field it compares against. */
export const FORM_COUNTERPART: Partial<Record<keyof LabelExtraction, keyof ApplicationData>> = {
    brandName: "brandName",
    fancifulName: "fancifulName",
    producerNameAddress: "applicantNameAddress",
    wineAppellation: "wineAppellation",
};

/**
 * The single source of truth for how each field is verified. The dispatcher
 * reads this; adding or retuning a field is a config edit, not a code change.
 *
 * Threshold rationale: brand/producer use a 0.85 floor with a 0.95 review
 * band so case/punctuation variants pass outright while genuine-but-close
 * differences route to a human. class/type uses tokenSet because word order
 * varies ("Kentucky Straight Bourbon" vs "Bourbon, Kentucky Straight").
 */
export const FIELD_RULES: Record<keyof LabelExtraction, FieldRule> = {
    brandName:           { matcher: "tolerant", comparesTo: "form",      required: true,  threshold: 0.85, reviewBand: 0.95 },
    fancifulName:        { matcher: "tolerant", comparesTo: "form",      required: false, threshold: 0.85, reviewBand: 0.95, normalize: "designation" },
    classType:           { matcher: "tolerant", comparesTo: "labelOnly", required: true,  threshold: 0.80, tokenSet: true },
    alcoholContent:      { matcher: "numeric",  comparesTo: "labelOnly", required: true,  tolerance: 0.1, unit: "percent" },
    netContents:         { matcher: "numeric",  comparesTo: "labelOnly", required: true,  tolerance: 0.01, unit: "ml" },
    producerNameAddress: { matcher: "tolerant", comparesTo: "form",      required: true,  threshold: 0.80, tokenSet: true, normalize: "address" },
    countryOfOrigin:     { matcher: "presence", comparesTo: "labelOnly", required: false },
    wineAppellation:     { matcher: "tolerant", comparesTo: "form",      required: false, threshold: 0.85 },
    sulfitesDeclaration: { matcher: "presence", comparesTo: "labelOnly", required: false },
    governmentWarning:   { matcher: "strict",   comparesTo: "statute",   required: true },
    warningFormatting:   { matcher: "strict",   comparesTo: "statute",   required: true },
};

/**
 * Type-specific rules selected by {@link ApplicationData.productType}. This
 * is what makes item 5 a controller rather than just another compared field:
 * it picks the tolerance band, which optional fields apply, and the
 * designation-specific ABV floors.
 */
export interface ProductRuleset {
    /** Allowed ABV variance — tighter for spirits, looser for wine. */
    abvTolerance: number;
    requiresAppellationCheck: boolean;
    requiresOriginIfImported: boolean;
    /** e.g. { rum: 40 } — a "rum" label may not state < 40% ABV. */
    abvMinByDesignation?: Record<string, number>;
    /** Malt beverages: ABV optional unless flavored / contains added alcohol. */
    abvOptional?: boolean;
    /**
     * Wine: ABV is mandatory only over 14% (optional, with conditions, for
     * 7–14% "table"/"light" wine). We can't read the value when it's absent,
     * so a missing ABV routes to review rather than a confident fail.
     */
    abvConditional?: boolean;
    /**
     * Wine: a sulfite declaration is required at ≥10 ppm SO₂ — a fact the form
     * doesn't carry — so a missing declaration routes to review, not fail.
     */
    requiresSulfitesDeclaration?: boolean;
}

export const RULESET_BY_TYPE: Record<ProductType, ProductRuleset> = {
    wine: {
        abvTolerance: 0.5,
        requiresAppellationCheck: true,
        requiresOriginIfImported: true,
        abvConditional: true,
        requiresSulfitesDeclaration: true,
    },
    distilledSpirits: {
        abvTolerance: 0.1,
        requiresAppellationCheck: false,
        requiresOriginIfImported: true,
        abvMinByDesignation: { rum: 40, gin: 40, vodka: 40, whisky: 40, whiskey: 40 },
    },
    maltBeverages: {
        abvTolerance: 0.3,
        requiresAppellationCheck: false,
        requiresOriginIfImported: true,
        abvOptional: true,
    },
};

/**
 * Canonical government warning (27 CFR 16.21). The strict matcher compares
 * against this exact string after collapsing whitespace only.
 *
 * IMPORTANT: verify this wording against the current regulation before any
 * real use — the strict check is only as correct as this constant, and a
 * subtly wrong value would fail every compliant label.
 */
export const TTB_GOVERNMENT_WARNING =
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should " +
    "not drink alcoholic beverages during pregnancy because of the risk of " +
    "birth defects. (2) Consumption of alcoholic beverages impairs your " +
    "ability to drive a car or operate machinery, and may cause health problems.";

/**
 * Per-field outcome.
 * - `unreadable` — low-confidence read; routed to a human, not failed.
 * - `notApplicable` — field doesn't apply to this product type.
 */
export type FieldStatus = "pass" | "review" | "fail" | "unreadable" | "notApplicable";

export interface FieldResult {
    field: keyof LabelExtraction;
    status: FieldStatus;
    labelValue: string | null;
    /** null for labelOnly / statute fields (nothing on the form to show). */
    applicationValue: string | null;
    /** tolerant matcher similarity, when applicable. */
    score?: number;
    /** Human-readable reasons, especially for a fail. */
    issues: string[];
}

export interface VerificationResult {
    serialNumber: string;
    productType: ProductType;
    overall: "pass" | "needsReview" | "fail";
    fields: FieldResult[];
}
