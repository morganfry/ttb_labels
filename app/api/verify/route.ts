/**
 * POST /api/verify — process uploaded applications and stream results.
 *
 * Accepts multipart form data: a `pairs` manifest plus a `file_<id>` per
 * application (one combined document, reused for both the form and label
 * regions, so it is uploaded once). Responds with newline-delimited JSON
 * (NDJSON), one line per finished item, so the client table fills row by row
 * rather than waiting for the whole batch — the realization of the per-label
 * latency expectation.
 */
import { processBatch, type WorkItem, type ItemOutcome } from "@/lib/orchestration";
import { workItemMediaType } from "@/lib/mediaType";
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

    // Combined-document model: the same uploaded file serves as both label and
    // form (two regions of one document); the parsers read different parts of it.
    // A PDF is sliced downstream; an image (media type inferred from the name) is
    // read whole by both parsers. Read the bytes once and share the reference for
    // both regions — downstream slicing only reads (pdf-lib never mutates input),
    // so there is no aliasing hazard, and the file is uploaded once.
    const items: WorkItem[] = [];
    for (const p of pairs) {
        const file = form.get(`file_${p.id}`);
        if (!(file instanceof File)) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        items.push({
            id: p.id, name: p.name,
            labelPdf: bytes,
            formPdf: bytes,
            mediaType: workItemMediaType(p.name),
        });
    }
    if (items.length === 0) return json({ error: "No valid files found in upload." }, 400);

    const encoder = new TextEncoder();
    // Cancel the batch if the client disconnects, so we don't keep paying for
    // model calls whose results no one will read.
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());

    const stream = new ReadableStream({
        async start(controller) {
            const write = (obj: unknown) => {
                try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { /* client gone */ }
            };
            // CHROME LARGE-UPLOAD FIX: Chrome aborted big uploads on this route
            // with net::ERR_FAILED while Firefox and a curl probe (12 MB over
            // HTTP/1.1 and HTTP/2) succeeded — so it wasn't a body-size limit but
            // a byte-silent response: this route used to send nothing until the
            // first per-item result, which for a large/slow PDF is many seconds
            // out, and an idle response that long after the upload gets killed.
            // Emitting an instant `start` byte plus a periodic `ping` keeps the
            // stream flowing so it's never silent. Both events are ignored by the
            // client (only result/progress/summary are acted on); this also brings
            // the route to parity with the CSV route, which already opened with a
            // byte and was not affected.
            write({ type: "start", total: items.length });
            const keepAlive = setInterval(() => write({ type: "ping" }), 10_000);
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
                clearInterval(keepAlive);
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
