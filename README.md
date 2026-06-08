# TTB Label Verification — Prototype

An AI-assisted tool for reviewing alcohol beverage label applications (TTB COLA, Form 5100.31). An agent uploads combined application documents; the app extracts the label fields and the form's Part I data, checks them against TTB requirements, and returns a per-field pass / review / fail verdict in a searchable table. Applications can be submitted three ways: as a combined PDF, as a flat image (JPG/PNG) of one, or — for bulk runs — as a CSV of application data whose label images are given by URL or by file name, with the images uploaded alongside (loose files and/or a ZIP).

This is a standalone proof-of-concept. It does not integrate with the live COLA system.

**Documentation**
- [`docs/usage.md`](docs/usage.md) — using the app (for reviewing agents): verify, bulk CSV, search.
- [`docs/setup.md`](docs/setup.md) — install and run (Docker or Node), environment variables, deployment.
- [`docs/architecture.md`](docs/architecture.md) — system-context / component / sequence diagrams and the `lib/` module map.

---

## Setup

One command (runs the app + Postgres together):
```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build      # → http://localhost:3000  (schema created on first request)
```

Running on the host instead, the full environment-variable list, and container deployment → **[`docs/setup.md`](docs/setup.md)**.

---

## Features

- **Two ingestion modes** — the Verify screen has a **PDF / image upload** tab and a **CSV bulk** tab. The upload tab reads both the form and the label out of each document; CSV mode takes the application (Part I) data from columns and the label artwork from image references (URLs and/or uploaded image files — loose or in a ZIP). Both feed the identical matching, persistence, and results pipeline.
- **Upload** — drag-and-drop or browse, single file or bulk. Accepts combined application PDFs (a filled COLA form with the label artwork affixed) **or a flat image (JPG/PNG/WebP/GIF)** of one — a PDF is sliced (page 1 = form, artwork pages = label), while an image (which can't be sliced) is read whole by both parsers. Also accepts a ZIP of such files — expanded in the browser, each file joins the same queue and pipeline (with a real per-entry/total decompressed budget).
- **CSV bulk** — one application per row, with the COLA Part I fields as columns and a final `labelImageUrls` column holding a JSON array of image references. Each reference is either an http(s) URL or the name of a file inside an optional ZIP of label images uploaded alongside the CSV — so artwork on disk can be verified without hosting it. The app reads and transcribes those images, then verifies them against the row. The CSV tab shows the expected format, a worked example, a live cross-check of local files against the ZIP, and a downloadable template.
- **Field extraction** — a vision language model transcribes the label fields and the form's Part I fields, each with a per-field confidence rating.
- **Verification** — deterministic matching checks each field with the logic appropriate to it: tolerant matching for names, numeric tolerance for alcohol content and net contents, strict exact matching for the government warning.
- **Streaming results** — applications process concurrently and results stream back per-item, filling a color-coded table (green / amber / red per field) as each finishes. A summary strip tallies passed / needs-review / failed.
- **Latency measurement** — each result carries its end-to-end processing time and a per-stage breakdown (slice / image fetch / label read / form read / match). The table shows per-item time (flagged when it exceeds the target), the row detail shows the breakdown, and a run rollup reports median / p95 and how many items cleared the ≈5-second target (`LATENCY_TARGET_MS`, default 5000) — making the compliance team's hard latency bar visible and verifiable.
- **Result detail** — clicking any result expands a per-field breakdown showing the extracted value and the specific reason for any flag.
- **Searchable history** — every verdict is persisted. A search screen filters past reviews by serial number, brand (partial), outcome, product type, and date range, with pagination and on-demand detail.
- **Two-screen navigation** — a top nav links the Verify and Review History screens.

---

## Architecture

One application flows: **slice** (PDF → form page 1 + label artwork pages) → **extract** (label and form transcribed concurrently by a vision model) → **match** (deterministic, confidence-gated) → **persist** (text + verdicts only) → **stream** the result back per-item. A flat image skips slicing; the CSV path swaps the form read for explicit columns. Both intakes converge on the same matchers, persistence, and streaming.

**Diagrams, the request/verification sequence, and the `lib/` module map → [`docs/architecture.md`](docs/architecture.md).**

### Key design decisions

- **One vision model, not OCR-then-parse** — extracts and structures in one call, tolerates imperfect photos better than classical OCR, and stays within the per-label latency budget.
- **The model transcribes; code judges** — all compliance logic lives in deterministic, unit-tested matchers; the model is only ever asked *what the label says*, never whether it passes. This is what makes verdicts trustworthy.
- **Three matchers, routed by config** — *tolerant* (names: case/punctuation/accent-folded similarity, so "STONE'S THROW" ≡ "Stone's Throw"), *numeric* (ABV / net contents within tolerance, so "750 mL" ≡ "0.75 L"), and *strict* (government warning: exact 27 CFR 16.21 text + all-caps header).
- **Confidence-gated** — because both sides are model-read, a low-confidence read routes to *review* rather than a confident false fail. The government warning is the deliberate exception: a missing or altered warning fails regardless.
- **Two ingestion paths, one judge** — PDF and CSV differ only in how the application side is obtained; they converge on the same judge, so a CSV verdict means exactly what a PDF verdict means.
- **Streaming over batch-blocking** — the ~5-second expectation is per-label, not per-batch. A bounded worker pool streams each result as it lands, so one slow item never holds up the rest.
- **Same schema, swappable engine** — the relational schema is the durable artifact; it runs on managed Postgres here and ports to any Postgres for production.

---

## Tech stack

- **Next.js (TypeScript)** — full-stack framework; App Router; API routes keep the model key server-side.
- **React + Tailwind CSS** — UI.
- **Anthropic vision model** — extraction (one integration for both parsers).
- **pdf-lib** — page slicing (form Part I / label artwork pages).
- **PostgreSQL via `pg`** — persistence and search; runs against any Postgres (managed, on-prem, or local Docker).
- **Docker** — containerized deploy to any host.
- **fastest-levenshtein** — string distance for the tolerant matcher.
- **Vitest** — the matching-core test suite.
- **lucide-react** — icons.

---

## Assumptions

- Each uploaded PDF is one complete application: a filled COLA Part I plus the affixed label artwork.
- For CSV intake, each row's columns are treated as authoritative application (Part I) data — they are not re-read from any document — and the listed image references resolve to that application's label artwork: either http(s) URLs reachable from the server, or files present among the uploaded images (loose files and/or a ZIP).
- The canonical government-warning text used for the strict check is the standard 27 CFR 16.21 wording (verified verbatim against the current regulation on 2026-06-07). Re-verify if the regulation ever changes — the strict matcher is only as correct as that constant.
- Product type (form item 5) selects which validation ruleset applies. When it can't be read confidently, a conservative default is used, but in production this should gate to human confirmation, since it controls the whole comparison profile.
- The reviewing agent makes the final call. Every "review" outcome is an invitation for human judgment, not an automated rejection.

---

## Limitations and trade-offs

### Accuracy & matching

- **Bold detection is approximate.** The warning header's bold requirement is judged visually by the model, which is less reliable than reading text. A bold-only doubt is downgraded to review rather than a hard fail.

- **Correlated misreads can produce a false pass.** On fields matched between the label and the form (brand, producer, appellation), both sides are read by the model. If it misreads the *same* text the *same* wrong way on both — and does so confidently — the two corrupted values match each other and the field passes, hiding a real discrepancy. The cause is the similarity of the inputs, not the use of one model; two different models can share the same blind spots. This is mitigated, not eliminated, by the confidence gate (an ambiguous read usually returns low confidence and routes to review), and it cannot affect the government warning, which is matched against a fixed constant rather than a second model read. Hardening options for production: extract high-stakes fields at two resolutions/crops and require agreement, cross-check derivable relationships (e.g. proof = ABV × 2), or always surface the extracted values to the agent on a pass, not only on a flag.

- **Net-contents parsing is not exhaustive.** Common units (mL, cL, L, fl oz) are handled; compound US statements like "1 PINT 9 FL OZ" are not yet parsed and would flag for review.

- **Tolerant fields apply field-aware normalization + a containment rule.** Before scoring, the producer name/address folds away a label-only "BOTTLED BY"-style prefix and maps full US state names to abbreviations ("…Charleston, South Carolina" ≡ "…, SC"), and the fanciful name drops a leading vintage year ("2023 Rosé" ≡ "Rosé"). In addition, when one name's words are fully contained in the other (≥2 shared words) it's treated as a confident match — so a label that drops a suffix ("VERONA HILLS" ≡ "Verona Hills Vineyards") or carries extra boilerplate ("ESTATE BOTTLED BY …") still matches. All of this affects only the *scored* text (displayed values stay verbatim). The trade-off is a small, rare false-pass surface — a company named after a state, two fanciful names differing only by a leading year, or a name that is a strict subset of an unrelated one — bounded by the confidence gate and human review; none of it can affect the government warning.

### Security & resource limits

- **CSV image fetching is server-side and only lightly guarded.** When a row references images by URL, the server fetches arbitrary URLs. There is a best-effort SSRF guard (http(s) only; loopback, link-local, and RFC-1918 hosts rejected) and size/timeout caps, but it is not DNS-rebinding-proof. A production deployment should front it with an allow-list or an egress proxy. The ZIP option avoids outbound fetches entirely and is the safer choice in a locked-down network. Net-contents and ABV still come from the label image, not the CSV, so a CSV row can't assert compliance values directly.

- **The CSV image ZIP is fully decompressed in memory.** Both the server (resolve) and the client (pre-flight cross-check) expand the whole archive, bounded only by a blunt compressed-size cap (`CSV_IMAGE_ZIP_MAX_BYTES`) — not a decompressed-size budget, so it is not hardened against a crafted "zip bomb." Production should stream-extract with a hard per-entry and total decompressed limit.

- **Upload-tab ZIP expansion is in-browser and synchronous.** A dropped ZIP of PDFs and/or images is decompressed client-side (`lib/zipDocs.ts`) before the run; a very large archive briefly blocks the UI thread during extraction. Unlike the CSV image ZIP, it enforces a real decompressed budget (per-entry and total, checked from ZIP metadata before each entry is expanded), so it is hardened against a crafted "zip bomb." Only `.zip` is supported (not 7z/rar/tar/gz).

### Deployment & networking

- **Model endpoint for a real (federal) deployment.** The prototype calls the public Anthropic API directly — the lowest-friction path for running and evaluating it, and the single most likely thing to change for production. In a restricted federal network that traffic is both likely blocked and not FedRAMP-authorized, so a real deployment would route inference to an in-boundary endpoint — Claude on AWS Bedrock when deployed in AWS/GovCloud (same prompts, same accuracy), or a self-hosted / FedRAMP-authorized model inside the accreditation boundary. The swap is contained: every model call funnels through one integration (`lib/extraction.ts`, model id a per-call parameter) and the matchers judge deterministically regardless. But it's a prerequisite for any real use, not optional hardening — and a non-Claude backend would also need prompt re-validation and PDF pages rasterized to images, since only Claude reads PDFs natively.

- **Long batches need a streaming-friendly proxy.** Processing runs in one streaming request. A long-running Node server has no function timeout, so large batches complete fine — but any reverse proxy in front must have response buffering disabled (the route sets `X-Accel-Buffering: no` for nginx) or results won't stream incrementally.

### Scope

- **Image intake assumes the whole application is in one image, and skips slicing.** A flat JPG/PNG can't be split into form/label regions, so the single image is sent to both parsers as-is — it must therefore show the filled Part I *and* the affixed label. There is no page-1 slice for images; the prompt scope guards and the confidence-gated matcher remain the safeguards. Multi-page applications are better submitted as PDFs.

- **No COLA integration.** By design. Results inform a potential future workflow; they are not written back to any system of record.

### Data and retention

The prototype stores extracted text and verdicts only. Uploaded PDFs and label images — including images fetched from CSV URLs and images uploaded for a CSV run (loose files or a ZIP) — are processed in memory and discarded, which sidesteps document-retention and PII questions for a proof-of-concept. CSV image references (URLs and file names) are not persisted. A production system would need an explicit retention policy and the corresponding federal compliance review.
