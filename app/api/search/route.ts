/**
 * GET /api/search — query stored verdicts with combinable filters.
 * Query params: serial, brand, overall, productType, fromDate, toDate,
 * limit, offset. Enum-typed params are validated before use.
 */
import { search, migrate, type SearchQuery } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
    await migrate();
    const p = new URL(req.url).searchParams;
    const overall = p.get("overall");
    const productType = p.get("productType");

    // Validate dates up front: an unparseable value would otherwise reach the
    // `::date` cast in SQL and surface as a 500 instead of a clear 400.
    const fromDate = p.get("fromDate") || undefined;
    const toDate = p.get("toDate") || undefined;
    for (const d of [fromDate, toDate]) {
        if (d !== undefined && !isValidDate(d))
            return Response.json({ error: `Invalid date "${d}" — use YYYY-MM-DD.` }, { status: 400 });
    }

    const q: SearchQuery = {
        serialNumber: p.get("serial") || undefined,
        brand: p.get("brand") || undefined,
        overall: isOverall(overall) ? overall : undefined,
        productType: isProductType(productType) ? productType : undefined,
        fromDate,
        toDate,
        limit: numParam(p.get("limit"), 50),
        offset: numParam(p.get("offset"), 0),
    };

    // Log the detail server-side; return a generic message so internals (driver
    // errors, column names, host) never reach the client.
    try { return Response.json(await search(q)); }
    catch (e) { console.error("Search error:", e); return Response.json({ error: "Search failed." }, { status: 500 }); }
}

/** A YYYY-MM-DD (optionally with time) date that's also a real calendar date. */
function isValidDate(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Parse a non-negative integer query param, falling back on anything invalid. */
function numParam(v: string | null, fallback: number): number {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function isOverall(v: string | null): v is "pass" | "needsReview" | "fail" | "error" {
    return v === "pass" || v === "needsReview" || v === "fail" || v === "error";
}
function isProductType(v: string | null): v is "wine" | "distilledSpirits" | "maltBeverages" {
    return v === "wine" || v === "distilledSpirits" || v === "maltBeverages";
}
