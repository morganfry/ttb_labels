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
    FIELD_RULES, FORM_COUNTERPART, RULESET_BY_TYPE, TTB_GOVERNMENT_WARNING, MATCH_TUNING,
    type LabelExtraction, type ExtractedField, type WarningFormatting,
    type ApplicationData, type ProductType, type Confidence,
    type FieldResult, type FieldStatus, type VerificationResult,
} from "./schema";
import { collapseSpaces, similarity, stripResponsibilityPrefix, normalizeUsStates, stripLeadingVintage, tokensSubsumed } from "./textNormalize";
import { parsePercent, parseVolumeMl } from "./unitParse";

// Re-export so importers/tests that pulled these from ./matching still work.
export { normalize, similarity } from "./textNormalize";
export { parsePercent, parseVolumeMl } from "./unitParse";

interface TolerantArgs {
    labelValue: string; appValue: string; threshold: number; reviewBand?: number; tokenSet?: boolean;
    /** Optional pre-cleaned text to SCORE on; messages still show labelValue/appValue. */
    scoreLabel?: string; scoreApp?: string;
}

/**
 * Tolerant string match: three outcomes, not a binary. The review band is
 * the point — a near-but-inexact match (e.g. "Distillery" vs "Distillers")
 * routes to a human instead of a hard fail, preserving agent judgment for
 * the ambiguous cases while auto-passing the clearly-equivalent ones.
 */
function tolerantMatch(a: TolerantArgs): { status: FieldStatus; score: number; issues: string[] } {
    const sl = a.scoreLabel ?? a.labelValue, sa = a.scoreApp ?? a.appValue;
    let score = similarity(sl, sa, a.tokenSet);
    // One name fully contained in the other (>= containmentMinTokens shared words)
    // is a confident match that edit-distance underrates — e.g. "VERONA HILLS" vs
    // "Verona Hills Vineyards", or a producer block with extra "ESTATE BOTTLED BY".
    if (score < MATCH_TUNING.containmentScore && tokensSubsumed(sl, sa, MATCH_TUNING.containmentMinTokens)) {
        score = MATCH_TUNING.containmentScore;
    }
    const review = a.reviewBand ?? a.threshold; // no band → no review zone
    if (score >= review) return { status: "pass", score, issues: [] };
    if (score >= a.threshold) return { status: "review", score, issues: [`Close but not exact (similarity ${score.toFixed(2)}); confirm by eye.`] };
    return { status: "fail", score, issues: [`Label "${a.labelValue}" does not match application "${a.appValue}".`] };
}

/**
 * Field-aware cleanup applied to BOTH sides before tolerant scoring, so label
 * boilerplate the form omits doesn't sink a real match (see FieldRule.normalize).
 * Each step is a no-op when nothing matches, so it's safe to apply symmetrically.
 */
function prepTolerant(value: string, kind: "address" | "designation" | undefined): string {
    if (kind === "address") return normalizeUsStates(stripResponsibilityPrefix(value));
    if (kind === "designation") return stripLeadingVintage(value);
    return value;
}

/**
 * Numeric match for ABV / net contents. When `appValue` is null the field is
 * label-only (no form counterpart), so the bar is presence + a readable value
 * rather than equality. Net contents widens the tolerance slightly by
 * relative amount to absorb rounding across unit conversions.
 *
 * A value that is PRESENT but the parser can't read (e.g. compound US
 * "1 PINT 9 FL OZ", which parseVolumeMl deliberately doesn't handle) is a
 * parser gap, not a proven violation — it routes to review, never a confident
 * fail, the same philosophy as the confidence gate.
 */
function numericMatch(labelValue: string, appValue: string | null, unit: "percent" | "ml", tolerance: number): { status: FieldStatus; issues: string[] } {
    const parse = unit === "percent" ? parsePercent : parseVolumeMl;
    const labelNum = parse(labelValue);
    if (labelNum === null) return { status: "review", issues: [`Could not parse a ${unit} value from "${labelValue}"; confirm it by eye.`] };
    if (appValue === null) return { status: "pass", issues: [] }; // label-only: presence is the bar
    const appNum = parse(appValue);
    if (appNum === null) return { status: "review", issues: [`Could not parse a ${unit} value from application "${appValue}"; confirm it by eye.`] };
    const tol = unit === "ml" ? Math.max(tolerance, appNum * MATCH_TUNING.netContentsRelativeTolerance) : tolerance;
    if (Math.abs(labelNum - appNum) <= tol) return { status: "pass", issues: [] };
    return { status: "fail", issues: [`Label ${labelNum}${unit === "percent" ? "%" : "mL"} differs from application ${appNum} beyond tolerance ${tol}.`] };
}

/**
 * Strict government-warning match. The one field where "close" is a
 * compliance failure: the wording must be exact. Only line-wrapping whitespace
 * and letter case are tolerated in the statement BODY — case because a label may
 * legitimately set the whole statement in caps, and the regulated all-caps
 * requirement is on the "GOVERNMENT WARNING" header, checked separately via
 * fmt.headerAllCaps (a visual signal, not derivable from the case-folded text).
 *
 * Bold is the softest visual signal the model reports, so a bold-only doubt
 * is downgraded to `review` rather than a hard fail — a borderline weight
 * judgment reaches a human instead of auto-rejecting a compliant label.
 */
function strictWarningMatch(warning: ExtractedField, fmt: WarningFormatting): { status: FieldStatus; issues: string[] } {
    const issues: string[] = [];
    if (!warning.found || warning.value === null) return { status: "fail", issues: ["Government warning is missing from the label."] };
    const canon = (s: string) => collapseSpaces(s).toUpperCase();
    const textExact = canon(warning.value) === canon(TTB_GOVERNMENT_WARNING);
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
    // Three form fields decide whether OTHER fields are required, so a shaky
    // read of any of them makes the requirement itself unreliable: item 3
    // (source) controls country-of-origin, item 5 (productType) picks the whole
    // ruleset, item 10 (grapeVarietals) makes the appellation mandatory.
    // absentDecision consults these so a guessed requirement never produces a
    // confident "required field missing" fail.
    const uncertain = {
        source: lowConfidence(appConfidence.source),
        productType: lowConfidence(appConfidence.productType),
        varietals: lowConfidence(appConfidence.grapeVarietals),
    };
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

        // Absent field: the verdict is product-type dependent (required → fail,
        // conditionally-required → review, otherwise N/A). absentDecision owns
        // that judgment so every conditional rule lives in one place.
        if (!field.found || field.value === null) {
            const d = absentDecision(key, rule, app, ruleset, uncertain);
            // A low-confidence read can't reliably assert ABSENCE either: an
            // unreadable image returns every field absent, so don't turn that into
            // a confident "required field missing" fail — route to review. The
            // government warning is the deliberate exception (missing fails always).
            const downgrade = d.status === "fail" && key !== "governmentWarning" && lowConfidence(field.confidence);
            fields.push({
                field: key,
                status: downgrade ? "unreadable" : d.status,
                labelValue: null, applicationValue: appValue,
                issues: downgrade
                    ? ["Field not found, but the label read was low-confidence; confirm presence by eye."]
                    : (d.issue ? [d.issue] : []),
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

    // Standard-of-identity minimum ABV for spirits designations (needs the
    // designation AND the ABV together, which no single matcher sees).
    applyAbvFloor(fields, label, ruleset);

    // productType (item 5) selects the whole ruleset; if it was read with low
    // confidence (or defaulted from an unreadable item 5), the selection itself
    // is unreliable — surface that and route the verdict to review.
    if (uncertain.productType) flagProductTypeUncertain(fields);

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
            const tol = rule.unit === "percent" ? ruleset.abvTolerance : (rule.tolerance ?? MATCH_TUNING.defaultNumericTolerance);
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
                scoreLabel: prepTolerant(field.value!, rule.normalize), scoreApp: prepTolerant(appValue, rule.normalize),
                threshold: rule.threshold ?? MATCH_TUNING.defaultThreshold, reviewBand: rule.reviewBand, tokenSet: rule.tokenSet,
            });
            return { ...base, status: r.status, score: r.score, issues: r.issues };
        }
    }
}

/**
 * The verdict for an ABSENT label field. Most absences are a simple
 * required→fail / optional→N/A call straight from the ruleset, but three are
 * conditional on data the form can't give us, so they route to review for a
 * human rather than guessing:
 *  - alcoholContent on wine — mandatory only over 14% ABV, unknowable when the
 *    value itself is missing.
 *  - sulfitesDeclaration on wine — required at ≥10 ppm SO₂, not on the form.
 *  - wineAppellation — required only when a grape varietal is the class/type,
 *    inferred here from the form's item-10 grape varietals.
 * A "required field missing" fail is only as reliable as the form read that
 * made the field required, so when that controlling read was low-confidence
 * (`uncertain`), the fail is downgraded to review — the same misread-must-not-
 * masquerade-as-violation rule the confidence gate applies to mismatches.
 */
function absentDecision(
    key: keyof LabelExtraction,
    rule: typeof FIELD_RULES[keyof LabelExtraction],
    app: ApplicationData,
    ruleset: typeof RULESET_BY_TYPE[ProductType],
    uncertain: { source: boolean; productType: boolean; varietals: boolean },
): { status: FieldStatus; issue?: string } {
    if (key === "countryOfOrigin") {
        // If item 3 (source) couldn't be read, we can't tell whether origin is
        // required — route to review instead of silently treating it as domestic
        // (which would suppress a genuine import requirement).
        if (uncertain.source) return { status: "review", issue: "Could not read whether the product is imported (form item 3); confirm whether country of origin is required on the label." };
        return app.source === "imported" && ruleset.requiresOriginIfImported
            ? { status: "fail", issue: "Country of origin is required for imported products but is missing from the label." }
            : { status: "notApplicable" };
    }
    if (key === "alcoholContent") {
        if (ruleset.abvOptional) return { status: "notApplicable" };          // unflavored malt
        if (ruleset.abvConditional) return { status: "review", issue: "No alcohol content found; it is mandatory for wine over 14% ABV (optional, with conditions, for 7–14% table/light wine). Confirm by eye." };
        // Whether ABV is required at all depends on which ruleset item 5
        // selected (optional on unflavored malt); under a guessed ruleset that
        // fail could be wrong, so it can't be confident.
        if (uncertain.productType) return { status: "review", issue: "No alcohol content found, and the product type (form item 5) was read with low confidence — whether ABV is required depends on it. Confirm by eye." };
        return { status: "fail", issue: 'Required field "alcoholContent" is missing from the label.' };
    }
    if (key === "wineAppellation") {
        // Reaches here only for wine; non-wine is resolved to N/A earlier. The
        // appellation becomes mandatory once the wine is varietally labeled.
        const varietalLabeled = !!app.grapeVarietals && app.grapeVarietals.trim() !== "";
        if (!varietalLabeled) return { status: "notApplicable" };
        // The requirement rests on two model-read form fields: item 5 chose the
        // wine ruleset and item 10 supplied the varietal. If either read was
        // low-confidence, the requirement itself is a guess.
        if (uncertain.varietals || uncertain.productType) return { status: "review", issue: "An appellation appears required because the form lists a grape varietal, but that form read was low-confidence; confirm by eye." };
        return { status: "fail", issue: "Appellation of origin is required when a grape varietal is used as the class/type designation, but none appears on the label." };
    }
    if (key === "sulfitesDeclaration") {
        return ruleset.requiresSulfitesDeclaration
            ? { status: "review", issue: "No sulfite declaration found; required if the wine contains 10 ppm or more sulfur dioxide. Confirm by eye." }
            : { status: "notApplicable" };
    }
    return rule.required
        ? { status: "fail", issue: `Required field "${key}" is missing from the label.` }
        : { status: "notApplicable" };
}

function naResult(key: keyof LabelExtraction, field: ExtractedField): FieldResult {
    return { field: key, status: "notApplicable", labelValue: field.value, applicationValue: null, issues: [] };
}

/**
 * A modifier that drops a spirit below its bare-class ABV floor: under 27 CFR 5
 * a flavored spirit / liqueur / cordial (e.g. "Sloe Gin", "Flavored Vodka",
 * "Rum Liqueur") has a lower standard-of-identity minimum (typically 30%), so the
 * bare-class 40% floor must NOT apply to it.
 */
const ABV_FLOOR_EXEMPT_MODIFIERS = ["flavored", "flavoured", "sloe", "liqueur", "liquor", "cordial", "schnapps", "infused"];

/**
 * Standard-of-identity minimum ABV for distilled-spirits designations (27 CFR 5:
 * a bare rum / gin / vodka / whisky must state at least 40%). The numeric matcher
 * only checks the ABV is present and parseable (it's label-only), so the floor is
 * checked here, where both the designation (classType) and the ABV are visible.
 *
 * Deliberately conservative: it exempts flavored/liqueur variants (which carry a
 * lower floor) and routes a below-floor value to REVIEW, not a confident fail —
 * the matcher can't know every standard-of-identity nuance, and wrongly rejecting
 * a compliant label is a real harm. Only ever escalates a clean pass.
 */
function applyAbvFloor(fields: FieldResult[], label: LabelExtraction, ruleset: typeof RULESET_BY_TYPE[ProductType]): void {
    const floors = ruleset.abvMinByDesignation;
    if (!floors) return;
    const ac = fields.find((f) => f.field === "alcoholContent");
    if (!ac || ac.status !== "pass") return; // only a clean pass can hide a below-floor value
    const words = (label.classType.value ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (words.some((w) => ABV_FLOOR_EXEMPT_MODIFIERS.includes(w))) return; // flavored/liqueur → lower floor
    const designation = Object.keys(floors).find((d) => words.includes(d)); // word match, so "Virgin" ≠ gin
    if (!designation) return;
    const abv = parsePercent(label.alcoholContent.value ?? "");
    if (abv === null) return;
    if (abv >= floors[designation]) return;
    ac.status = "review";
    ac.issues = [...ac.issues, `${abv}% is below the usual ${floors[designation]}% minimum for "${designation}"; confirm the standard of identity (some flavored/liqueur variants allow less).`];
}

/**
 * Surface an uncertain ruleset selection. productType is a form field, not a
 * label field, so we attach the warning to the classType row (the nearest
 * "what kind of product" signal) and escalate it to review, which rolls the
 * overall verdict up to needsReview.
 */
function flagProductTypeUncertain(fields: FieldResult[]): void {
    const ct = fields.find((f) => f.field === "classType");
    if (!ct) return;
    if (ct.status === "pass" || ct.status === "notApplicable") ct.status = "review";
    ct.issues = [...ct.issues, "Product type (form item 5) was read with low confidence; the validation ruleset may be wrong — confirm the product type before trusting these field verdicts."];
}

/** Collapse field statuses to one verdict: any fail dominates; else any
 *  review/unreadable means needs-review; else pass. */
function rollup(fields: FieldResult[]): "pass" | "needsReview" | "fail" {
    if (fields.some((f) => f.status === "fail")) return "fail";
    if (fields.some((f) => f.status === "review" || f.status === "unreadable")) return "needsReview";
    return "pass";
}
