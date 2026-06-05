import { describe, it, expect } from "vitest";
import { normalize, collapseSpaces, similarity } from "./textNormalize";

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
