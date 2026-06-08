/**
 * POST /api/verify-csv — bulk-verify applications from a CSV upload.
 *
 * Accepts multipart form data with a `csv` file and the label-image uploads:
 * `images` parts (ZIP archives) and/or `image` parts (individual image files).
 * Each row supplies the COLA Part I values in named columns plus a JSON array of
 * label-image file names, resolved from the uploaded images (read from memory —
 * the server never fetches images over the network). The server transcribes the
 * images, matches them against the row, and streams one NDJSON line per finished
 * row — the same wire format as /api/verify, so the client renders both paths
 * identically.
 */
import { processCsvBatch, type CsvWorkItem } from "@/lib/csvOrchestration";
import { parseCsv } from "@/lib/csvParse";
import { indexImageSources, type RawImageSource, type ZipImageIndex } from "@/lib/zipImages";
import { saveResult, migrate } from "@/lib/persistence";
import { config } from "@/lib/config";
import type { ItemOutcome } from "@/lib/orchestration";

export const runtime = "nodejs"; // needs Buffer (multipart parsing); images are uploaded, never fetched
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
    await migrate(); // idempotent; ensures tables exist on a fresh DB

    // Reject by Content-Length BEFORE buffering (DoS guard). Require the header so
    // a chunked / length-absent request can't slip past with Number(null)===0.
    const len = Number(req.headers.get("content-length"));
    if (!Number.isFinite(len) || len <= 0)
        return json({ error: "A Content-Length header is required for uploads." }, 411);
    if (len > config.uploadMaxBytes)
        return json({ error: `Request exceeds the ${config.uploadMaxBytes}-byte upload limit.` }, 413);

    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Expected multipart/form-data." }, 400); }

    const file = form.get("csv");
    if (!(file instanceof File)) return json({ error: "Missing `csv` file in upload." }, 400);
    if (file.size > config.csvMaxBytes)
        return json({ error: `CSV exceeds the ${config.csvMaxBytes}-byte limit; split it into smaller files.` }, 413);

    const text = await file.text();
    const { rows, headerError } = parseCsv(text, config.csvMaxImagesPerRow, config.csvMaxRows);
    if (headerError) return json({ error: headerError }, 400);
    if (rows.length === 0) return json({ error: "The CSV has no data rows." }, 400);

    // Optional label-image uploads, for rows that reference files by name:
    // ZIP archives (`images`) and/or individual image files (`image`).
    // Both feed ONE in-memory index; the per-image size/type bounds still apply
    // when each entry is resolved. Check the combined size before reading any
    // bytes so a hostile upload can't balloon RAM past the cap.
    let zipImages: ZipImageIndex | undefined;
    const isUploaded = (f: FormDataEntryValue): f is File => f instanceof File && f.size > 0;
    const zipParts = form.getAll("images").filter(isUploaded);
    const imageParts = form.getAll("image").filter(isUploaded);
    if (zipParts.length || imageParts.length) {
        const totalBytes = [...zipParts, ...imageParts].reduce((n, f) => n + f.size, 0);
        if (totalBytes > config.csvImageZipMaxBytes) {
            return json({ error: `Uploaded label images exceed the ${config.csvImageZipMaxBytes}-byte limit.` }, 400);
        }
        const sources: RawImageSource[] = [];
        for (const z of zipParts) sources.push({ zip: new Uint8Array(await z.arrayBuffer()) });
        for (const i of imageParts) sources.push({ name: i.name, bytes: new Uint8Array(await i.arrayBuffer()) });
        try {
            // Enforce the decompressed budget so a crafted ZIP can't balloon memory.
            zipImages = indexImageSources(sources, {
                maxEntryBytes: config.csvImageMaxBytes,
                maxTotalBytes: config.csvImageZipMaxTotalBytes,
            });
        } catch (e) {
            // Only a ZIP source can fail to parse; loose images never do.
            return json({ error: `Could not read an uploaded image ZIP: ${e instanceof Error ? e.message : String(e)}` }, 400);
        }
    }

    // Build work items. Rows that failed validation become pre-failed items so
    // they still appear in the stream and the summary counts, rather than being
    // silently dropped.
    const items: CsvWorkItem[] = rows.map((row) => {
        const id = `row-${row.rowNumber}`;
        const name = row.app?.serialNumber || `Row ${row.rowNumber}`;
        if (row.error || !row.app || !row.imageRefs) {
            return {
                id, name, app: row.app!, imageRefs: row.imageRefs ?? [],
                preError: { kind: "unknown", stage: "match", message: row.error ?? "Invalid row.", retryable: false },
            };
        }
        return { id, name, app: row.app, imageRefs: row.imageRefs };
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
                    zipImages,
                    onResult: (o: ItemOutcome) => write({ type: "result", ...o }),
                    onProgress: (done, total) => write({ type: "progress", done, total }),
                });
                write({ type: "summary", ...summary });
            } catch (e) {
                // Log the detail; send the client a generic message (no internals).
                console.error("Verify-CSV batch error:", e);
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
            "X-Accel-Buffering": "no",
        },
    });
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
