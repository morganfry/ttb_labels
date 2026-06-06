/**
 * POST /api/verify-csv — bulk-verify applications from a CSV upload.
 *
 * Accepts multipart form data with a single `csv` file. Each row supplies the
 * COLA Part I values in named columns plus a JSON array of label-image URLs;
 * the server fetches and transcribes the images, matches them against the row,
 * and streams one NDJSON line per finished row — the same wire format as
 * /api/verify, so the client renders both paths identically.
 */
import { processCsvBatch, type CsvWorkItem } from "@/lib/csvOrchestration";
import { parseCsv } from "@/lib/csvParse";
import { saveResult, migrate } from "@/lib/persistence";
import { config } from "@/lib/config";
import type { ItemOutcome } from "@/lib/orchestration";

export const runtime = "nodejs"; // needs Buffer / outbound fetch
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
    await migrate(); // idempotent; ensures tables exist on a fresh DB

    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Expected multipart/form-data." }, 400); }

    const file = form.get("csv");
    if (!(file instanceof File)) return json({ error: "Missing `csv` file in upload." }, 400);

    const text = await file.text();
    const { rows, headerError } = parseCsv(text, config.csvMaxImagesPerRow);
    if (headerError) return json({ error: headerError }, 400);
    if (rows.length === 0) return json({ error: "The CSV has no data rows." }, 400);

    // Build work items. Rows that failed validation become pre-failed items so
    // they still appear in the stream and the summary counts, rather than being
    // silently dropped.
    const items: CsvWorkItem[] = rows.map((row) => {
        const id = `row-${row.rowNumber}`;
        const name = row.app?.serialNumber || `Row ${row.rowNumber}`;
        if (row.error || !row.app || !row.imageUrls) {
            return {
                id, name, app: row.app!, imageUrls: row.imageUrls ?? [],
                preError: { kind: "unknown", stage: "match", message: row.error ?? "Invalid row.", retryable: false },
            };
        }
        return { id, name, app: row.app, imageUrls: row.imageUrls };
    });

    const encoder = new TextEncoder();
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());

    const stream = new ReadableStream({
        async start(controller) {
            const write = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            try {
                // Announce the total up front so the client can size its progress
                // bar before the first row finishes.
                write({ type: "start", total: items.length });
                const summary = await processCsvBatch(items, {
                    signal: abort.signal,
                    persist: saveResult,
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
            "X-Accel-Buffering": "no",
        },
    });
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
