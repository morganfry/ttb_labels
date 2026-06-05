# CLAUDE.md — working notes for Claude Code

AI-assisted TTB alcohol label verification (Next.js + TypeScript). This file
captures what isn't obvious from reading the code. For the full picture see
README.md; for file locations see the architecture section there.

## Commands
- Run locally: `docker compose up --build`  (app :3000, Postgres :5432)
- Run on host: `npm install && npm run dev`  (needs DATABASE_URL)
- Test: `npm test`  (Vitest; matching core in lib/matching.test.ts)
- Build: `npm run build`  (Next standalone output; Docker uses it)

## Architectural invariants — do not violate
- **The model transcribes; deterministic code judges.** Extraction prompts
  return verbatim field values only. ALL compliance decisions live in
  lib/matching.ts. Never move pass/fail logic into a prompt.
- **Three homes for constants, kept separate on purpose:**
    - Domain rules (matcher thresholds, tolerances, the warning text) → schema.ts
    - Operational knobs (model, maxTokens, concurrency, pageSize) → config.ts
    - Secrets (ANTHROPIC_API_KEY) → process.env only, never a committed file
      Don't consolidate these; the split is deliberate.
- **Tailwind color classes must be full literal strings** (see STATUS_META /
  OVERALL_META in uiTypes.ts). Never build class names by interpolation — the
  scanner purges dynamic ones and styles vanish in the production build.
- **Import persistence via @/lib/persistence (the barrel)**, not db.ts /
  persistWrite.ts / persistQuery.ts directly. Keeps the public surface stable.
- **Page 1 only reaches the form parser** (extractFirstPage). The form prompt's
  scope guard is the backup; the slice is the real guarantee. Don't remove either.

## Confidence gate (the subtle bit in matching.ts)
Both sides of a comparison are model-read, so a "mismatch" may be a misread.
If either side has low confidence, the field resolves to `unreadable` (review),
never a confident `fail`. The government warning is the DELIBERATE exception: a
wrong/missing warning fails regardless of confidence. Preserve this asymmetry.

## Known, deliberate gaps — do not "fix" silently
- productType default: when item 5 is unreadable, toApplicationData() defaults
  to "distilledSpirits". Flagged for human-gating in production. Don't change
  the behavior without discussing.
- Bold detection downgrades to `review`, not `fail` (soft visual signal).
- Correlated misreads on matched fields can yield a false pass (see README
  limitations). Mitigated by the confidence gate, not eliminated.
- parseVolumeMl handles mL/cL/L/fl oz only; compound US ("1 PINT 9 FL OZ")
  flags for review by design.

## Verify before trusting (things that may be stale)
- DEFAULT_MODEL / config.model is a placeholder — confirm it's a current,
  valid model id.
- Confirm installed @anthropic-ai/sdk matches the messages.create shape in
  extraction.ts, and pg matches the Pool/query shape in db.ts.
- TTB_GOVERNMENT_WARNING (schema.ts) must match current 27 CFR 16.21 — the
  strict check is only as correct as this constant.

## Conventions when extending
- New verifiable field → add to LabelExtraction + FIELD_RULES (+ a rule type
  if needed); the dispatcher routes it. Avoid bespoke per-field code paths.
- New matcher → matching.ts; pure helpers → textNormalize.ts / unitParse.ts.
- Pure logic stays framework-free in lib/ and gets a Vitest test.
- Comment the WHY, not the what. TSDoc on exported/public surfaces.
- Shared UI (badges, field cards, display constants) is imported by both
  screens — change once, not per-screen.

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
searchable table.

This is a standalone proof-of-concept. It does not integrate with the live COLA system.

## Features

- Upload — drag-and-drop or browse, single or bulk; combined application PDFs
  (a filled COLA form with the label artwork affixed).
- Pre-flight detection — each PDF is checked for a filled Part I and an affixed
  label before processing; ambiguous documents are flagged for review with an
  explicit "Process anyway" override.
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

Request flow (one application): detect regions → slice form to page 1 →
extract label + form (two prompts, one shared model) → deterministic,
confidence-gated matching → persist (text + verdicts only) → stream result.

Layers:
- Frontend (Next.js App Router, React, Tailwind) — Verify (`/`) and Review
  History (`/search`), composed from small components; shared display
  constants and badges keep verdicts identical across screens.
- API routes (Node runtime) — `POST /api/verify` (streams NDJSON),
  `GET /api/search`, `GET /api/results/[id]`.
- Core library (`lib/`) — framework-independent and unit-testable: schema +
  rule config, prompts, page slicer, region detection, shared extraction,
  parsers, matchers + dispatcher, batch orchestration, persistence (pg).

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
PGSSLMODE=require        # only if your Postgres requires TLS
MODEL=claude-...         # optional model override (default in lib/config.ts)
BATCH_CONCURRENCY=6      # optional concurrency override
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
- Detection is heuristic (template markers + embedded images), not full
  extraction; a flattened-image form is treated as low-confidence.
- The model API is a cloud call; in a restricted network it may need
  allow-listing or an in-network model.
- ZIP archives are not expanded in the browser build.
- Long batches need a streaming-friendly reverse proxy (buffering off).
- No COLA integration, by design.

### Data and retention
Only extracted text and verdicts are stored; uploaded PDFs/images are processed
in memory and discarded. A production system would need an explicit retention
policy and federal compliance review.
