# CLAUDE.md — working notes for Claude Code

AI-assisted TTB alcohol label verification (Next.js + TypeScript). This file
captures what isn't obvious from reading the code. For the full picture see
README.md; for file locations and diagrams see docs/architecture.md; for
running it see docs/setup.md.

## Commands
- Run locally: `docker compose up --build`  (app :3000, Postgres :5432)
- Run on host: `npm install && npm run dev`  (needs DATABASE_URL)
- Test: `npm test`  (Vitest; matching core in lib/matching.test.ts)
- Build: `npm run build`  (Next standalone output; Docker uses it)

## Architectural invariants — do not violate
- **The model transcribes; deterministic code judges.** Extraction prompts
  return verbatim field values only. ALL compliance decisions live in
  lib/matching.ts. Never move pass/fail logic into a prompt.
- **Two ingestion paths, one judge.** PDF intake (orchestration.ts) and CSV
  intake (csvOrchestration.ts) converge on the SAME label extraction, matchers,
  persistence, and streaming. CSV replaces only the *form* read with explicit
  columns; the label is still model-read from images resolved per row — by file
  name from the images the agent uploaded (the app NEVER fetches images over the
  network — no URL intake, no SSRF surface; a deliberate choice). Those uploads
  arrive as loose image files AND/OR ZIP archives, but converge on ONE in-memory
  index (indexImageSources in zipImages.ts) — a ZIP is bulk transport, not a
  separate path. Both run through `runPool` (orchestration.ts) — keep the worker
  pool shared, not forked. Don't let the CSV path acquire its own matching or
  persistence logic, and route every image reference through resolveLabelImages
  (imageResolve.ts), not a second code path.
- **PDF and image are one path; an image is just an un-sliceable PDF.** The
  upload tab accepts combined-application PDFs AND flat images (JPG/PNG/…), each
  one application. WorkItem.mediaType (inferred from the file name in the verify
  route via mediaType.ts) decides: "application/pdf" → slice (page 1 = form,
  artwork pages = label); an image type → NO slicing, the one image is fed to
  BOTH parsers verbatim (it shows the whole application). The extraction layer
  already speaks images (buildSourceBlock), so don't add an image-only route or
  parser — just set the media type.
- **A ZIP on the upload tab is transport, not a third path.** A dropped .zip is
  expanded CLIENT-SIDE (zipDocs.ts) into individual PDF/image File objects that
  go through the exact same /api/verify → matcher → persist flow as a
  directly-uploaded file (VerificationApp.addDocs). Don't add server-side ZIP
  handling or a parallel verify route. Unlike the CSV image ZIP, extraction
  enforces a REAL decompressed budget via fflate's pre-decompress filter
  (pdfZipMaxEntryBytes/pdfZipMaxTotalBytes) — keep that; it's the zip-bomb guard.
  Junk-filtering + path normalization are shared with zipImages.ts (ZIP_JUNK_RE,
  normalizeZipPath); file-type classification with mediaType.ts (isPdfName/
  isImageName), not re-implemented.
- **Three homes for constants, kept separate on purpose:**
    - Domain rules (matcher thresholds, tolerances, the warning text) → schema.ts
    - Operational knobs (model/labelModel/formModel, maxTokens, concurrency,
      pageSize, the CSV csvImage*/csvMaxImagesPerRow caps, the PDF pdfZip* caps)
      → config.ts
    - Secrets (ANTHROPIC_API_KEY) → process.env only, never a committed file
      Don't consolidate these; the split is deliberate.
- **Client components read operational caps via `useClientConfig()`, never
  `import { config }`.** config.ts reads process.env, which only resolves at
  runtime on the SERVER; imported into a client component those reads yield the
  compiled DEFAULTS, so an env override (e.g. PDF_ZIP_MAX_BYTES, the CSV caps)
  would silently not reach the browser. The server reads the client-relevant
  subset once in the root layout (clientConfig() in lib/clientConfig.ts →
  ClientConfigProvider) and the consumers (VerificationApp, CsvVerify,
  ResultsTable, LatencySummary) pull it from that context. The layout is
  `force-dynamic` so the seed is read per request, not baked at build. A new
  client-side cap → add it to ClientConfig, don't import config.
- **Tailwind color classes must be full literal strings** (see STATUS_META /
  OVERALL_META in uiTypes.ts). Never build class names by interpolation — the
  scanner purges dynamic ones and styles vanish in the production build.
- **Import persistence via @/lib/persistence (the barrel)**, not db.ts /
  persistWrite.ts / persistQuery.ts directly. Keeps the public surface stable.
- **Page 1 only reaches the form parser** (extractFirstPage, PDF path only). The
  form prompt's scope guard is the backup; the slice is the real guarantee. Don't
  remove either. (Image items can't be sliced — the prompt scope guard is the
  only guard there, by necessity.)
- **Only artwork pages reach the label parser** (extractLabelArtwork, PDF path
  only) — the image-bearing pages, not the whole document, to cut vision latency.
  It is deliberately conservative: it never drops a page that has an image, and
  falls back to the whole PDF when none are detected (or every page has one). It
  must never break the label read — keep the internal try/catch + whole-PDF
  fallback. (Image items skip this entirely; the one image is sent as-is.)
- **Label and form can run on different models** (config.labelModel /
  config.formModel; LABEL_MODEL / FORM_MODEL env). The label is verbatim
  transcription, so it defaults to a faster/cheaper tier; the form stays on the
  general model. processOne resolves per-side: opts.labelModel ?? opts.model ??
  config.labelModel (same shape for the form, and for the CSV label read).

## Confidence gate (the subtle bit in matching.ts)
Both sides of a comparison are model-read, so a "mismatch" may be a misread.
If either side has low confidence, the field resolves to `unreadable` (review),
never a confident `fail`. The government warning is the DELIBERATE exception: a
wrong/missing warning fails regardless of confidence. Preserve this asymmetry.

## Known, deliberate gaps — do not "fix" silently
- productType default: when item 5 is unreadable, toApplicationData() still
  defaults app.productType to "distilledSpirits" to pick *a* ruleset, BUT marks
  appConfidence.productType "low", so verify() escalates the whole verdict to
  review (flagProductTypeUncertain). A low-confidence-but-present item 5 is
  handled the same way. So the ruleset guess never silently produces a confident
  pass — keep that. (source/item 3 is gated the same way for country-of-origin.)
- The confidence gate also covers ABSENT reads: a low-confidence missing required
  field is `unreadable`, not a confident fail (an unreadable image must not look
  like a compliance violation). The government warning stays the exception.
- Bold detection downgrades to `review`, not `fail` (soft visual signal).
- Correlated misreads on matched fields can yield a false pass (see README
  limitations). Mitigated by the confidence gate, not eliminated.
- parseVolumeMl handles mL/cL/L/fl oz only; compound US ("1 PINT 9 FL OZ")
  flags for review by design.
- CSV image ZIP (zipImages.ts) IS zip-bomb-hardened: indexImageSources takes a
  ZipBudget and filters entries by declared uncompressed size (per-entry
  csvImageMaxBytes, total csvImageZipMaxTotalBytes) BEFORE expansion — parity with
  zipDocs.ts — on both server (route) and client (preview). Keep that budget;
  csvImageZipMaxBytes is still the separate compressed-upload cap. (The bare
  indexZipImages test wrapper omits the budget; production callers always pass it.)
- CSV rows that fail validation become pre-failed work items (preError) so they
  surface in the stream and summary instead of being dropped. Keep that. (Rows
  whose local image refs aren't in the ZIP fail per-row at resolve time, and the
  client pre-flights them in the preview before the run.)

## Verify before trusting (things that may be stale)
- config.model / config.labelModel / config.formModel are placeholders —
  confirm all three are current, valid model ids (label defaults to a Haiku
  tier; verify it's accurate enough for the label read on real samples).
- Confirm installed @anthropic-ai/sdk matches the messages.create shape in
  extraction.ts, and pg matches the Pool/query shape in db.ts.
- TTB_GOVERNMENT_WARNING (schema.ts) verified verbatim against current 27 CFR
  16.21 on 2026-06-07 (eCFR / Cornell LII); re-verify if the reg changes — the
  strict check is only as correct as this constant.

## Conventions when extending
- New verifiable field → add to LabelExtraction + FIELD_RULES (+ a rule type
  if needed); the dispatcher routes it. Avoid bespoke per-field code paths.
- CSV columns mirror ApplicationData; the canonical list + validation live in
  csvParse.ts (CSV_COLUMNS). A new application field → add it there AND to the
  UI guide (CsvVerify.tsx COLUMN_NOTES / SAMPLE_CSV), kept in sync.
- labelImages entries are file names of uploaded images (loose files or ZIP),
  resolved from the in-memory index. Per-entry validation lives in csvParse.ts
  validateImageRef — it REJECTS URLs/other schemes (images are uploaded, not
  linked) and absolute/traversal paths, and requires an image extension. Keep
  that validation in csvParse so the client preview and server resolve agree.
- parseLabel accepts one ExtractionInput or an array (multi-view labels); the
  array is sent as multiple content blocks in ONE model call, not N calls.
- New matcher → matching.ts; pure helpers → textNormalize.ts / unitParse.ts.
- Field-aware tolerant cleanup lives behind FieldRule.normalize ("address" strips
  a BOTTLED-BY prefix + maps state names→abbrev; "designation" drops a leading
  vintage year). It's applied to BOTH sides for SCORING only via tolerantMatch's
  scoreLabel/scoreApp — displayed values stay verbatim. Add a preset there rather
  than special-casing a field in the dispatcher.
- tolerantMatch also applies a token-CONTAINMENT boost (tokensSubsumed): if one
  name's words are fully inside the other, score is lifted to a pass. This is
  what makes "VERONA HILLS" match "Verona Hills Vineyards" and absorbs producer
  boilerplate. The min-shared-words floor is the safety bound (a lone shared
  token must not force a match).
- Cross-cutting matcher knobs that aren't per-field/per-type live in
  schema.ts MATCH_TUNING (containmentScore, containmentMinTokens, the default
  threshold/tolerance, netContentsRelativeTolerance) — NOT config.ts, because
  they change verdicts. textNormalize.ts stays dependency-free: matching.ts
  passes the tuning value into tokensSubsumed rather than the helper importing
  schema.
- Pure logic stays framework-free in lib/ and gets a Vitest test (csvParse.ts
  is framework-free precisely so it can be reused on the client for preview).
- Comment the WHY, not the what. TSDoc on exported/public surfaces.
- Shared UI (badges, field cards, display constants) is imported by both
  screens — change once, not per-screen.

## Commits
- Keep messages tight: a one-line imperative subject (~50–72 chars). Add a body
  ONLY when the *why* isn't obvious from the subject — one or two short sentences,
  never a bulleted recap of the diff. (The Co-Authored-By footer is still required.)

## Care
- This is compliance tooling: correctness over cleverness. Don't trade
  extraction reliability for marginal token savings.
- Retention: store extracted text + verdicts only. Never persist uploaded
  file bytes (no schema columns exist for them — keep it that way).


═══════════════════════════════════════════════════════════════
FILE: README.md
═══════════════════════════════════════════════════════════════
# TTB Label Verification — Prototype

An AI-assisted tool for reviewing alcohol beverage label applications (TTB COLA,
Form 5100.31). An agent uploads one or more combined application PDFs; the app
extracts the label fields and the form's Part I data, checks them against TTB
requirements, and returns a per-field pass / review / fail verdict in a
searchable table. Two intake modes: combined PDFs, or a CSV of application data
whose label images are referenced by file name and uploaded alongside (loose files and/or a ZIP), for bulk runs.

This is a standalone proof-of-concept. It does not integrate with the live COLA system.

## Features

- Two ingestion modes — a PDF upload tab and a CSV bulk tab on the Verify
  screen, both feeding the same matching/persistence/results pipeline.
- Upload — drag-and-drop or browse, single or bulk; combined application PDFs
  (a filled COLA form with the label artwork affixed).
- CSV bulk — one application per row: COLA Part I fields as columns + a final
  labelImages column (JSON array of image file names you upload alongside the
  CSV — loose files and/or a ZIP). The app reads those images, then verifies
  against the row. The tab shows the format, an example, and a downloadable
  template.
- Field extraction — a vision model transcribes label and form fields with a
  per-field confidence rating.
- Verification — deterministic matching: tolerant for names, numeric tolerance
  for ABV / net contents, strict exact match for the government warning.
- Streaming results — applications process concurrently; results stream back
  per-item into a color-coded table (green / amber / red per field).
- Result detail — click a row for the per-field breakdown and the reason for any flag.
- Searchable history — every verdict is persisted; filter past reviews by
  serial, brand, outcome, product type, and date range, with pagination.
- Two-screen navigation — Verify and Review History.

## Architecture

Request flow (one PDF application): slice form to page 1 and label to its artwork
pages → extract label + form concurrently (two prompts, one shared integration,
per-side model tiers) → deterministic, confidence-gated matching → persist (text +
verdicts only) → stream result.
CSV path: same pipeline with the front swapped — application data from columns,
label images resolved by name from the uploaded set and transcribed; matching
onward is identical and shares the same worker pool.

Layers:
- Frontend (Next.js App Router, React, Tailwind) — Verify (`/`, PDF + CSV tabs)
  and Review History (`/search`), composed from small components; shared display
  constants and badges keep verdicts identical across screens.
- API routes (Node runtime) — `POST /api/verify` and `POST /api/verify-csv`
  (both stream NDJSON), `GET /api/search`, `GET /api/results/[id]`.
- Core library (`lib/`) — framework-independent and unit-testable: schema +
  rule config, prompts, page slicer, shared extraction, parsers, matchers +
  dispatcher, batch orchestration (runPool + PDF and CSV per-item pipelines),
  CSV parse + image fetch, persistence (pg).

Key decisions: one vision model rather than OCR-then-parse; the model
transcribes while deterministic code judges; three matchers routed by config;
confidence-gated matching (a low-confidence read routes to review, never a
false fail — the warning being the deliberate exception); combined PDF treated
as two regions (no file-pairing problem); streaming over batch-blocking; a
relational schema portable across any Postgres.

## Tech stack

Next.js (TypeScript), React + Tailwind, an Anthropic vision model, pdf-lib,
PostgreSQL via `pg`, Docker, fastest-levenshtein, Vitest, lucide-react.

## Setup

### Prerequisites
- Docker (for the one-command local path), or Node.js 20+ and a PostgreSQL database
- An Anthropic API key

### Local deployment — Option A: Docker Compose (recommended)
```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or a .env file beside docker-compose.yml
docker compose up --build
```
- App: http://localhost:3000  ·  Postgres: localhost:5432 (auto-created, volume-persisted)
- Schema is created on the first request. Stop with Ctrl+C; tear down with
  `docker compose down -v` (also drops data).

### Local deployment — Option B: Node directly
```bash
# 1. a throwaway local Postgres (skip if you have one)
docker run -d --name labels-db -p 5432:5432 \
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=labels postgres:16-alpine

# 2. environment
cat > .env.local <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://app:app@localhost:5432/labels
EOF

# 3. install and run
npm install
npm run dev          # http://localhost:3000
npm test             # optional: matching-core suite
```

### Environment variables
```
ANTHROPIC_API_KEY=sk-ant-...                            # required; never commit
DATABASE_URL=postgres://app:app@localhost:5432/labels   # required
PGSSLMODE=require        # TLS, validating the server cert (PGSSLROOTCERT=CA bundle; PGSSLMODE=no-verify to skip validation in dev)
MODEL=claude-...         # optional; general/default model (default in lib/config.ts)
LABEL_MODEL=claude-...   # optional; label read (default: faster tier, claude-haiku-4-5)
FORM_MODEL=claude-...    # optional; form read (default: MODEL / claude-sonnet-4-6)
BATCH_CONCURRENCY=6      # optional concurrency override
CSV_IMAGE_MAX_BYTES=12582912      # optional; per-image size cap for uploaded CSV images
CSV_MAX_IMAGES_PER_ROW=6          # optional; max images per CSV row
```
`.env.local` is gitignored and read only in local development.

### Before first run
- Set the model via `MODEL` or the default in `lib/config.ts`.
- Verify the installed `@anthropic-ai/sdk` and `pg` versions match the call
  shapes in `lib/extraction.ts` and `lib/db.ts`.

### Deploy to any server
```bash
docker build -t label-verification .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  label-verification
```
Schema is created on the first request. If a reverse proxy sits in front,
disable response buffering so the verify route streams incrementally (the route
sets `X-Accel-Buffering: no` for nginx).

## Assumptions
- Each uploaded PDF is one complete application: a filled COLA Part I plus the
  affixed label artwork.
- For CSV intake, each row's columns are authoritative Part I data (not re-read
  from any document), and the listed image URLs are server-reachable label art.
- The canonical warning text (27 CFR 16.21) must be verified against the current
  regulation before real use — the strict check is only as correct as that constant.
- Product type (item 5) selects the validation ruleset; when unreadable it
  defaults conservatively, but production should gate it to human confirmation.
- The reviewing agent makes the final call; every review/flag is an invitation
  for human judgment, not an automated rejection.

## Limitations and trade-offs
- Bold detection is approximate; a bold-only doubt is downgraded to review.
- Correlated misreads on matched fields (brand/producer/appellation) can yield
  a false pass if the model misreads both sides the same confident way; the
  cause is input similarity, not the single model. Mitigated (not eliminated)
  by the confidence gate, and impossible for the warning (matched to a fixed
  constant). Hardening: dual-resolution agreement, derivable cross-checks
  (proof = ABV × 2), or always surfacing values on a pass.
- Net-contents parsing handles mL/cL/L/fl oz; compound US statements
  ("1 PINT 9 FL OZ") flag for review.
- The model API is a cloud call; in a restricted network it may need
  allow-listing or an in-network model. Likely prod path: Claude on AWS Bedrock
  (in-VPC, IAM auth) — a localized change since all model calls funnel through
  callModelWithRetry in extraction.ts, and Bedrock Claude takes the same messages
  shape/prompts so accuracy is unchanged. (Kept as Anthropic-only here on purpose
  — a provider abstraction is YAGNI for the prototype; see README limitations.)
- CSV label images are uploaded, never fetched — the server makes no outbound
  request (no URL intake, no SSRF surface), a deliberate choice for a locked-down
  network.
- Dropped ZIPs ARE expanded in the browser: the upload tab expands a ZIP of
  PDFs/images (zipDocs.ts, with a real decompressed budget); the CSV tab reads a
  ZIP of label images in memory (zipImages.ts, compressed-size cap only).
- Long batches need a streaming-friendly reverse proxy (buffering off).
- No COLA integration, by design.

### Data and retention
Only extracted text and verdicts are stored; uploaded PDFs and label images
(including images uploaded for a CSV run) are processed in memory and discarded;
CSV image file names are not persisted. A production system would need an explicit
retention policy and federal compliance review.
