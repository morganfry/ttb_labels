import { describe, it, expect } from "vitest";
import { parsePercent, parseVolumeMl } from "./unitParse";

describe("parsePercent", () => {
    it("parses a percentage from a full alcohol statement", () => {
        expect(parsePercent("45% Alc./Vol. (90 Proof)")).toBe(45);
    });
    it("parses a decimal percentage", () => {
        expect(parsePercent("13.5% ABV")).toBe(13.5);
    });
    it("tolerates a space before the percent sign", () => {
        expect(parsePercent("40 %")).toBe(40);
    });
    it("returns null when no percentage is present", () => {
        expect(parsePercent("90 Proof")).toBeNull();
        expect(parsePercent("strong")).toBeNull();
    });
});

describe("parseVolumeMl", () => {
    it("passes through millilitres", () => {
        expect(parseVolumeMl("750 mL")).toBe(750);
    });
    it("converts litres", () => {
        expect(parseVolumeMl("0.75 L")).toBe(750);
        expect(parseVolumeMl("1 liter")).toBe(1000);
    });
    it("converts centilitres", () => {
        expect(parseVolumeMl("75 cL")).toBe(750);
    });
    it("converts fluid ounces", () => {
        expect(parseVolumeMl("12 fl oz")).toBeCloseTo(354.882, 2);
    });
    it("is case-insensitive on the unit", () => {
        expect(parseVolumeMl("750 ML")).toBe(750);
    });
    it("returns null when no recognizable unit is present", () => {
        expect(parseVolumeMl("a bottle")).toBeNull();
    });
    it("returns null for a compound US statement (flags for review, not a wrong number)", () => {
        expect(parseVolumeMl("1 PINT 9 FL OZ")).toBeNull();
        expect(parseVolumeMl("1 quart")).toBeNull();
    });
    it("does not match a bare 'l' inside a word", () => {
        expect(parseVolumeMl("5 Label")).toBeNull();
        expect(parseVolumeMl("2 liters")).toBe(2000); // real liters still parse
    });
});
