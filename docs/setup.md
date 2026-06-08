# Setup

## Prerequisites
- Docker (for the one-command local path), **or** Node.js 20+ and a PostgreSQL database
- An Anthropic API key

## Local — Option A: Docker Compose (recommended)
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

## Local — Option B: Node directly
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

## Environment variables
```
ANTHROPIC_API_KEY=sk-ant-...                            # required; never commit
DATABASE_URL=postgres://app:app@localhost:5432/labels   # required
PGSSLMODE=require        # only if your Postgres requires TLS — VALIDATES the server cert (set PGSSLROOTCERT for a provider CA bundle)
# PGSSLMODE=no-verify    # encrypt WITHOUT validating the cert — dev / self-signed only (MITM-able)
# PGSSLROOTCERT=/path/ca.pem  # CA bundle to trust when validating
MODEL=claude-...         # optional; general/default model (default in lib/config.ts)
LABEL_MODEL=claude-...   # optional; model for the label read (default: a faster tier, claude-haiku-4-5)
FORM_MODEL=claude-...    # optional; model for the form read (default: MODEL / claude-sonnet-4-6)
BATCH_CONCURRENCY=6      # optional concurrency override
LATENCY_TARGET_MS=5000   # optional; per-label latency target the UI flags against (default 5s)
UPLOAD_MAX_BYTES=268435456       # optional; max request body before buffering — DoS guard (default 256 MiB)
VERIFY_MAX_FILE_BYTES=52428800   # optional; per-file size cap on the upload tab (default 50 MiB)
VERIFY_MAX_ITEMS=500             # optional; max applications in one /api/verify request
CSV_MAX_BYTES=16777216           # optional; max CSV file size (default 16 MiB)
CSV_MAX_ROWS=5000                # optional; max CSV data rows per file
CSV_IMAGE_MAX_BYTES=12582912     # optional; per-image size cap for uploaded CSV label images (default 12 MiB)
CSV_MAX_IMAGES_PER_ROW=6         # optional; max label images per CSV row
CSV_IMAGE_ZIP_MAX_BYTES=104857600       # optional; max uploaded image-ZIP size, compressed (default 100 MiB)
CSV_IMAGE_ZIP_MAX_TOTAL_BYTES=209715200 # optional; max total DEcompressed image-ZIP bytes — zip-bomb guard (default 200 MiB)
PDF_ZIP_MAX_BYTES=209715200       # optional; max dropped PDF-ZIP size, compressed (default 200 MiB)
PDF_ZIP_MAX_ENTRY_BYTES=52428800  # optional; max decompressed size of one PDF in the ZIP (default 50 MiB)
PDF_ZIP_MAX_TOTAL_BYTES=524288000 # optional; max total decompressed PDFs from one ZIP (default 500 MiB)
```
`.env.local` is gitignored and read only in local development.

## Before first run
- The model ids in `lib/config.ts` (or `MODEL` / `LABEL_MODEL` / `FORM_MODEL`) must be valid, current Anthropic model ids — confirm them before a real run.

## Deploy to any server
Build the container and run it anywhere — a cloud VM, a container platform, or on-prem:
```bash
docker build -t label-verification .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  label-verification
```
The schema is created on the first request (idempotent migration). If a reverse proxy sits in front, disable response buffering so the verify route can stream results incrementally (the route sets `X-Accel-Buffering: no` for nginx).

The live demo deploys to **Render**: a persistent Docker web service plus a managed Postgres, provisioned by [`render.yaml`](../render.yaml) (a Render Blueprint), and shipped **test-gated** by [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — typecheck · test · build run on every push, and only a green `main` POSTs Render's deploy hook (Render's own auto-deploy is off, so a red build blocks the deploy). A persistent server is used over serverless because the app uploads whole PDFs (past serverless body caps) and streams NDJSON results. Both files are commented with the full setup.
