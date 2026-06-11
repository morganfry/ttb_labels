/**
 * Tests stripToJson — the pure defense against a model that disobeys the
 * "JSON only" instruction. The model call itself is an external boundary and
 * is not unit-tested here.
 */
import { describe, it, expect } from "vitest";
import { stripToJson, buildSourceBlocks } from "./extraction";

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

describe("buildSourceBlocks", () => {
    it("maps an image input to a single image block", () => {
        const blocks = buildSourceBlocks({ base64: "aaa", mediaType: "image/jpeg" });
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aaa" } });
    });
    it("maps a PDF input to a single document block", () => {
        const blocks = buildSourceBlocks({ base64: "bbb", mediaType: "application/pdf" });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe("document");
    });
    it("appends the text layer AFTER the image when supplementText is set", () => {
        const blocks = buildSourceBlocks({ base64: "ccc", mediaType: "image/jpeg", supplementText: "SERIAL 24-0001" });
        expect(blocks).toHaveLength(2);
        expect(blocks[0].type).toBe("image");
        expect(blocks[1].type).toBe("text");
        expect(blocks[1].text).toContain("SERIAL 24-0001");
        expect(blocks[1].text).toMatch(/image is authoritative/);
    });
    it("emits no text block for an empty supplement", () => {
        expect(buildSourceBlocks({ base64: "ddd", mediaType: "image/jpeg", supplementText: "" })).toHaveLength(1);
    });
});
