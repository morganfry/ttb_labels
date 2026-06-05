/**
 * Tests stripToJson — the pure defense against a model that disobeys the
 * "JSON only" instruction. The model call itself is an external boundary and
 * is not unit-tested here.
 */
import { describe, it, expect } from "vitest";
import { stripToJson } from "./extraction";

describe("stripToJson", () => {
    it("returns bare JSON unchanged", () => {
        expect(stripToJson('{"a":1}')).toBe('{"a":1}');
    });
    it("strips a ```json fenced block", () => {
        expect(stripToJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });
    it("strips a plain ``` fence", () => {
        expect(stripToJson('```\n{"a":1}\n```')).toBe('{"a":1}');
    });
    it("extracts the object from a prose preamble", () => {
        expect(stripToJson('Here is the JSON:\n{"a":1}')).toBe('{"a":1}');
    });
    it("captures a nested object via outermost braces", () => {
        const json = '{"a":{"b":2},"c":3}';
        expect(stripToJson("noise " + json + " trailing")).toBe(json);
    });
    it("returns null when no object is present", () => {
        expect(stripToJson("no json here")).toBeNull();
        expect(stripToJson("")).toBeNull();
    });
    it("returns null for a malformed brace pair", () => {
        expect(stripToJson("} {")).toBeNull(); // last } precedes first {
    });
});
