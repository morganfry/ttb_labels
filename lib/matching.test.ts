import { describe, it, expect } from "vitest";
import { normalize, similarity, parsePercent, parseVolumeMl, verify } from "./matching";
import { TTB_GOVERNMENT_WARNING } from "./schema";
import type { LabelExtraction, ApplicationData, ExtractedField, Confidence } from "./schema";

function fld(value: string | null, confidence: Confidence = "high"): ExtractedField {
    return { value, found: value !== null, confidence };
}

function baseLabel(over: Partial<LabelExtraction> = {}): LabelExtraction {
    return {
        brandName: fld("OLD TOM DISTILLERY"),
        fancifulName: fld(null),
        classType: fld("Kentucky Straight Bourbon Whiskey"),
        alcoholContent: fld("45% Alc./Vol. (90 Proof)"),
        netContents: fld("750 mL"),
        producerNameAddress: fld("Old Tom Distillery, Bardstown, KY"),
        countryOfOrigin: fld(null),
        wineAppellation: fld(null),
        sulfitesDeclaration: fld(null),
        governmentWarning: fld(TTB_GOVERNMENT_WARNING),
        warningFormatting: { headerAllCaps: true, headerBold: true },
        ...over,
    };
}

function baseApp(over: Partial<ApplicationData> = {}): ApplicationData {
    return {
        serialNumber: "24-1", productType: "distilledSpirits", source: "domestic",
        brandName: "OLD TOM DISTILLERY", applicantNameAddress: "Old Tom Distillery, Bardstown, KY", ...over,
    };
}

function statusOf(label: LabelExtraction, app: ApplicationData, field: string, appConf: Parameters<typeof verify>[2] = {}) {
    return verify(label, app, appConf).fields.find((f) => f.field === field)!;
}

describe("normalize", () => {
    it("folds case, punctuation, whitespace", () => {
        expect(normalize("STONE'S  THROW.")).toBe("stone's throw");
        expect(normalize("Stone's Throw")).toBe("stone's throw");
    });
    it("strips accents", () => { expect(normalize("Côtes du Rhône")).toBe("cotes du rhone"); });
});

describe("similarity", () => {
    it("Dave's case is identical after normalization", () => { expect(similarity("STONE'S THROW", "Stone's Throw")).toBe(1.0); });
    it("one-word difference scores high but below 1", () => {
        const s = similarity("Stone's Throw Distillery", "Stone's Throw Distillers");
        expect(s).toBeGreaterThan(0.85); expect(s).toBeLessThan(1.0);
    });
    it("token-set ignores word order", () => {
        expect(similarity("Kentucky Straight Bourbon Whiskey", "Bourbon Whiskey, Kentucky Straight", true)).toBe(1.0);
    });
});

describe("numeric parsers", () => {
    it("parses ABV", () => { expect(parsePercent("45% Alc./Vol. (90 Proof)")).toBe(45); expect(parsePercent("13.5% ABV")).toBe(13.5); });
    it("prefers the alcohol-tied percentage over a leading non-ABV one", () => {
        expect(parsePercent("100% Blue Weber Agave 40% Alc./Vol.")).toBe(40);
        expect(parsePercent("Alc. 40% by Vol")).toBe(40);
        expect(parsePercent("40%")).toBe(40); // bare percentage still parses (fallback)
    });
    it("rejects an implausible bare ABV with no alcohol cue ('100% Agave' is not 100% ABV)", () => {
        expect(parsePercent("100% Grain Neutral Spirits")).toBeNull();
        expect(parsePercent("100% Blue Weber Agave")).toBeNull();
    });
    it("normalizes volume to mL", () => { expect(parseVolumeMl("750 mL")).toBe(750); expect(parseVolumeMl("0.75 L")).toBe(750); expect(parseVolumeMl("75 cL")).toBe(750); });
});

describe("brand name matching", () => {
    it("exact match passes", () => { expect(statusOf(baseLabel(), baseApp(), "brandName").status).toBe("pass"); });
    it("Dave's case passes", () => {
        expect(statusOf(baseLabel({ brandName: fld("STONE'S THROW") }), baseApp({ brandName: "Stone's Throw" }), "brandName").status).toBe("pass");
    });
    it("near-match is review", () => {
        expect(statusOf(baseLabel({ brandName: fld("Stone's Throw Distillery") }), baseApp({ brandName: "Stones Throw Distilery" }), "brandName").status).toBe("review");
    });
    it("genuine mismatch fails", () => {
        expect(statusOf(baseLabel({ brandName: fld("Eagle Rare") }), baseApp({ brandName: "Old Tom Distillery" }), "brandName").status).toBe("fail");
    });
});

describe("field-aware tolerant normalization", () => {
    it("producer: 'BOTTLED BY … South Carolina' matches '… , SC'", () => {
        const r = statusOf(
            baseLabel({ producerNameAddress: fld("BOTTLED BY CAPTAIN'S BAY RUM CO. CHARLESTON, SOUTH CAROLINA") }),
            baseApp({ applicantNameAddress: "Captain's Bay Rum Co., Charleston, SC" }),
            "producerNameAddress",
        );
        expect(r.status).toBe("pass");
    });
    it("fanciful: 'ROSÉ' matches '2023 Rosé' (vintage + accent folded)", () => {
        const r = statusOf(
            baseLabel({ fancifulName: fld("ROSÉ") }),
            baseApp({ productType: "wine", fancifulName: "2023 Rosé" }),
            "fancifulName",
        );
        expect(r.status).toBe("pass");
    });
    it("still fails a genuinely different producer", () => {
        const r = statusOf(
            baseLabel({ producerNameAddress: fld("BOTTLED BY Eagle Rare Distillery, Frankfort, KY") }),
            baseApp({ applicantNameAddress: "Captain's Bay Rum Co., Charleston, SC" }),
            "producerNameAddress",
        );
        expect(r.status).toBe("fail");
    });
    it("brand: label that drops a suffix matches ('VERONA HILLS' ⊆ 'Verona Hills Vineyards')", () => {
        const r = statusOf(
            baseLabel({ brandName: fld("VERONA HILLS") }),
            baseApp({ brandName: "Verona Hills Vineyards" }),
            "brandName",
        );
        expect(r.status).toBe("pass");
    });
    it("producer: 'ESTATE BOTTLED BY …' boilerplate still matches via containment", () => {
        const r = statusOf(
            baseLabel({ producerNameAddress: fld("ESTATE BOTTLED BY BRIARWOOD ESTATE WINERY, PASO ROBLES, CALIFORNIA") }),
            baseApp({ applicantNameAddress: "Briarwood Estate Winery, Paso Robles, CA" }),
            "producerNameAddress",
        );
        expect(r.status).toBe("pass");
    });
    it("a single shared word is NOT enough to force a match", () => {
        expect(statusOf(baseLabel({ brandName: fld("Reserve") }), baseApp({ brandName: "Reserve Cabernet" }), "brandName").status).toBe("fail");
    });
    it("missing required brand fails", () => {
        expect(statusOf(baseLabel({ brandName: fld(null) }), baseApp(), "brandName").status).toBe("fail");
    });
});

describe("government warning", () => {
    it("exact + caps + bold passes", () => { expect(statusOf(baseLabel(), baseApp(), "governmentWarning").status).toBe("pass"); });
    it("title-case header fails", () => {
        const r = statusOf(baseLabel({ warningFormatting: { headerAllCaps: false, headerBold: true } }), baseApp(), "governmentWarning");
        expect(r.status).toBe("fail"); expect(r.issues.join(" ")).toMatch(/capital/i);
    });
    it("altered wording fails", () => {
        expect(statusOf(baseLabel({ governmentWarning: fld("GOVERNMENT WARNING: Drinking is bad for you.") }), baseApp(), "governmentWarning").status).toBe("fail");
    });
    it("an all-caps statement body passes (case tolerated; header caps/bold still required)", () => {
        expect(statusOf(baseLabel({ governmentWarning: fld(TTB_GOVERNMENT_WARNING.toUpperCase()) }), baseApp(), "governmentWarning").status).toBe("pass");
    });
    it("missing warning fails", () => {
        const r = statusOf(baseLabel({ governmentWarning: fld(null) }), baseApp(), "governmentWarning");
        expect(r.status).toBe("fail"); expect(r.issues.join(" ")).toMatch(/missing/i);
    });
    it("line-wrap whitespace tolerated", () => {
        const wrapped = TTB_GOVERNMENT_WARNING.replace(/ /g, "  ").replace("(2)", "\n(2)");
        expect(statusOf(baseLabel({ governmentWarning: fld(wrapped) }), baseApp(), "governmentWarning").status).toBe("pass");
    });
    it("bold-only doubt is review", () => {
        expect(statusOf(baseLabel({ warningFormatting: { headerAllCaps: true, headerBold: false } }), baseApp(), "governmentWarning").status).toBe("review");
    });
    it("not excused by low confidence", () => {
        expect(statusOf(baseLabel({ governmentWarning: fld("GOVERNMENT WARNING: wrong text", "low") }), baseApp(), "governmentWarning").status).toBe("fail");
    });
});

describe("confidence gate", () => {
    it("low-confidence label read is unreadable", () => {
        expect(statusOf(baseLabel({ brandName: fld("0ld T0m Distillery", "low") }), baseApp({ brandName: "Old Tom Distillery" }), "brandName").status).toBe("unreadable");
    });
    it("low-confidence app value gates", () => {
        expect(statusOf(baseLabel({ brandName: fld("Old Tom Distillery") }), baseApp({ brandName: "Eagle Rare" }), "brandName", { brandName: "low" }).status).toBe("unreadable");
    });
    it("medium confidence does not gate", () => {
        expect(statusOf(baseLabel({ brandName: fld("Eagle Rare", "medium") }), baseApp({ brandName: "Old Tom Distillery" }), "brandName").status).toBe("fail");
    });
});

describe("product-type rulesets", () => {
    it("wine appellation checked for wine", () => {
        expect(statusOf(baseLabel({ wineAppellation: fld("Napa Valley") }), baseApp({ productType: "wine", wineAppellation: "Napa Valley" }), "wineAppellation").status).toBe("pass");
    });
    it("wine appellation N/A for spirits", () => { expect(statusOf(baseLabel(), baseApp(), "wineAppellation").status).toBe("notApplicable"); });
    it("origin required when imported", () => {
        expect(statusOf(baseLabel({ countryOfOrigin: fld(null) }), baseApp({ source: "imported" }), "countryOfOrigin").status).toBe("fail");
    });
    it("origin not required when domestic", () => {
        expect(statusOf(baseLabel({ countryOfOrigin: fld(null) }), baseApp(), "countryOfOrigin").status).toBe("notApplicable");
    });
});

describe("sulfite declaration", () => {
    it("present on wine passes", () => {
        expect(statusOf(baseLabel({ sulfitesDeclaration: fld("Contains Sulfites") }), baseApp({ productType: "wine" }), "sulfitesDeclaration").status).toBe("pass");
    });
    it("absent on wine routes to review (SO₂ ppm is unknowable from the form)", () => {
        expect(statusOf(baseLabel({ sulfitesDeclaration: fld(null) }), baseApp({ productType: "wine" }), "sulfitesDeclaration").status).toBe("review");
    });
    it("absent on spirits is N/A", () => {
        expect(statusOf(baseLabel({ sulfitesDeclaration: fld(null) }), baseApp(), "sulfitesDeclaration").status).toBe("notApplicable");
    });
});

describe("appellation gated by grape varietal", () => {
    it("varietally-labeled wine missing appellation fails", () => {
        expect(statusOf(baseLabel({ wineAppellation: fld(null) }), baseApp({ productType: "wine", grapeVarietals: "Cabernet Sauvignon" }), "wineAppellation").status).toBe("fail");
    });
    it("non-varietal wine missing appellation is N/A", () => {
        expect(statusOf(baseLabel({ wineAppellation: fld(null) }), baseApp({ productType: "wine" }), "wineAppellation").status).toBe("notApplicable");
    });
});

describe("wine ABV optionality", () => {
    it("absent on wine routes to review (mandatory only over 14%)", () => {
        expect(statusOf(baseLabel({ alcoholContent: fld(null) }), baseApp({ productType: "wine" }), "alcoholContent").status).toBe("review");
    });
    it("absent on spirits fails", () => {
        expect(statusOf(baseLabel({ alcoholContent: fld(null) }), baseApp(), "alcoholContent").status).toBe("fail");
    });
    it("absent on unflavored malt is N/A", () => {
        expect(statusOf(baseLabel({ alcoholContent: fld(null) }), baseApp({ productType: "maltBeverages" }), "alcoholContent").status).toBe("notApplicable");
    });
});

describe("overall rollup", () => {
    it("all-pass is pass", () => { expect(verify(baseLabel(), baseApp()).overall).toBe("pass"); });
    it("any fail dominates", () => { expect(verify(baseLabel({ governmentWarning: fld(null) }), baseApp()).overall).toBe("fail"); });
    it("review without fail is needsReview", () => {
        expect(verify(baseLabel({ warningFormatting: { headerAllCaps: true, headerBold: false } }), baseApp()).overall).toBe("needsReview");
    });
});

describe("confidence gate on ABSENT reads (an unreadable image must not fail)", () => {
    it("a low-confidence absent required field is unreadable, not a confident fail", () => {
        expect(statusOf(baseLabel({ brandName: fld(null, "low") }), baseApp(), "brandName").status).toBe("unreadable");
    });
    it("a high-confidence absent required field still fails", () => {
        expect(statusOf(baseLabel({ brandName: fld(null, "high") }), baseApp(), "brandName").status).toBe("fail");
    });
    it("a missing warning fails regardless of low confidence (deliberate exception)", () => {
        expect(statusOf(baseLabel({ governmentWarning: fld(null, "low") }), baseApp(), "governmentWarning").status).toBe("fail");
    });
});

describe("uncertain source → country-of-origin", () => {
    it("absent origin routes to review when source (item 3) was unreadable", () => {
        expect(statusOf(baseLabel({ countryOfOrigin: fld(null) }), baseApp({ source: "imported" }), "countryOfOrigin", { source: "low" }).status).toBe("review");
    });
    it("still fails when source is confidently imported and origin is missing", () => {
        expect(statusOf(baseLabel({ countryOfOrigin: fld(null) }), baseApp({ source: "imported" }), "countryOfOrigin").status).toBe("fail");
    });
});

describe("spirits minimum-ABV floor (standard of identity)", () => {
    it("a bare spirit below its floor routes to review (not a confident fail)", () => {
        const r = statusOf(baseLabel({ classType: fld("Vodka"), alcoholContent: fld("30% Alc./Vol.") }), baseApp(), "alcoholContent");
        expect(r.status).toBe("review"); expect(r.issues.join(" ")).toMatch(/40% minimum/);
    });
    it("vodka at the floor passes", () => {
        expect(statusOf(baseLabel({ classType: fld("Vodka"), alcoholContent: fld("40% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("pass");
    });
    it("exempts flavored / sloe / liqueur variants, which carry a lower floor", () => {
        // Compliant below-40% products that the bare-class floor must NOT reject.
        expect(statusOf(baseLabel({ classType: fld("Sloe Gin"), alcoholContent: fld("30% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("pass");
        expect(statusOf(baseLabel({ classType: fld("Flavored Vodka"), alcoholContent: fld("30% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("pass");
        expect(statusOf(baseLabel({ classType: fld("Rum Liqueur"), alcoholContent: fld("35% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("pass");
    });
    it("low-confidence designation still routes to review", () => {
        expect(statusOf(baseLabel({ classType: fld("Vodka", "low"), alcoholContent: fld("30% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("review");
    });
    it("matches the designation as a WORD, not a substring (e.g. 'original' contains 'gin')", () => {
        expect(statusOf(baseLabel({ classType: fld("Original Recipe Liqueur"), alcoholContent: fld("25% Alc./Vol.") }), baseApp(), "alcoholContent").status).toBe("pass");
    });
});

describe("uncertain product type routes the whole verdict to review", () => {
    it("low-confidence productType escalates to needsReview via the classType row", () => {
        const res = verify(baseLabel(), baseApp(), { productType: "low" });
        expect(res.overall).toBe("needsReview");
        const ct = res.fields.find((f) => f.field === "classType")!;
        expect(ct.status).toBe("review");
        expect(ct.issues.join(" ")).toMatch(/product type/i);
    });
    it("high-confidence productType leaves a clean pass alone", () => {
        expect(verify(baseLabel(), baseApp(), { productType: "high" }).overall).toBe("pass");
    });
});

