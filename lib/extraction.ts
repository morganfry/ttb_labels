/**
 * Shared vision-model integration used by BOTH the label and form parsers.
 * The model is a per-call parameter, so "same model for both" is a one-arg
 * choice rather than a structural commitment. This module is ignorant of
 * labels vs. forms — it takes an image, a prompt, and a validator.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

/* API key is read from the environment, never passed by callers and never
 * placed in a committed config file — it is a secret. */
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export interface ExtractionInput {
    /** Base64-encoded image or single-page PDF. */
    base64: string;
    mediaType: MediaType;
}

/**
 * Failure taxonomy. Distinguished so callers can react appropriately — in
 * particular `network` is its own kind because the deployment environment may
 * block outbound model traffic, which is an infrastructure problem to surface
 * differently from a bad document.
 */
export type ExtractionErrorKind =
    | "network"   // API unreachable / timed out (firewall, outage)
    | "api"       // API returned an error status
    | "empty"     // model returned no text content
    | "parse"     // text was not valid JSON after cleanup
    | "shape"     // parsed JSON failed the caller's validator
    | "refusal";  // model returned prose instead of data

export class ExtractionError extends Error {
    constructor(public kind: ExtractionErrorKind, message: string, public raw?: string) {
        super(message);
        this.name = "ExtractionError";
    }
}

export interface ExtractionResult<T> {
    data: T;
    model: string;
    /** Raw model text, retained for audit/debug. NOTE: contains the extracted
     *  field values — factor into any data-retention policy before persisting. */
    raw: string;
    latencyMs: number;
}

export interface ExtractOptions<T> {
    /**
     * One source, or several to transcribe together as a single subject — e.g.
     * the front and back images of one label. Multiple sources are sent as
     * multiple content blocks in one model call, not separate calls, so the
     * model reconciles them into one structured answer.
     */
    input: ExtractionInput | ExtractionInput[];
    systemPrompt: string;
    /**
     * Validates and narrows the parsed JSON to T. Return null (or throw) to
     * signal a shape mismatch. Keeps this module ignorant of label vs. form.
     */
    validate: (parsed: unknown) => T | null;
    /** Override the default model for this call. */
    model?: string;
}

/**
 * Extract structured data from one image/PDF.
 *
 * @typeParam T - the validated output shape.
 * @returns the parsed data plus the model used, raw text, and latency.
 * @throws {ExtractionError} classified by {@link ExtractionErrorKind}.
 */
export async function extract<T>(opts: ExtractOptions<T>): Promise<ExtractionResult<T>> {
    const model = opts.model ?? config.model;
    const start = Date.now();
    const raw = await callModelWithRetry(opts.input, opts.systemPrompt, model);

    if (!raw || raw.trim().length === 0) throw new ExtractionError("empty", "Model returned no text content.");

    const cleaned = stripToJson(raw);
    if (cleaned === null) throw new ExtractionError("refusal", "Model response contained no JSON object.", raw);

    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); }
    catch { throw new ExtractionError("parse", "Model output was not valid JSON.", raw); }

    let data: T | null;
    try { data = opts.validate(parsed); }
    catch (e) { throw new ExtractionError("shape", `Validation threw: ${(e as Error).message}`, raw); }
    if (data === null) throw new ExtractionError("shape", "Parsed JSON did not match expected shape.", raw);

    return { data, model, raw, latencyMs: Date.now() - start };
}

/**
 * Calls the model, retrying only on transient errors. A refusal or shape
 * mismatch won't improve by re-asking identically, so those fail fast rather
 * than burning latency against the per-label budget.
 */
async function callModelWithRetry(input: ExtractionInput | ExtractionInput[], systemPrompt: string, model: string): Promise<string> {
    const inputs = Array.isArray(input) ? input : [input];
    // Each source becomes its own content block; a leading note tells the model
    // that several sources describe one subject so it merges rather than picks.
    const sourceBlocks = inputs.map(buildSourceBlock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lead: any[] = inputs.length > 1
        ? [{ type: "text", text: `The following ${inputs.length} images are different views (e.g. front, back, neck) of a SINGLE label. Transcribe each field once, drawing from whichever view shows it.` }]
        : [];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            const message = await client.messages.create({
                model,
                max_tokens: config.maxTokens,
                system: systemPrompt,
                messages: [{
                    role: "user",
                    content: [
                        ...lead,
                        ...sourceBlocks,
                        { type: "text", text: "Transcribe per your instructions. Output JSON only." },
                    ],
                }],
            });
            return message.content
                .filter((b): b is Anthropic.TextBlock => b.type === "text")
                .map((b) => b.text)
                .join("\n");
        } catch (err) {
            lastErr = err;
            if (!isTransient(err) || attempt === config.maxRetries) break;
            await sleep(config.retryBaseMs * 2 ** attempt); // exponential backoff
        }
    }
    if (isNetworkError(lastErr)) throw new ExtractionError("network", `Could not reach the model API: ${errMsg(lastErr)}`);
    throw new ExtractionError("api", `Model API error: ${errMsg(lastErr)}`);
}

/** Images and PDFs require different content-block shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSourceBlock(input: ExtractionInput): any {
    if (input.mediaType === "application/pdf") {
        return { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } };
    }
    return { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } };
}

/**
 * Defend against a disobeyed "JSON only" instruction: strip code fences and
 * extract the outermost {...}, so a stray "Here is the JSON:" preamble can't
 * break parsing. Trust the prompt, but don't depend on it.
 */
export function stripToJson(text: string): string | null {
    let t = text.trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    return t.slice(first, last + 1);
}

/** Rate-limit (429) and 5xx are worth retrying; so are network failures. */
function isTransient(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    if (status === 429) return true;
    if (status && status >= 500) return true;
    return isNetworkError(err);
}

function isNetworkError(err: unknown): boolean {
    const code = (err as { code?: string })?.code;
    return code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND"
        || /network|timeout|fetch failed/i.test(errMsg(err));
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
