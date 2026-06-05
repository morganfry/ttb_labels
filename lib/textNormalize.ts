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
