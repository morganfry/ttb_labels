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
import { workItemMediaType, isDocName } from "@/lib/mediaType";
import { saveResult, migrate } from "@/lib/persistence";
import { config } from "@/lib/config";

export const runtime = "nodejs";   // needs Buffer / pdf-lib (not edge)
export const maxDuration = 300;    // serverless function cap (Vercel/Next); a long-running Render server ignores it

interface Pair { id: string; name: string }

export async function POST(req: Request): Promise<Response> {
    await migrate(); // idempotent; ensures tables exist on a fresh DB

    // Reject by Content-Length BEFORE buffering (DoS guard). Require the header so
    // a chunked / length-absent request can't slip past with Number(null)===0.
    const len = Number(req.headers.get("content-length"));
    if (!Number.isFinite(len) || len <= 0)
        return json({ error: "A Content-Length header is required for uploads." }, 411);
    if (len > config.uploadMaxBytes)
        return json({ error: `Request exceeds the ${config.uploadMaxBytes}-byte upload limit; upload fewer/smaller files.` }, 413);

    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Expected multipart/form-data." }, 400); }

    let pairs: Pair[];
    try {
        pairs = JSON.parse(String(form.get("pairs") ?? "[]"));
    } catch { return json({ error: "Missing or invalid `pairs` manifest." }, 400); }
    if (!Array.isArray(pairs) || pairs.length === 0)
        return json({ error: "Missing or invalid `pairs` manifest." }, 400);
    if (pairs.length > config.verifyMaxItems)
        return json({ error: `Too many applications in one request (max ${config.verifyMaxItems}); upload in smaller batches.` }, 413);

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
        if (!isDocName(p.name)) // reject up front rather than mis-routing a .tiff/.heic to pdf-lib
            return json({ error: `"${p.name}" is not a supported type — upload a PDF or an image (JPG/PNG/WebP/GIF).` }, 415);
        if (file.size > config.verifyMaxFileBytes)
            return json({ error: `"${p.name}" exceeds the ${config.verifyMaxFileBytes}-byte per-file limit.` }, 413);
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
                // Log the detail; send the client a generic message (no internals).
                console.error("Verify batch error:", e);
                write({ type: "error", message: "Processing failed on the server." });
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
