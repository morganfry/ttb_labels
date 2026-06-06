# Architecture

Three views of the system, from outside in:

1. **System context** — the app and the things outside it.
2. **Components** — the modules inside the app and how the two intake paths converge.
3. **Verification sequence** — what happens, in order, for one application.

The diagrams are Mermaid and render inline on GitHub. The guiding principle to
keep in mind while reading them: **the model transcribes verbatim; deterministic
code judges.** Every compliance decision lives in `lib/matching.ts`, never in a
prompt.

---

## 1. System context

A single Next.js deployable plus a database, talking to one external service (the
vision model) and — for CSV-by-URL intake only — arbitrary image hosts. The
dashed box is the trust/network boundary: the only required outbound traffic is
to the model API, which in a locked-down federal network must be allow-listed.

```mermaid
flowchart LR
    agent["TTB compliance agent<br/>(browser)"]

    subgraph app["TTB Label Verification — Next.js app"]
        ui["Web UI + API routes<br/>(model API key stays server-side)"]
    end

    db[("PostgreSQL<br/>extracted text + verdicts only")]

    subgraph cloud["Outside the deployment network"]
        model["Anthropic vision model API<br/>(label + form transcription)"]
        imgs["Label image hosts<br/>(CSV URL intake only)"]
    end

    agent -->|"upload PDFs / CSV, read verdicts"| ui
    ui -->|"persist + query"| db
    ui -->|"HTTPS outbound — needs allow-listing"| model
    ui -->|"fetch images (best-effort SSRF guard)"| imgs
```

Notes:
- **No COLA integration** — this is a standalone proof-of-concept by design.
- **Retention:** only extracted text and verdicts are stored. Uploaded PDFs and
  label images (URL- or ZIP-sourced) are processed in memory and discarded.
- The CSV **ZIP-of-images** option avoids the `imgs` edge entirely, which is the
  safer choice when outbound fetching is restricted.

---

## 2. Components

Two intake fronts — **PDF** and **CSV** — converge on one shared spine
(`runPool` → `matching.verify` → `persistence`). The CSV path only swaps the
*front*: application data comes from columns instead of a form model-read, and
label images are resolved from URLs/ZIP instead of sliced from a PDF. From
matching onward the two paths are identical.

```mermaid
%%{init: {'flowchart': {'rankSpacing': 90, 'nodeSpacing': 40}}}%%
flowchart TB
    subgraph browser["Browser — React / Next.js client"]
        tabs["HomeTabs (PDF / CSV tabs)"]
        pdfui["VerificationApp"]
        csvui["CsvVerify"]
        search["SearchView (Review History)"]
        detect["detectClient<br/>(advisory pre-flight)"]
    end

    subgraph api["API routes — Node runtime, NDJSON streaming"]
        rverify["POST /api/verify"]
        rcsv["POST /api/verify-csv"]
        rsearch["GET /api/search"]
        rresult["GET /api/results/:id"]
    end

    subgraph core["Core library (lib/) — framework-free, unit-tested"]
        orch["orchestration<br/>processBatch · runPool · processOne"]
        csvorch["csvOrchestration<br/>processCsvBatch · processOneCsv"]
        slice["pdfFirstPage<br/>extractFirstPage · extractLabelArtwork"]
        csvparse["csvParse<br/>columns → ApplicationData + image refs"]
        imgs["imageFetch · zipImages<br/>resolve label images (URL / ZIP)"]
        parsers["parsers<br/>parseLabel · parseForm"]
        extraction["extraction<br/>shared vision-model call"]
        matching["matching.verify<br/>THE JUDGE — confidence-gated"]
        helpers["textNormalize · unitParse"]
        schema["schema<br/>FIELD_RULES · rulesets · warning text"]
        config["config<br/>models · caps · concurrency"]
        persistence["persistence (barrel)<br/>saveResult · search · getResult"]
        detrules["detectionRules (pure)"]
    end

    db[("PostgreSQL")]
    model["Anthropic model API"]

    tabs --> pdfui & csvui
    pdfui -->|"multipart PDFs"| rverify
    csvui -->|"CSV + optional ZIP"| rcsv
    search --> rsearch
    pdfui -. advisory .-> detect
    detect --> detrules

    rverify --> orch
    rcsv --> csvorch
    rsearch --> persistence
    rresult --> persistence

    orch --> slice & parsers
    csvorch --> csvparse & imgs & parsers
    orch -->|"runPool"| matching
    csvorch -->|"runPool"| matching
    orch --> persistence
    csvorch --> persistence

    parsers --> extraction --> model
    extraction --> config
    matching --> schema & helpers
    persistence --> db
```

Reading aids:
- **`matching.verify` is the only judge.** Both fronts feed it; it reads the
  rules from `schema.ts` and resolves each field with a tolerant / numeric /
  strict matcher, gated by read confidence.
- **`extraction` is label/form-agnostic** — one shared model integration; the
  model id is a per-call argument (label defaults to a faster tier, form to the
  general one; see `config.ts`).
- **`detectClient` is advisory only** and runs in the browser; it never gates
  server-side processing.
- **`persistence` is a barrel** — the rest of the app imports from it, not from
  `db`/`persistWrite`/`persistQuery` directly.

---

## 3. Verification sequence (one PDF application)

The runtime view: detect → slice → transcribe (two models,
concurrently) → judge → persist → stream, with results flowing back per item
rather than after the whole batch (the per-label latency requirement).

```mermaid
sequenceDiagram
    actor Agent
    participant UI as VerificationApp (browser)
    participant API as POST /api/verify
    participant Pool as runPool / processOne
    participant Slice as pdfFirstPage
    participant Model as Anthropic API
    participant Judge as matching.verify
    participant DB as Postgres

    Agent->>UI: drop combined PDF(s)
    UI->>UI: detectClient — advisory Form/Label chips
    Agent->>API: process queued applications (multipart)
    API->>API: migrate(), then build the work list

    loop each application (bounded concurrency)
        API->>Pool: processOne(item)
        Pool->>Slice: extractFirstPage (form → page 1)
        Pool->>Slice: extractLabelArtwork (label → image pages)
        par label + form, concurrently
            Pool->>Model: parseLabel (Haiku)
        and
            Pool->>Model: parseForm (Sonnet)
        end
        Model-->>Pool: verbatim field values + per-field confidence
        Pool->>Judge: verify(label, app, confidence)
        Note over Judge: deterministic + confidence-gated.<br/>Government warning checked strictly.
        Judge-->>Pool: per-field verdicts + overall
        Pool->>DB: saveResult (non-fatal — a lost write never drops a verdict)
        Pool-->>API: ItemOutcome
        API-->>UI: NDJSON result line (streamed)
        UI->>UI: reducer appends the row
    end
    API-->>UI: summary
```

**CSV variant.** Same diagram with the front swapped: instead of slicing a PDF
and model-reading the form, `csvParse` turns the row's columns into the
application data, and `imageFetch`/`zipImages` resolve the label images (from
URLs or the uploaded ZIP). The label is still model-read; `verify`, persistence,
streaming, and the shared `runPool` are identical.

---

## Why these choices

- **One vision model, not OCR-then-parse** — fewer moving parts; the model reads
  degraded artwork better than a brittle OCR pipeline.
- **Model transcribes, code judges** — verdicts are deterministic, testable, and
  auditable; the model can't "decide" compliance.
- **Confidence gate** — a low-confidence read routes to *review*, never a
  confident *fail*; the government warning is the deliberate exception.
- **Two paths, one judge** — PDF and CSV share matching, persistence, streaming,
  and the worker pool, so they can't drift.
- **Streaming over batch-blocking** — results land per application (~seconds),
  not after the whole batch.
- **Relational store, text + verdicts only** — portable across any Postgres;
  no document bytes retained.
