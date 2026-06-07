# Deploying to Vercel (GitHub Actions)

`.github/workflows/deploy.yml` runs the test gate (typecheck · test · build) on
every push/PR and deploys to Vercel via the Vercel **CLI** on a green `main`. It
uses the CLI rather than Vercel's Git integration so a failing build blocks the
deploy — **don't also enable auto-deploy on the Vercel project**, or you'll get
double deploys.

## One-time setup

1. **Create + link the project.** Locally, `npm i -g vercel` then `vercel link`.
   This writes `.vercel/project.json` (gitignored) containing your `orgId` and
   `projectId`.
2. **Add GitHub Actions secrets** (repo → Settings → Secrets and variables →
   Actions):
   - `VERCEL_TOKEN` — create at <https://vercel.com/account/tokens>
   - `VERCEL_ORG_ID` — the `orgId` from step 1
   - `VERCEL_PROJECT_ID` — the `projectId` from step 1
3. **Add Vercel project env vars** (Vercel dashboard → Project → Settings →
   Environment Variables, **Production** scope):
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL` — a managed Postgres. **Use the pooled connection string**
     (Neon `-pooler` host / Supabase port `6543`); serverless functions
     otherwise exhaust connections. Vercel doesn't run containers, so the bundled
     `docker-compose` Postgres is local-only — provision Neon / Vercel Postgres /
     Supabase instead.
   - `PGSSLMODE=require` — managed Postgres needs TLS; this enables the `ssl`
     branch in `lib/db.ts`.

Once those are in place, every push to `main` runs the gate and (if green)
deploys; the deployment URL is printed in the job summary. `workflow_dispatch`
lets you trigger a deploy manually.

## How the workflow is structured

- **`test` job** — `npm ci` → `tsc --noEmit` → `npm test` (Vitest) → `npm run
  build`. Runs on every push and PR.
- **`deploy` job** — needs `test`, and only runs on `push`/`workflow_dispatch` to
  `main`. Steps: `vercel pull` (project settings + Production env) → `vercel
  build --prod` → `vercel deploy --prebuilt --prod`.
- CI checkout deliberately **skips Git LFS** — the build and tests don't read the
  fixture binaries, so this avoids spending LFS bandwidth on every run.

## Caveats specific to this app

- **Function duration.** This app streams long NDJSON batches, and Vercel caps
  function wall-clock (Hobby ~60s; Pro ~300s, up to ~800s with Fluid compute).
  The verify route already sets `maxDuration = 300`. That's fine for small demo
  batches, but a 200–300-file run can exceed the cap and truncate the stream
  mid-batch — for genuinely unbounded batches use a long-running host (Fly /
  Render / ECS) instead. See the deployment trade-offs discussion if unsure.
- **It's public and spends your API budget.** There is no built-in auth or rate
  limiting, and the CSV URL-fetch has only a best-effort SSRF guard. **Gate the
  deployment** (Vercel password protection on Pro, Cloudflare Access, or a
  basic-auth middleware) before sharing the URL.
- **Postgres connections.** Always use the provider's *pooled* endpoint (above);
  the app's `pg.Pool` per serverless instance will otherwise exhaust a small
  database's connection limit under any concurrency.
