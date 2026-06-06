/**
 * Pure text helpers for the tolerant matcher. No dependency on the matchers
 * themselves, so they are independently testable.
 */
import { distance } from "fastest-levenshtein";

/**
 * Fold away differences that don't matter for a name comparison: case,
 * accents, apostrophe variants, periods/commas, and runs of whitespace.
 * This alone resolves most "false mismatch" cases (e.g. "STONE'S THROW" vs
 * "Stone's Throw") before any similarity scoring is needed.
 */
export function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")  // strip combining accents
        .replace(/['’]/g, "'")                               // unify apostrophe variants
        .replace(/[.,]/g, "")                                // drop periods/commas
        .replace(/\s+/g, " ")                                // collapse whitespace
        .trim();
}

/**
 * Collapse runs of whitespace to single spaces. Used by the strict warning
 * check, where line-wrapping on the physical label is not a content
 * difference but must not otherwise alter the text.
 */
export function collapseSpaces(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

// ── Field-specific cleanup ──────────────────────────────────────────────────
// The form carries a bare name/address and fanciful name; the label often adds
// boilerplate the form omits. Folding that away (on BOTH sides) before scoring
// prevents real matches from sinking. Each helper is a no-op when nothing
// matches, so applying it symmetrically is safe.

/** Statement-of-responsibility verbs that prefix a producer block on a label. */
const RESP_VERBS = "bottled|distilled|produced|brewed|vinted|blended|made|packed|prepared|cellared|crafted|fermented|imported|manufactured|canned|filled";
const RESP_PREFIX_RE = new RegExp(`^\\s*(?:${RESP_VERBS})(?:\\s+and\\s+(?:${RESP_VERBS}))?\\s+by\\s+`, "i");

/**
 * Strip a leading "BOTTLED BY" / "PRODUCED AND BOTTLED BY" / "IMPORTED BY" etc.
 * — label phrasing the COLA name/address field doesn't include.
 */
export function stripResponsibilityPrefix(s: string): string {
    return s.replace(RESP_PREFIX_RE, "").trim();
}

/** US state (and DC) full name → USPS abbreviation, so "South Carolina" ≡ "SC". */
const US_STATES: Record<string, string> = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar", "california": "ca",
    "colorado": "co", "connecticut": "ct", "delaware": "de", "florida": "fl", "georgia": "ga",
    "hawaii": "hi", "idaho": "id", "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md", "massachusetts": "ma",
    "michigan": "mi", "minnesota": "mn", "mississippi": "ms", "missouri": "mo", "montana": "mt",
    "nebraska": "ne", "nevada": "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm",
    "new york": "ny", "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
    "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut", "vermont": "vt",
    "virginia": "va", "washington": "wa", "west virginia": "wv", "wisconsin": "wi",
    "wyoming": "wy", "district of columbia": "dc",
};
// Longest-first so "west virginia" matches before "virginia", "north dakota" before "dakota", etc.
const US_STATE_RE = new RegExp(`\\b(${Object.keys(US_STATES).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

/** Replace full US state names with their abbreviations (case-insensitive). */
export function normalizeUsStates(s: string): string {
    return s.replace(US_STATE_RE, (m) => US_STATES[m.toLowerCase()] ?? m);
}

/** Drop a leading vintage year ("2023 Rosé" → "Rosé"); leaves "1792" etc. alone. */
export function stripLeadingVintage(s: string): string {
    return s.replace(/^\s*(?:19|20)\d{2}\b\s*/, "").trim();
}

/**
 * True when one name's words are fully contained in the other's — the shorter
 * side (≥ `minTokens` distinct words) is a subset of the longer. Catches the
 * common cases edit-distance underrates: a label brand that omits a
 * "Vineyards"/"Winery" suffix, or a producer block carrying extra boilerplate
 * ("ESTATE BOTTLED BY …") the form leaves out. The `minTokens` floor keeps a
 * single shared word (e.g. "Reserve") from forcing a match.
 */
export function tokensSubsumed(a: string, b: string, minTokens = 2): boolean {
    const ta = [...new Set(normalize(a).split(" ").filter(Boolean))];
    const tb = [...new Set(normalize(b).split(" ").filter(Boolean))];
    if (ta.length === 0 || tb.length === 0) return false;
    const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    if (small.length < minTokens) return false;
    const largeSet = new Set(large);
    return small.every((t) => largeSet.has(t));
}

/**
 * Normalized similarity in [0, 1] (1 = identical after normalization).
 *
 * @param a - first string
 * @param b - second string
 * @param tokenSet - when true, compares sorted word sets so word order is
 *   ignored ("A B" ≡ "B A") — used for class/type, where ordering varies.
 */
export function similarity(a: string, b: string, tokenSet = false): number {
    let na = normalize(a), nb = normalize(b);
    if (tokenSet) {
        na = na.split(" ").sort().join(" ");
        nb = nb.split(" ").sort().join(" ");
    }
    if (na === nb) return 1.0;
    const maxLen = Math.max(na.length, nb.length);
    return maxLen === 0 ? 1.0 : 1 - distance(na, nb) / maxLen;
}
