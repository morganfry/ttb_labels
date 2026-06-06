import { describe, it, expect } from "vitest";
import { parseCsv, tokenizeCsv, CSV_COLUMNS } from "./csvParse";

const HEADER = CSV_COLUMNS.join(",");

function rowFor(overrides: Partial<Record<string, string>> = {}): string {
    const base: Record<string, string> = {
        serialNumber: "24-1",
        productType: "wine",
        source: "domestic",
        brandName: "Acme Red",
        fancifulName: "Sunset Reserve",
        applicantNameAddress: "Acme Wines, Napa CA",
        grapeVarietals: "Cabernet",
        wineAppellation: "Napa Valley",
        // JSON array, quoted because it contains commas/quotes
        labelImageUrls: '["https://example.com/front.jpg","https://example.com/back.jpg"]',
    };
    const merged = { ...base, ...overrides };
    return CSV_COLUMNS.map((c) => {
        const v = merged[c] ?? "";
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",");
}

describe("tokenizeCsv", () => {
    it("handles quoted fields with commas and escaped quotes", () => {
        const text = 'a,b,c\n"x,y","he said ""hi""",z';
        const recs = tokenizeCsv(text);
        expect(recs[1]).toEqual(["x,y", 'he said "hi"', "z"]);
    });

    it("handles newlines inside quotes", () => {
        const recs = tokenizeCsv('a,b\n"line1\nline2",c');
        expect(recs[1]).toEqual(["line1\nline2", "c"]);
    });
});

describe("parseCsv", () => {
    it("parses a valid row into ApplicationData + imageRefs", () => {
        const { rows, headerError } = parseCsv(`${HEADER}\n${rowFor()}`);
        expect(headerError).toBeUndefined();
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.error).toBeUndefined();
        expect(row.app).toMatchObject({
            serialNumber: "24-1",
            productType: "wine",
            source: "domestic",
            brandName: "Acme Red",
            applicantNameAddress: "Acme Wines, Napa CA",
            wineAppellation: "Napa Valley",
        });
        expect(row.imageRefs).toEqual(["https://example.com/front.jpg", "https://example.com/back.jpg"]);
    });

    it("flags a header missing required columns", () => {
        const { headerError } = parseCsv("serialNumber,brandName\n24-1,Acme");
        expect(headerError).toMatch(/Missing required column/);
    });

    it("rejects an invalid productType", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ productType: "beer" })}`);
        expect(rows[0].error).toMatch(/Invalid productType/);
    });

    it("accepts the singular 'maltBeverage' alias, mapping it to maltBeverages", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ productType: "maltBeverage" })}`);
        expect(rows[0].error).toBeUndefined();
        expect(rows[0].app?.productType).toBe("maltBeverages");
    });

    it("rejects an invalid source", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ source: "local" })}`);
        expect(rows[0].error).toMatch(/Invalid source/);
    });

    it("requires at least one image URL", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: "[]" })}`);
        expect(rows[0].error).toMatch(/at least one image URL/);
    });

    it("rejects a malformed image cell that is neither JSON nor a valid reference", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: "not-json" })}`);
        expect(rows[0].error).toMatch(/JSON array of image references/);
    });

    it("accepts a bare single URL as a one-element list", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: "https://example.com/one.jpg" })}`);
        expect(rows[0].imageRefs).toEqual(["https://example.com/one.jpg"]);
    });

    it("accepts local image file names (resolved later from the ZIP)", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: '["front.jpg","labels/24-1-back.png"]' })}`);
        expect(rows[0].error).toBeUndefined();
        expect(rows[0].imageRefs).toEqual(["front.jpg", "labels/24-1-back.png"]);
    });

    it("accepts a bare single local file name", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: "front.webp" })}`);
        expect(rows[0].imageRefs).toEqual(["front.webp"]);
    });

    it("rejects non-http URL schemes", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: '["ftp://example.com/x.jpg"]' })}`);
        expect(rows[0].error).toMatch(/http\(s\)/);
    });

    it("rejects a local path that escapes with ..", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: '["../secret.jpg"]' })}`);
        expect(rows[0].error).toMatch(/relative name/);
    });

    it("rejects a local file with no image extension", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: '["front.txt"]' })}`);
        expect(rows[0].error).toMatch(/\.jpg/);
    });

    it("enforces the per-row image cap", () => {
        const many = JSON.stringify(Array.from({ length: 5 }, (_, i) => `https://example.com/${i}.jpg`));
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ labelImageUrls: many })}`, 3);
        expect(rows[0].error).toMatch(/limit is 3/);
    });

    it("leaves optional fields undefined when blank", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ fancifulName: "", grapeVarietals: "", wineAppellation: "" })}`);
        expect(rows[0].app?.fancifulName).toBeUndefined();
        expect(rows[0].app?.wineAppellation).toBeUndefined();
    });

    it("skips a blank trailing line", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor()}\n`);
        expect(rows).toHaveLength(1);
    });

    it("numbers rows by file position", () => {
        const { rows } = parseCsv(`${HEADER}\n${rowFor({ productType: "beer" })}\n${rowFor()}`);
        expect(rows[0].rowNumber).toBe(1);
        expect(rows[1].rowNumber).toBe(2);
    });
});
