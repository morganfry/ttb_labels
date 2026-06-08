import type { ItemOutcome, BatchSummary } from "./orchestration";

/**
 * One line of the verify routes' NDJSON stream. A discriminated union on `type`
 * so consumers get exhaustive, typed access instead of `any` — and the `result`
 * variant reuses {@link ItemOutcome}, so its ok/error split is already narrowed.
 */
export type StreamEvent =
    | { type: "start"; total: number }
    | { type: "progress"; done: number; total: number }
    | ({ type: "result" } & ItemOutcome)
    | ({ type: "summary" } & BatchSummary)
    | { type: "error"; message: string };

/**
 * Read an NDJSON response body line-by-line, invoking `onEvent` for each parsed
 * line. Shared by both verify screens so the read/decode/split loop lives in one
 * place. A malformed line is logged and skipped (never fatal); the trailing line
 * without a newline is flushed at the end.
 */
export async function readNdjsonStream(res: Response, onEvent: (evt: StreamEvent) => void): Promise<void> {
    if (!res.body) throw new Error("Response has no readable body.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const emit = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        try { onEvent(JSON.parse(line) as StreamEvent); }
        catch { console.error("Malformed NDJSON line:", line); }
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
            emit(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
    }
    emit(buf);
}
