/**
 * Verification core: three matchers and the dispatcher that routes each
 * field to the right one per {@link FIELD_RULES}.
 *
 * Design principle: the model transcribes, this code judges. All compliance
 * decisions live here in deterministic, unit-tested logic — never in the
 * model — which is what makes verdicts trustworthy and the tolerant/strict
 * split possible.
 */

import {
    FIELD_RULES, FORM_COUNTERPART, RULESET_BY_TYPE, TTB_GOVERNMENT_WARNING,
    type LabelExtraction, type ExtractedField, type WarningFormatting,
    type ApplicationData, type ProductType, type Confidence,
    type FieldResult, type FieldStatus, type VerificationResult,
} from "./schema";
import { normalize, collapseSpaces, similarity } from "./textNormalize";
import { parsePercent, parseVolumeMl } from "./unitParse";

// Re-export so importers/tests that pulled these from ./matching still work.
export { normalize, collapseSpaces, similarity } from "./textNormalize";
export { parsePercent, parseVolumeMl } from "./unitParse";

interface TolerantArgs {
    labelValue: string; appValue: string; threshold: number; reviewBand?: number; tokenSet?: boolean;
}

/**
 * Tolerant string match: three outcomes, not a binary. The review band is
 * the point — a near-but-inexact match (e.g. "Distillery" vs "Distillers")
 * routes to a human instead of a hard fail, preserving agent judgment for
 * the ambiguous cases while auto-passing the clearly-equivalent ones.
 */
function tolerantMatch(a: TolerantArgs): { status: FieldStatus; score: number; issues: string[] } {
    const score = similarity(a.labelValue, a.appValue, a.tokenSet);
    const review = a.reviewBand ?? a.threshold; // no band → no review zone
    if (score >= review) return { status: "pass", score, issues: [] };
    if (score >= a.threshold) return { status: "review", score, issues: [`Close but not exact (similarity ${score.toFixed(2)}); confirm by eye.`] };
    return { status: "fail", score, issues: [`Label "${a.labelValue}" does not match application "${a.appValue}".`] };
}

/**
 * Numeric match for ABV / net contents. When `appValue` is null the field is
 * label-only (no form counterpart), so the bar is presence + parseability
 * rather than equality. Net contents widens the tolerance slightly by
 * relative amount to absorb rounding across unit conversions.
 */
function numericMatch(labelValue: string, appValue: string | null, unit: "percent" | "ml", tolerance: number): { status: FieldStatus; issues: string[] } {
    const parse = unit === "percent" ? parsePercent : parseVolumeMl;
    const labelNum = parse(labelValue);
    if (labelNum === null) return { status: "fail", issues: [`Could not parse a ${unit} value from "${labelValue}".`] };
    if (appValue === null) return { status: "pass", issues: [] }; // label-only: presence is the bar
    const appNum = parse(appValue);
    if (appNum === null) return { status: "fail", issues: [`Could not parse a ${unit} value from application "${appValue}".`] };
    const tol = unit === "ml" ? Math.max(tolerance, appNum * 0.005) : tolerance;
    if (Math.abs(labelNum - appNum) <= tol) return { status: "pass", issues: [] };
    return { status: "fail", issues: [`Label ${labelNum}${unit === "percent" ? "%" : "mL"} differs from application ${appNum} beyond tolerance ${tol}.`] };
}

/**
 * Strict government-warning match. The one field where "close" is a
 * compliance failure: wording must be exact and the header must be all-caps.
 * Only line-wrapping whitespace is tolerated (not a content difference).
 *
 * Bold is the softest visual signal the model reports, so a bold-only doubt
 * is downgraded to `review` rather than a hard fail — a borderline weight
 * judgment reaches a human instead of auto-rejecting a compliant label.
 */
function strictWarningMatch(warning: ExtractedField, fmt: WarningFormatting): { status: FieldStatus; issues: string[] } {
    const issues: string[] = [];
    if (!warning.found || warning.value === null) return { status: "fail", issues: ["Government warning is missing from the label."] };
    const textExact = collapseSpaces(warning.value) === collapseSpaces(TTB_GOVERNMENT_WARNING);
    if (!textExact) issues.push("Warning wording does not exactly match the required statement.");
    if (!fmt.headerAllCaps) issues.push('"GOVERNMENT WARNING:" must be in all capital letters.');
    const boldOnlyProblem = textExact && fmt.headerAllCaps && !fmt.headerBold;
    if (!fmt.headerBold) issues.push('"GOVERNMENT WARNING:" appears not to be bold; confirm by eye.');
    if (textExact && fmt.headerAllCaps && fmt.headerBold) return { status: "pass", issues: [] };
    if (boldOnlyProblem) return { status: "review", issues };
    return { status: "fail", issues };
}

/** True if any supplied confidence is "low". */
function lowConfidence(...cs: (Confidence | undefined)[]): boolean {
    return cs.some((c) => c === "low");
}

/**
 * Verify a label against its application data, producing a per-field verdict.
 *
 * @param label - fields extracted from the label image.
 * @param app - the COLA Part I values to compare against.
 * @param appConfidence - per-field read confidence for the form side, so the
 *   confidence gate can see uncertainty on either side of a comparison.
 * @returns the field results plus a rolled-up overall verdict.
 */
export function verify(
    label: LabelExtraction,
    app: ApplicationData,
    appConfidence: Partial<Record<keyof ApplicationData, Confidence>> = {},
): VerificationResult {
    const ruleset = RULESET_BY_TYPE[app.productType];
    const fields: FieldResult[] = [];

    for (const key of Object.keys(FIELD_RULES) as (keyof LabelExtraction)[]) {
        if (key === "warningFormatting") continue; // handled with governmentWarning
        const rule = FIELD_RULES[key];
        const field = label[key] as ExtractedField;
        const counterpartKey = FORM_COUNTERPART[key];
        const appValue = counterpartKey ? (app[counterpartKey] as string | undefined) ?? null : null;
        const appConf = counterpartKey ? appConfidence[counterpartKey] : undefined;

        // Wine-only fields resolve cleanly to N/A on non-wine products.
        if (key === "wineAppellation" && !ruleset.requiresAppellationCheck) {
            fields.push(naResult(key, field));
            continue;
        }

        // Absent field: fail only if required for this product type.
        if (!field.found || field.value === null) {
            const required = isRequired(key, rule.required, app, ruleset);
            fields.push({
                field: key, status: required ? "fail" : "notApplicable",
                labelValue: null, applicationValue: appValue,
                issues: required ? [`Required field "${key}" is missing from the label.`] : [],
            });
            continue;
        }

        // Confidence gate: because both sides are model-read, a "mismatch" could
        // be a real mismatch OR a misread. If either side was read with low
        // confidence, route to review rather than rendering a confident fail — a
        // transcription error must never masquerade as a compliance violation.
        // The warning is exempt: a wrong/missing warning fails regardless of read
        // confidence, and its check is exact rather than fuzzy.
        if (key !== "governmentWarning" && lowConfidence(field.confidence, appConf)) {
            fields.push({
                field: key, status: "unreadable", labelValue: field.value, applicationValue: appValue,
                issues: ["Low extraction confidence on label or application; needs human review."],
            });
            continue;
        }

        // The warning needs its formatting struct, so it bypasses the generic
        // dispatch path.
        if (key === "governmentWarning") {
            const w = strictWarningMatch(label.governmentWarning, label.warningFormatting);
            fields.push({ field: key, status: w.status, labelValue: label.governmentWarning.value, applicationValue: null, issues: w.issues });
            continue;
        }

        fields.push(dispatch(key, rule, field, appValue, ruleset));
    }

    return { serialNumber: app.serialNumber, productType: app.productType, overall: rollup(fields), fields };
}

/** Routes a present, sufficiently-confident field to its configured matcher. */
function dispatch(
    key: keyof LabelExtraction,
    rule: typeof FIELD_RULES[keyof LabelExtraction],
    field: ExtractedField,
    appValue: string | null,
    ruleset: typeof RULESET_BY_TYPE[ProductType],
): FieldResult {
    const base = { field: key, labelValue: field.value, applicationValue: appValue };
    switch (rule.matcher) {
        case "numeric": {
            // ABV tolerance comes from the product ruleset; volume from the rule.
            const tol = rule.unit === "percent" ? ruleset.abvTolerance : (rule.tolerance ?? 0.01);
            const r = numericMatch(field.value!, appValue, rule.unit!, tol);
            return { ...base, status: r.status, issues: r.issues };
        }
        case "presence":
            return { ...base, status: "pass", issues: [] };
        case "tolerant":
        default: {
            // A tolerant field with no form counterpart (e.g. classType) degrades
            // to a presence/validity check — there's nothing to match against.
            if (appValue === null) return { ...base, status: "pass", issues: [] };
            const r = tolerantMatch({
                labelValue: field.value!, appValue,
                threshold: rule.threshold ?? 0.85, reviewBand: rule.reviewBand, tokenSet: rule.tokenSet,
            });
            return { ...base, status: r.status, score: r.score, issues: r.issues };
        }
    }
}

/**
 * Whether an absent field is a failure. Reads from the product ruleset rather
 * than a static flag, so "origin required only when imported" and "ABV
 * optional for unflavored malt beverages" come straight from the rules.
 */
function isRequired(key: keyof LabelExtraction, baseRequired: boolean, app: ApplicationData, ruleset: typeof RULESET_BY_TYPE[ProductType]): boolean {
    if (key === "countryOfOrigin") return app.source === "imported" && ruleset.requiresOriginIfImported;
    if (key === "alcoholContent") return !(ruleset.abvOptional ?? false);
    return baseRequired;
}

function naResult(key: keyof LabelExtraction, field: ExtractedField): FieldResult {
    return { field: key, status: "notApplicable", labelValue: field.value, applicationValue: null, issues: [] };
}

/** Collapse field statuses to one verdict: any fail dominates; else any
 *  review/unreadable means needs-review; else pass. */
function rollup(fields: FieldResult[]): "pass" | "needsReview" | "fail" {
    if (fields.some((f) => f.status === "fail")) return "fail";
    if (fields.some((f) => f.status === "review" || f.status === "unreadable")) return "needsReview";
    return "pass";
}
