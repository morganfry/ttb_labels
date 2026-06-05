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

    const q: SearchQuery = {
        serialNumber: p.get("serial") || undefined,
        brand: p.get("brand") || undefined,
        overall: isOverall(overall) ? overall : undefined,
        productType: isProductType(productType) ? productType : undefined,
        fromDate: p.get("fromDate") || undefined,
        toDate: p.get("toDate") || undefined,
        limit: numParam(p.get("limit"), 50),
        offset: numParam(p.get("offset"), 0),
    };

    try { return Response.json(await search(q)); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Search failed." }, { status: 500 }); }
}

/** Parse a non-negative integer query param, falling back on anything invalid. */
function numParam(v: string | null, fallback: number): number {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function isOverall(v: string | null): v is "pass" | "needsReview" | "fail" {
    return v === "pass" || v === "needsReview" || v === "fail";
}
function isProductType(v: string | null): v is "wine" | "distilledSpirits" | "maltBeverages" {
    return v === "wine" || v === "distilledSpirits" || v === "maltBeverages";
}
