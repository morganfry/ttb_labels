/** Pure parsers for the numeric matcher — value extraction and unit
 *  normalization, independent of the matchers. */

/**
 * Extract a percentage from an alcohol statement.
 * @returns the numeric percent, or null if none is present.
 * @example parsePercent("45% Alc./Vol. (90 Proof)") // 45
 */
export function parsePercent(s: string): number | null {
    const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
}

/**
 * Normalize a volume statement to milliliters. Handles mL, cL, L, and fl oz.
 *
 * Known limitation: compound US statements such as "1 PINT 9 FL OZ" are not
 * parsed (only the first match is read). Such labels flag for review
 * downstream rather than producing a wrong number — see README limitations.
 *
 * @returns the volume in mL, or null if no recognizable unit is found.
 */
export function parseVolumeMl(s: string): number | null {
    const t = s.toLowerCase();
    const m = t.match(/(\d+(?:\.\d+)?)\s*(ml|millilit|cl|centilit|l|liter|litre|fl\.?\s*oz)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2];
    if (unit.startsWith("ml") || unit.startsWith("millilit")) return n;
    if (unit.startsWith("cl") || unit.startsWith("centilit")) return n * 10;
    if (unit === "l" || unit.startsWith("liter") || unit.startsWith("litre")) return n * 1000;
    if (unit.startsWith("fl")) return n * 29.5735;
    return null;
}
