/**
 * Tests the validators that guard against malformed model output. We exercise
 * them via the module's behavior by reconstructing representative payloads;
 * the validators are not exported, so we assert through the documented
 * contract: a good shape passes, a bad shape is rejected.
 *
 * Note: parseLabel/parseForm call the model, so they are not unit-tested here
 * (that is an external boundary). These tests target the pure validation that
 * decides whether a model response is well-formed — the part that can fail
 * deterministically and must.
 *
 * To test the validators directly, they are re-exported for test under a
 * __test export (see parsers.ts note). If you prefer not to widen the public
 * surface, move these assertions into an integration test that stubs extract().
 */
import { describe, it, expect } from "vitest";
import { __test as P } from "./parsers";

const goodField = { value: "x", found: true, confidence: "high" as const };
const goodFormField = { value: "x", confidence: "high" as const };

function fullLabel(over: Record<string, unknown> = {}) {
    return {
        brandName: goodField, fancifulName: goodField, classType: goodField,
        alcoholContent: goodField, netContents: goodField, producerNameAddress: goodField,
        countryOfOrigin: goodField, wineAppellation: goodField, governmentWarning: goodField,
        warningFormatting: { headerAllCaps: true, headerBold: true },
        ...over,
    };
}

function fullForm(over: Record<string, unknown> = {}) {
    return {
        serialNumber: goodFormField,
        productType: { value: "wine", confidence: "high" },
        source: { value: "domestic", confidence: "high" },
        brandName: goodFormField, fancifulName: goodFormField,
        applicantNameAddress: goodFormField, grapeVarietals: goodFormField, wineAppellation: goodFormField,
        ...over,
    };
}

describe("validateLabel", () => {
    it("accepts a complete, well-formed payload", () => {
        expect(P.validateLabel(fullLabel())).not.toBeNull();
    });
    it("rejects a missing field", () => {
        const p: Record<string, unknown> = fullLabel();
        delete p.brandName;
        expect(P.validateLabel(p)).toBeNull();
    });
    it("rejects a bad confidence value", () => {
        expect(P.validateLabel(fullLabel({ brandName: { value: "x", found: true, confidence: "maybe" } }))).toBeNull();
    });
    it("rejects a non-boolean found flag", () => {
        expect(P.validateLabel(fullLabel({ brandName: { value: "x", found: "yes", confidence: "high" } }))).toBeNull();
    });
    it("rejects missing warningFormatting booleans", () => {
        expect(P.validateLabel(fullLabel({ warningFormatting: { headerAllCaps: true } }))).toBeNull();
    });
    it("accepts a null value with found=false", () => {
        expect(P.validateLabel(fullLabel({ fancifulName: { value: null, found: false, confidence: "low" } }))).not.toBeNull();
    });
    it("rejects non-objects", () => {
        expect(P.validateLabel(null)).toBeNull();
        expect(P.validateLabel("nope")).toBeNull();
    });
});

describe("validateForm", () => {
    it("accepts a complete, well-formed payload", () => {
        expect(P.validateForm(fullForm())).not.toBeNull();
    });
    it("accepts null enum values (box not checked)", () => {
        expect(P.validateForm(fullForm({ productType: { value: null, confidence: "low" }, source: { value: null, confidence: "low" } }))).not.toBeNull();
    });
    it("rejects an out-of-enum productType", () => {
        expect(P.validateForm(fullForm({ productType: { value: "cider", confidence: "high" } }))).toBeNull();
    });
    it("rejects an out-of-enum source", () => {
        expect(P.validateForm(fullForm({ source: { value: "smuggled", confidence: "high" } }))).toBeNull();
    });
    it("rejects a missing field", () => {
        const p: Record<string, unknown> = fullForm();
        delete p.serialNumber;
        expect(P.validateForm(p)).toBeNull();
    });
});
