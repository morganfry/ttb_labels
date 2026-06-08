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
PGSSLMODE=require        # only if your Postgres requires TLS (managed providers)
MODEL=claude-...         # optional; general/default model (default in lib/config.ts)
LABEL_MODEL=claude-...   # optional; model for the label read (default: a faster tier, claude-haiku-4-5)
FORM_MODEL=claude-...    # optional; model for the form read (default: MODEL / claude-sonnet-4-6)
BATCH_CONCURRENCY=6      # optional concurrency override
LATENCY_TARGET_MS=5000   # optional; per-label latency target the UI flags against (default 5s)
CSV_IMAGE_MAX_BYTES=12582912     # optional; per-image size cap for CSV labels (URL or ZIP; default 12 MiB)
CSV_IMAGE_FETCH_TIMEOUT_MS=15000 # optional; per-image fetch timeout for the CSV URL path
CSV_MAX_IMAGES_PER_ROW=6         # optional; max label image references per CSV row
CSV_IMAGE_ZIP_MAX_BYTES=104857600 # optional; max uploaded image-ZIP size (default 100 MiB)
PDF_ZIP_MAX_BYTES=209715200       # optional; max dropped PDF-ZIP size, compressed (default 200 MiB)
PDF_ZIP_MAX_ENTRY_BYTES=52428800  # optional; max decompressed size of one PDF in the ZIP (default 50 MiB)
PDF_ZIP_MAX_TOTAL_BYTES=524288000 # optional; max total decompressed PDFs from one ZIP (default 500 MiB)
```
`.env.local` is gitignored and read only in local development.

## Before first run
- Set the model via `MODEL` or the default in `lib/config.ts`.
- Verify the installed `@anthropic-ai/sdk` and `pg` versions match the call shapes in `lib/extraction.ts` and `lib/db.ts`.

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
