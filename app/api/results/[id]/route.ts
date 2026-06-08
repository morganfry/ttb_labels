/** GET /api/results/[id] — one full verification (summary + field rows) for
 *  the search detail view. 404 when the id is unknown. */
import { getResult, migrate } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    await migrate();
    const { id } = await params; // Next 15: route params are async
    try {
        const result = await getResult(id);
        if (!result) return Response.json({ error: "Not found." }, { status: 404 });
        return Response.json(result);
    } catch (e) {
        // Generic client message; the detail stays in the server log only.
        console.error("Result lookup error:", e);
        return Response.json({ error: "Lookup failed." }, { status: 500 });
    }
}
