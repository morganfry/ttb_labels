/**
 * POST /api/verify — process uploaded applications and stream results.
 *
 * Accepts multipart form data: a `pairs` manifest plus a label_<id> and
 * form_<id> file per application. Responds with newline-delimited JSON
 * (NDJSON), one line per finished item, so the client table fills row by row
 * rather than waiting for the whole batch — the realization of the per-label
 * latency expectation.
 */
import { processBatch, type WorkItem, type ItemOutcome } from "@/lib/orchestration";
import { saveResult, migrate } from "@/lib/persistence";

export const runtime = "nodejs";   // needs Buffer / pdf-lib (not edge)
export const maxDuration = 300;    // Vercel hint; ignored by a long-running server

interface Pair { id: string; name: string }

export async function POST(req: Request): Promise<Response> {
    await migrate(); // idempotent; ensures tables exist on a fresh DB

    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Expected multipart/form-data." }, 400); }

    let pairs: Pair[];
    try {
        pairs = JSON.parse(String(form.get("pairs") ?? "[]"));
    } catch { return json({ error: "Missing or invalid `pairs` manifest." }, 400); }
    if (!Array.isArray(pairs) || pairs.length === 0)
        return json({ error: "Missing or invalid `pairs` manifest." }, 400);

    // Combined-PDF model: the same uploaded file serves as both label and form
    // (two regions of one document); the parsers read different parts of it.
    const items: WorkItem[] = [];
    for (const p of pairs) {
        const labelFile = form.get(`label_${p.id}`);
        const formFile = form.get(`form_${p.id}`);
        if (!(labelFile instanceof File) || !(formFile instanceof File)) continue;
        items.push({
            id: p.id, name: p.name,
            labelPdf: new Uint8Array(await labelFile.arrayBuffer()),
            formPdf: new Uint8Array(await formFile.arrayBuffer()),
        });
    }
    if (items.length === 0) return json({ error: "No valid label/form pairs found in upload." }, 400);

    const encoder = new TextEncoder();
    // Cancel the batch if the client disconnects, so we don't keep paying for
    // model calls whose results no one will read.
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());

    const stream = new ReadableStream({
        async start(controller) {
            const write = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            try {
                const summary = await processBatch(items, {
                    signal: abort.signal,
                    persist: saveResult, // results are searchable as a side effect of the run
                    onResult: (o: ItemOutcome) => write({ type: "result", ...o }),
                    onProgress: (done, total) => write({ type: "progress", done, total }),
                });
                write({ type: "summary", ...summary });
            } catch (e) {
                write({ type: "error", message: e instanceof Error ? e.message : String(e) });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no", // tell nginx not to buffer, so chunks flush live
        },
    });
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
