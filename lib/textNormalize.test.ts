import { describe, it, expect } from "vitest";
import { normalize, collapseSpaces, similarity, stripResponsibilityPrefix, normalizeUsStates, stripLeadingVintage, tokensSubsumed } from "./textNormalize";

describe("normalize", () => {
    it("folds case, punctuation, and whitespace", () => {
        expect(normalize("STONE'S  THROW.")).toBe("stone's throw");
        expect(normalize("Stone's Throw")).toBe("stone's throw");
    });
    it("strips combining accents", () => {
        expect(normalize("Côtes du Rhône")).toBe("cotes du rhone");
    });
    it("unifies curly and straight apostrophes", () => {
        expect(normalize("O\u2019Brien")).toBe(normalize("O'Brien"));
    });
    it("trims and collapses runs of whitespace", () => {
        expect(normalize("  a   b  ")).toBe("a b");
    });
});

describe("collapseSpaces", () => {
    it("collapses runs but preserves the words", () => {
        expect(collapseSpaces("GOVERNMENT   WARNING:\n(1)  foo")).toBe("GOVERNMENT WARNING: (1) foo");
    });
    it("does not alter case or punctuation", () => {
        expect(collapseSpaces("A.B,  C")).toBe("A.B, C");
    });
});

describe("similarity", () => {
    it("is 1.0 for inputs identical after normalization", () => {
        expect(similarity("STONE'S THROW", "Stone's Throw")).toBe(1.0);
    });
    it("scores a one-char difference high but below 1", () => {
        const s = similarity("Stoneworth", "Stonewerth");
        expect(s).toBeGreaterThan(0.85);
        expect(s).toBeLessThan(1.0);
    });
    it("scores unrelated strings low", () => {
        expect(similarity("Eagle Rare", "Old Tom Distillery")).toBeLessThan(0.5);
    });
    it("tokenSet ignores word order", () => {
        expect(similarity("Kentucky Straight Bourbon", "Bourbon Kentucky Straight", true)).toBe(1.0);
    });
    it("treats two empty strings as identical", () => {
        expect(similarity("", "")).toBe(1.0);
    });
});

describe("stripResponsibilityPrefix", () => {
    it("strips a leading BOTTLED BY / PRODUCED AND BOTTLED BY phrase", () => {
        expect(stripResponsibilityPrefix("BOTTLED BY Captain's Bay Rum Co.")).toBe("Captain's Bay Rum Co.");
        expect(stripResponsibilityPrefix("Produced and Bottled by Oak Valley")).toBe("Oak Valley");
        expect(stripResponsibilityPrefix("IMPORTED BY Old Pier")).toBe("Old Pier");
    });
    it("leaves a name without a responsibility prefix unchanged", () => {
        expect(stripResponsibilityPrefix("Captain's Bay Rum Co., Charleston, SC")).toBe("Captain's Bay Rum Co., Charleston, SC");
    });
});

describe("normalizeUsStates", () => {
    it("maps full state names to abbreviations", () => {
        expect(normalizeUsStates("Charleston, South Carolina")).toBe("Charleston, sc");
        expect(normalizeUsStates("Napa, California")).toBe("Napa, ca");
    });
    it("prefers the longer name (West Virginia, not Virginia)", () => {
        expect(normalizeUsStates("Wheeling, West Virginia")).toBe("Wheeling, wv");
    });
    it("leaves existing abbreviations and non-state words alone", () => {
        expect(normalizeUsStates("Charleston, SC")).toBe("Charleston, SC");
    });
});

describe("stripLeadingVintage", () => {
    it("drops a leading vintage year", () => {
        expect(stripLeadingVintage("2023 Rosé")).toBe("Rosé");
        expect(stripLeadingVintage("2019 Reserve Cabernet")).toBe("Reserve Cabernet");
    });
    it("leaves a non-vintage leading number alone (e.g. the brand 1792)", () => {
        expect(stripLeadingVintage("1792 Small Batch")).toBe("1792 Small Batch");
        expect(stripLeadingVintage("Rosé")).toBe("Rosé");
    });
});

describe("tokensSubsumed", () => {
    it("is true when the shorter name's words are all in the longer (either order)", () => {
        expect(tokensSubsumed("VERONA HILLS", "Verona Hills Vineyards")).toBe(true);
        expect(tokensSubsumed("Verona Hills Vineyards", "VERONA HILLS")).toBe(true);
        expect(tokensSubsumed("Briarwood Estate Winery", "ESTATE BOTTLED BY BRIARWOOD ESTATE WINERY")).toBe(true);
    });
    it("requires at least two shared words (a lone token is not enough)", () => {
        expect(tokensSubsumed("Reserve", "Reserve Cabernet")).toBe(false);
    });
    it("is false when the shorter name has a word the longer lacks", () => {
        expect(tokensSubsumed("Verona Springs", "Verona Hills Vineyards")).toBe(false);
        expect(tokensSubsumed("Eagle Rare", "Old Tom Distillery")).toBe(false);
    });
});
