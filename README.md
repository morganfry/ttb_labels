# TTB Label Verification — Prototype

An AI-assisted tool for reviewing alcohol beverage label applications (TTB COLA, Form 5100.31). An agent uploads combined application documents; the app extracts the label fields and the form's Part I data, checks them against TTB requirements, and returns a per-field pass / review / fail verdict in a searchable table. Applications can be submitted three ways: as a combined PDF, as a flat image (JPG/PNG) of one, or — for bulk runs — as a CSV of application data whose label images are given by URL or by file name in an uploaded ZIP.

This is a standalone proof-of-concept. It does not integrate with the live COLA system.

---

## Features

- **Two ingestion modes** — the Verify screen has a **PDF / image upload** tab and a **CSV bulk** tab. The upload tab reads both the form and the label out of each document; CSV mode takes the application (Part I) data from columns and the label artwork from image references (URLs and/or files in an uploaded ZIP). Both feed the identical matching, persistence, and results pipeline.
- **Upload** — drag-and-drop or browse, single file or bulk. Accepts combined application PDFs (a filled COLA form with the label artwork affixed) **or a flat image (JPG/PNG/WebP/GIF)** of one — a PDF is sliced (page 1 = form, artwork pages = label), while an image (which can't be sliced) is read whole by both parsers. Also accepts a ZIP of such files — expanded in the browser, each file joins the same queue and pipeline (with a real per-entry/total decompressed budget).
- **CSV bulk** — one application per row, with the COLA Part I fields as columns and a final `labelImageUrls` column holding a JSON array of image references. Each reference is either an http(s) URL or the name of a file inside an optional ZIP of label images uploaded alongside the CSV — so artwork on disk can be verified without hosting it. The app reads and transcribes those images, then verifies them against the row. The CSV tab shows the expected format, a worked example, a live cross-check of local files against the ZIP, and a downloadable template.
- **Pre-flight detection** — on upload, each PDF is inspected in the browser to confirm it contains both a filled Part I and an affixed label. Documents missing a piece, or read with low confidence, are flagged for review with a plain-language reason and an explicit "Process anyway" override. This is advisory guidance for the agent, not a gate (see Limitations).
- **Field extraction** — a vision language model transcribes the label fields and the form's Part I fields, each with a per-field confidence rating.
- **Verification** — deterministic matching checks each field with the logic appropriate to it: tolerant matching for names, numeric tolerance for alcohol content and net contents, strict exact matching for the government warning.
- **Streaming results** — applications process concurrently and results stream back per-item, filling a color-coded table (green / amber / red per field) as each finishes. A summary strip tallies passed / needs-review / failed.
- **Result detail** — clicking any result expands a per-field breakdown showing the extracted value and the specific reason for any flag.
- **Searchable history** — every verdict is persisted. A search screen filters past reviews by serial number, brand (partial), outcome, product type, and date range, with pagination and on-demand detail.
- **Two-screen navigation** — a top nav links the Verify and Review History screens.

---

## Using the app (for reviewing agents)

The app has two screens, linked by the top navigation: **Verify** (review new applications) and **Review History** (search past results).

### Verifying applications

1. **Upload.** On the Verify screen, drag application PDFs onto the upload area, or click it to browse. You can add one file or many at once. Each PDF should be a complete application — the COLA form with the label affixed.

2. **Check the pre-flight flags.** Each file appears in a list with two small chips, **Form** and **Label**, showing what was found inside it:
    - **Green** — found clearly. The row is marked *Ready*.
    - **Amber** — found, but the app isn't fully sure (e.g. a scanned form with no text layer).
    - A row marked **Needs review** shows the reason underneath and a **Process anyway** button. Use it when you've looked and the document is fine; the app won't process a flagged document until you do.
    - Remove any file with the **×** on its row, or **Clear all** to start over.

3. **Process.** Once at least one file is *Ready*, the large **Process** button is enabled and shows how many it will run. Click it. A progress bar shows results arriving ("Processing… 3 of 12 done") — you don't have to wait for the whole batch before reading the early ones.

4. **Read the results table.** Each application becomes a row. Every field has a colored verdict:
    - **Green — Pass**: the label matches the application (or meets the requirement).
    - **Amber — Review / Unreadable**: close but not exact, or couldn't be read confidently. Worth a human look.
    - **Red — Fail**: a genuine mismatch or a missing required field.
    - **Gray — N/A**: not applicable to this product type (e.g. wine appellation on a spirit).
      The **Overall** column summarizes the row, and the strip above the table tallies how many passed, need review, or failed.

5. **See why.** Click any row to expand a per-field breakdown showing the value the app read from the label and, for anything flagged, the specific reason (e.g. *"GOVERNMENT WARNING:" must be in all capital letters*). The verdict is guidance — you make the final call.

### Bulk verification by CSV

Switch to the **CSV bulk** tab on the Verify screen when you already have the application data in a spreadsheet and the label artwork hosted at a URL or saved locally.

1. **Prepare the CSV.** One application per row. The COLA Part I fields are columns; the final `labelImageUrls` column is a JSON array of image references — each either an http(s) URL or the name of a file inside the image ZIP (a folder path like `labels/24-1.jpg` works; a bare file name resolves if it is unique in the archive). The tab shows the full column list with notes, a worked example, and a **Download template** button. Required columns: `serialNumber`, `productType` (`wine` / `distilledSpirits` / `maltBeverages`), `source` (`domestic` / `imported`), `brandName`, `applicantNameAddress`, and `labelImageUrls`. Multiple references in one row are treated as several views (front / back / neck) of a single label.

2. **Upload it.** Drag the CSV in or browse to it. The app parses it immediately and shows how many rows are valid and lists any rows with errors (a bad product type, a malformed reference array, a missing required value). Bad rows don't block the others — they're reported, not verified.

3. **(If using local files) attach the image ZIP.** When any row references files by name, an uploader appears for a ZIP of those images. The app reads the archive in the browser and flags any referenced file that isn't in it, before you run. URL-only batches can skip this.

4. **Verify.** Click **Verify N rows**. As with PDFs, results stream into the same table row by row, with the same per-field verdicts and expandable detail. Rows whose images couldn't be fetched, found in the ZIP, or read are listed separately with the reason.

### Searching past reviews

On the **Review History** screen, the most recent reviews load automatically. Narrow them with any combination of filters — serial number, brand (partial text is fine), outcome, product type, and a date range — then click **Search**. Results paginate; click any row to expand the same per-field detail you saw at verification time. **Clear filters** returns to the full recent list.

### Good to know

- **Amber means "look," not "rejected."** The app flags uncertainty rather than deciding for you. Anything amber or red is surfaced so a person can judge it.
- **The government warning is checked strictly** — exact wording and an all-caps header. Small deviations that would be fine elsewhere will fail here, by design.
- **Brand and producer names are matched leniently** — differences in capitalization, punctuation, or spacing won't be treated as a mismatch.

---

## Architecture

> Diagrams (system context, components, verification sequence) live in
> [`docs/architecture.md`](docs/architecture.md).

### Request flow (one application)

```
Upload (combined PDF or image)
   │
   ▼
[1] Detect regions      structural check: filled Part I? affixed label?
   │                    (cheap, no model call; flags ambiguous docs)
   │                    (PDFs only — images skip [1] and [2])
   ▼
[2] Slice                form Part I → page 1 only (model never sees the
   │                     instruction / certification / revision pages);
   │                     label → only the artwork (image-bearing) pages
   ▼
[3] Extract (×2)         one shared model integration, two prompts, run
   │                     concurrently, each on its own model tier:
   │   ├─ form parser   → Part I values  ("what it should be")
   │   └─ label parser  → label fields   ("what's printed")
   ▼
[4] Match               deterministic matchers compare the two sides;
   │                    confidence-gated so a misread never becomes a
   ▼                    false fail
[5] Persist             verdict + field results saved (Postgres);
   │                    uploaded files are NOT stored
   ▼
[6] Stream              result returned per-item; table fills row by row
```

An **image upload** takes the same path with steps [1]–[2] skipped: a flat image can't be detected or sliced, so the one image — which must show the whole application — is fed to both parsers at step [3] verbatim. From matching on, it is identical to the PDF path.

The **CSV path** is the same pipeline with the front end of it swapped: steps [1]–[3] (detect / slice / form-extract) are replaced by reading the application (Part I) values straight from CSV columns and fetching the label images from their URLs. From step [3]'s label extraction onward — transcription, confidence-gated matching, persistence, streaming — both paths are identical and share the same worker pool. The "model transcribes; code judges" invariant is preserved: only the *form* extraction is replaced by explicit columns; the label is still model-read from the fetched images (one model call per row, with every image for that row sent together).

### Layers

**Frontend (Next.js App Router, React, Tailwind).** Two screens — `/` (Verify) and `/search` (Review History) — composed from small components. Shared display constants and the `OverallBadge` / `FieldCards` components are imported by both screens so verdicts look identical everywhere. Client-side region detection runs before upload; processing is driven by a streaming `fetch` to the API.

**API routes (Node runtime).**
- `POST /api/verify` — accepts the uploaded files (PDFs and/or images) as multipart form data, infers each one's media type from its name, runs the batch, and streams results back as newline-delimited JSON (NDJSON), one line per finished application.
- `POST /api/verify-csv` — accepts a CSV file (and an optional `images` ZIP) as multipart form data, parses it to per-row application data + image references, indexes the ZIP into memory, and streams results in the same NDJSON format (so the client renders both paths identically). Invalid rows are reported in the stream rather than dropped.
- `GET /api/search` — queries stored verdicts with combinable filters and pagination.
- `GET /api/results/[id]` — fetches one full result (summary + all field rows) for the detail view.

**Core library (`lib/`).** Framework-independent and unit-testable:
- `schema.ts` — types, the field→matcher rule config, product-type rulesets, the canonical warning text.
- `prompts.ts` — the label and form extraction prompts.
- `mediaType.ts` — pure: classifies a file name (PDF / image / ZIP) and maps an image to its media type; the single source both intakes use to decide PDF-vs-image handling.
- `pdf-first-page.ts` — slices the form to page 1 (hard guard against extra pages) and the label to its artwork (image-bearing) pages, to cut vision-input tokens. PDFs only — a flat image isn't sliced; the one image goes to both parsers.
- `detection-rules.ts` / `detect-client.ts` — structural region detection (pure heuristic + browser adapter). Advisory pre-flight only; see Detection under Limitations.
- `extraction.ts` — one shared vision-model integration; model is a per-call parameter. Accepts one image or several to transcribe together as a single subject.
- `parsers.ts` — the label and form parsers (prompt + validator pairs); `parseLabel` takes one image or an array (the CSV path's multi-view labels).
- `csvParse.ts` — pure CSV tokenizer + per-row validation → application data + image references (URLs or ZIP file names; reused on the client for the pre-submit preview).
- `imageFetch.ts` — resolves label-image references into model inputs: http(s) URLs are fetched (size / timeout caps + a best-effort SSRF guard), ZIP file names are read from the in-memory archive index.
- `zipImages.ts` — pure: expands an uploaded image ZIP into a path/basename → bytes index, shared by the server (resolve) and the client (pre-flight cross-check).
- `zipDocs.ts` — pure: expands a ZIP dropped on the upload tab into its PDF/image entries (browser-side), enforcing a real per-entry/total decompressed budget. Each entry becomes an ordinary work item.
- `matching.ts` — the three matchers + the dispatcher.
- `orchestration.ts` — `runPool`, the concurrency-capped streaming worker pool, plus the PDF per-item pipeline.
- `csvOrchestration.ts` — the CSV per-item pipeline (fetch images → transcribe → match → persist), run through the same `runPool`.
- `persistence.ts` — schema migration, save, search, and fetch (PostgreSQL via `pg`).

### Key design decisions

**One vision model, not OCR-then-parse.** A multimodal model extracts and structures in one call, tolerates imperfect photos better than classical OCR, and stays within a per-label latency budget.

**The model transcribes; code judges.** All compliance logic lives in deterministic, unit-tested matchers. The model is never asked whether something passes — only what the label says. This makes verdicts trustworthy and is what enables the tolerant/strict split.

**Three matchers, routed by config.**
- *Tolerant* (brand, producer, class/type) — normalizes case, punctuation, accents, whitespace, then scores similarity. Exact-after-normalization passes; a near match is flagged for review; a real difference fails. This is what lets "STONE'S THROW" match "Stone's Throw" without manual judgment.
- *Numeric* (alcohol content, net contents) — parses value and unit and compares within a tolerance, so "750 mL" equals "0.75 L".
- *Strict* (government warning) — exact comparison against the mandated 27 CFR 16.21 text, including the all-caps header requirement; only line-wrapping whitespace is tolerated.

**Confidence-gated matching.** Because both sides are model-read, a mismatch could be a real mismatch or a misread. If either side was read with low confidence, the field resolves to "unreadable" (review) rather than a confident fail. The government warning is the deliberate exception: a missing or altered warning fails regardless of read confidence.

**Combined PDF, two regions.** Form and label arrive as one document, so there is no file-pairing problem; the app instead verifies both regions are present before processing.

**Two ingestion paths, one judge.** PDF and CSV intake differ only in how the application side and the label image are obtained (extracted from a document vs. read from columns + fetched URLs). They converge on the same label extraction, matchers, persistence, and streaming — so a CSV verdict means exactly what a PDF verdict means. CSV intake replaces only the form read with explicit columns; it never moves a compliance decision out of the matchers.

**Streaming over batch-blocking.** The 5-second expectation is per-label, not per-batch. A worker pool keeps a bounded number of applications in flight and streams each result as it lands, so the table fills progressively and one slow item never holds up the rest.

**Same schema, swappable engine.** The relational schema is the durable artifact. It runs on a managed Postgres here; the schema ports to any Postgres for production.

---

## Tech stack

- **Next.js (TypeScript)** — full-stack framework; App Router; API routes keep the model key server-side.
- **React + Tailwind CSS** — UI.
- **Anthropic vision model** — extraction (one integration for both parsers).
- **pdf-lib** — page slicing and structural region detection.
- **PostgreSQL via `pg`** — persistence and search; runs against any Postgres (managed, on-prem, or local Docker).
- **Docker** — containerized deploy to any host.
- **fastest-levenshtein** — string distance for the tolerant matcher.
- **Vitest** — the matching-core test suite.
- **lucide-react** — icons.

---

## Setup

### Prerequisites
- Docker (for the one-command local path), **or** Node.js 20+ and a PostgreSQL database
- An Anthropic API key

### Local deployment — Option A: Docker Compose (recommended)
Runs the app and a Postgres database together with one command.
```bash
# from the project root
export ANTHROPIC_API_KEY=sk-ant-...        # or put it in a .env file beside docker-compose.yml
docker compose up --build
```
- App: http://localhost:3000
- Postgres: localhost:5432 (created automatically, data persisted in a Docker volume)
- The database schema is created on the first request — no migration step.
- Stop with `Ctrl+C`; tear down completely (including data) with `docker compose down -v`.

### Local deployment — Option B: Node directly
Use this if you'd rather run the app on your host. You need a Postgres to point at; the quickest is a throwaway container:
```bash
# 1. start a local Postgres (skip if you already have one)
docker run -d --name labels-db -p 5432:5432 \
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=labels \
  postgres:16-alpine

# 2. configure environment
cat > .env.local <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://app:app@localhost:5432/labels
EOF

# 3. install and run
npm install
npm run dev          # http://localhost:3000

# (optional) run the test suite
npm test
```

### Environment variables
```
ANTHROPIC_API_KEY=sk-ant-...                            # required; never commit
DATABASE_URL=postgres://app:app@localhost:5432/labels   # required
PGSSLMODE=require        # only if your Postgres requires TLS (managed providers)
MODEL=claude-...         # optional; general/default model (default in lib/config.ts)
LABEL_MODEL=claude-...   # optional; model for the label read (default: a faster tier, claude-haiku-4-5)
FORM_MODEL=claude-...    # optional; model for the form read (default: MODEL / claude-sonnet-4-6)
BATCH_CONCURRENCY=6      # optional concurrency override
CSV_IMAGE_MAX_BYTES=12582912     # optional; per-image size cap for CSV labels (URL or ZIP; default 12 MiB)
CSV_IMAGE_FETCH_TIMEOUT_MS=15000 # optional; per-image fetch timeout for the CSV URL path
CSV_MAX_IMAGES_PER_ROW=6         # optional; max label image references per CSV row
CSV_IMAGE_ZIP_MAX_BYTES=104857600 # optional; max uploaded image-ZIP size (default 100 MiB)
PDF_ZIP_MAX_BYTES=209715200       # optional; max dropped PDF-ZIP size, compressed (default 200 MiB)
PDF_ZIP_MAX_ENTRY_BYTES=52428800  # optional; max decompressed size of one PDF in the ZIP (default 50 MiB)
PDF_ZIP_MAX_TOTAL_BYTES=524288000 # optional; max total decompressed PDFs from one ZIP (default 500 MiB)
```
`.env.local` is gitignored and read only in local development.

### Before first run
- Set the model via `MODEL` or the default in `lib/config.ts`.
- Verify the installed `@anthropic-ai/sdk` and `pg` versions match the call shapes in `lib/extraction.ts` and `lib/db.ts`.

### Deploy to any server
Build the container and run it anywhere — a cloud VM, a container platform, or on-prem:
```bash
docker build -t label-verification .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  label-verification
```
The schema is created on the first request (idempotent migration). If a reverse proxy sits in front, disable response buffering so the verify route can stream results incrementally (the route sets `X-Accel-Buffering: no` for nginx).

### Deploy to Render (Blueprint)
A committed Render Blueprint (`render.yaml`) provisions the app as a Docker web
service plus a managed Postgres in one step. From the Render dashboard: **New →
Blueprint → pick this repo**; Render builds the existing `Dockerfile`, wires
`DATABASE_URL` from the database, and prompts once for `ANTHROPIC_API_KEY` (kept
as a secret, never committed).

A persistent web service is the right fit because the app uploads whole PDFs and
streams NDJSON results — neither survives a serverless function's request-body
cap or response buffering.

Deploys are **test-gated**: Render's own auto-deploy is off (`render.yaml`:
`autoDeploy: false`), and the GitHub workflow (`.github/workflows/ci.yml`)
typechecks, tests, and builds on every push, then POSTs a Render **Deploy Hook**
only on a green `main` — so a red build blocks the deploy. Add the hook URL
(Render dashboard → the service → Settings → Deploy Hook) as the GitHub Actions
secret `RENDER_DEPLOY_HOOK_URL`.

---

## Assumptions

- Each uploaded PDF is one complete application: a filled COLA Part I plus the affixed label artwork.
- For CSV intake, each row's columns are treated as authoritative application (Part I) data — they are not re-read from any document — and the listed image references resolve to that application's label artwork: either http(s) URLs reachable from the server, or files present in the uploaded image ZIP.
- The canonical government-warning text used for the strict check is the standard 27 CFR 16.21 wording. **Verify this string against the current regulation before any real use** — the strict matcher is only as correct as that constant.
- Product type (form item 5) selects which validation ruleset applies. When it can't be read confidently, a conservative default is used, but in production this should gate to human confirmation, since it controls the whole comparison profile.
- The reviewing agent makes the final call. Every "review" outcome and detection flag is an invitation for human judgment, not an automated rejection.

---

## Limitations and trade-offs

- **Bold detection is approximate.** The warning header's bold requirement is judged visually by the model, which is less reliable than reading text. A bold-only doubt is downgraded to review rather than a hard fail.
- **Correlated misreads can produce a false pass.** On fields matched between the label and the form (brand, producer, appellation), both sides are read by the model. If it misreads the *same* text the *same* wrong way on both — and does so confidently — the two corrupted values match each other and the field passes, hiding a real discrepancy. The cause is the similarity of the inputs, not the use of one model; two different models can share the same blind spots. This is mitigated, not eliminated, by the confidence gate (an ambiguous read usually returns low confidence and routes to review), and it cannot affect the government warning, which is matched against a fixed constant rather than a second model read. Hardening options for production: extract high-stakes fields at two resolutions/crops and require agreement, cross-check derivable relationships (e.g. proof = ABV × 2), or always surface the extracted values to the agent on a pass, not only on a flag.
- **Net-contents parsing is not exhaustive.** Common units (mL, cL, L, fl oz) are handled; compound US statements like "1 PINT 9 FL OZ" are not yet parsed and would flag for review.
- **Tolerant fields apply field-aware normalization + a containment rule.** Before scoring, the producer name/address folds away a label-only "BOTTLED BY"-style prefix and maps full US state names to abbreviations ("…Charleston, South Carolina" ≡ "…, SC"), and the fanciful name drops a leading vintage year ("2023 Rosé" ≡ "Rosé"). In addition, when one name's words are fully contained in the other (≥2 shared words) it's treated as a confident match — so a label that drops a suffix ("VERONA HILLS" ≡ "Verona Hills Vineyards") or carries extra boilerplate ("ESTATE BOTTLED BY …") still matches. All of this affects only the *scored* text (displayed values stay verbatim). The trade-off is a small, rare false-pass surface — a company named after a state, two fanciful names differing only by a leading year, or a name that is a strict subset of an unrelated one — bounded by the confidence gate and human review; none of it can affect the government warning.
- **Detection is heuristic and advisory (client-side only).** Region detection uses structural signals (template markers, embedded images), not full extraction, and runs in the browser to flag documents for the agent — it does not gate server-side processing. Correctness is enforced regardless by the confidence-gated matcher: a misdetected or low-quality document yields low-confidence reads that route to review, never a confident false pass. (A form flattened into a single image has no text layer and is treated as low-confidence rather than assumed valid.) Production hardening could add a server-side re-check and a dedicated text extractor for scans.
- **Cloud model vs. network policy.** The prototype calls a hosted model API. In a restricted federal network this traffic may be blocked; production deployment would need the endpoint allow-listed or an in-network model. This is the single most likely thing to break a real deployment.
- **Inference provider for a real (federal) deployment.** Beyond mere network reachability, the prototype's commercial cloud model endpoint would not satisfy federal authorization requirements as-is. A production system processing real COLA submissions would have to run inference on a **FedRAMP-authorized** service (e.g. a model offered within a FedRAMP / GovCloud boundary at the appropriate impact level) **or a self-hosted / in-boundary model** inside the system's accreditation boundary. Because the code keeps the model behind one swappable integration (`lib/extraction.ts`, model id as a per-call parameter) and judges deterministically in code, changing the inference backend is contained — but it is a prerequisite for any real use, not an optional hardening step.
- **CSV image fetching is server-side and only lightly guarded.** When a row references images by URL, the server fetches arbitrary URLs. There is a best-effort SSRF guard (http(s) only; loopback, link-local, and RFC-1918 hosts rejected) and size/timeout caps, but it is not DNS-rebinding-proof. A production deployment should front it with an allow-list or an egress proxy. The ZIP option avoids outbound fetches entirely and is the safer choice in a locked-down network. Net-contents and ABV still come from the label image, not the CSV, so a CSV row can't assert compliance values directly.
- **The CSV image ZIP is fully decompressed in memory.** Both the server (resolve) and the client (pre-flight cross-check) expand the whole archive, bounded only by a blunt compressed-size cap (`CSV_IMAGE_ZIP_MAX_BYTES`) — not a decompressed-size budget, so it is not hardened against a crafted "zip bomb." Production should stream-extract with a hard per-entry and total decompressed limit.
- **Upload-tab ZIP expansion is in-browser and synchronous.** A dropped ZIP of PDFs and/or images is decompressed client-side (`lib/zipDocs.ts`) before the run; a very large archive briefly blocks the UI thread during extraction. Unlike the CSV image ZIP, it enforces a real decompressed budget (per-entry and total, checked from ZIP metadata before each entry is expanded), so it is hardened against a crafted "zip bomb." Only `.zip` is supported (not 7z/rar/tar/gz).
- **Image intake assumes the whole application is in one image, and skips slicing and pre-flight.** A flat JPG/PNG can't be split into form/label regions, so the single image is sent to both parsers as-is — it must therefore show the filled Part I *and* the affixed label. There is no page-1 slice and no browser pre-flight detection (both are PDF-structure-based) for images; the prompt scope guards and the confidence-gated matcher remain the safeguards. Multi-page applications are better submitted as PDFs.
- **Long batches need a streaming-friendly proxy.** Processing runs in one streaming request. A long-running Node server has no function timeout, so large batches complete fine — but any reverse proxy in front must have response buffering disabled (the route sets `X-Accel-Buffering: no` for nginx) or results won't stream incrementally.
- **No COLA integration.** By design. Results inform a potential future workflow; they are not written back to any system of record.

### Data and retention

The prototype stores extracted text and verdicts only. Uploaded PDFs and label images — including images fetched from CSV URLs and images read from an uploaded image ZIP — are processed in memory and discarded, which sidesteps document-retention and PII questions for a proof-of-concept. CSV image references (URLs and ZIP file names) are not persisted. A production system would need an explicit retention policy and the corresponding federal compliance review.
