# TTB Label Verification — Prototype

> **▶ Live app: <https://ttb-label-verification-10j1.onrender.com/>** — deployed and ready to test. Access is password-protected (HTTP Basic Auth); credentials are shared with the submission rather than committed here.

An AI-assisted tool for reviewing alcohol beverage label applications (TTB COLA, Form 5100.31). An agent uploads combined application documents; the app extracts the label fields and the form's Part I data, checks them against TTB requirements, and returns a per-field pass / review / fail verdict in a searchable table. Applications can be submitted three ways: as a combined PDF, as a flat image (JPG/PNG) of one, or — for bulk runs — as a CSV of application data whose label images are referenced by file name and uploaded alongside (loose files and/or a ZIP).

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

- **Two ingestion modes** — the Verify screen has a **PDF / image upload** tab and a **CSV bulk** tab. The upload tab reads both the form and the label out of each document; CSV mode takes the application (Part I) data from columns and the label artwork from uploaded image files (loose or in a ZIP), referenced by name. Both feed the identical matching, persistence, and results pipeline.
- **Upload** — drag-and-drop or browse, single file or bulk. Accepts combined application PDFs (a filled COLA form with the label artwork affixed) **or a flat image (JPG/PNG/WebP/GIF)** of one — a PDF is sliced (page 1 = form, artwork pages = label) and each slice is rasterized server-side to resolution-capped JPEGs (the form page accompanied by its extracted text layer), while an image (which can't be sliced) is downscaled to the same cap and read whole by both parsers. High-resolution sources therefore cost the same per model call as normal ones. Also accepts a ZIP of such files — expanded in the browser, each file joins the same queue and pipeline (with a real per-entry/total decompressed budget).
- **CSV bulk** — one application per row, with the COLA Part I fields as columns and a final `labelImages` column holding a JSON array of image **file names**. The images themselves are uploaded alongside the CSV (loose files and/or a ZIP) and resolved by name — the server never fetches anything over the network. The app transcribes those images, then verifies them against the row. The CSV tab shows the expected format, a worked example, a live cross-check of referenced names against the uploaded images, and a downloadable template.
- **Field extraction** — a vision language model transcribes the label fields and the form's Part I fields, each with a per-field confidence rating.
- **Verification** — deterministic matching checks each field with the logic appropriate to it: tolerant matching for names, numeric tolerance for alcohol content and net contents, strict exact matching for the government warning.
- **Streaming results** — applications process concurrently and results stream back per-item, filling a color-coded table (green / amber / red per field) as each finishes. A summary strip tallies passed / needs-review / failed.
- **Latency measurement** — each result carries its end-to-end processing time and a per-stage breakdown (slice / resolve images / label read / form read / match). The table shows per-item time (flagged when it exceeds the target), the row detail shows the breakdown, and a run rollup reports median / p95 and how many items cleared the ≈5-second target (`LATENCY_TARGET_MS`, default 5000) — making the compliance team's hard latency bar visible and verifiable.
- **Result detail** — clicking any result expands a per-field breakdown showing the extracted value and the specific reason for any flag.
- **Searchable history** — every verdict is persisted. A search screen filters past reviews by serial number, brand (partial), outcome, product type, and date range, with pagination and on-demand detail.
- **Two-screen navigation** — a top nav links the Verify and Review History screens.

---

## Architecture

One application flows: **slice** (PDF → form page 1 + label artwork pages) → **rasterize/downscale** (every input becomes JPEGs capped at the model's native resolution; the form page carries its extracted text layer) → **extract** (label and form transcribed concurrently by a vision model) → **match** (deterministic, confidence-gated) → **persist** (text + verdicts only) → **stream** the result back per-item. A flat image skips slicing and is downscaled directly; the CSV path swaps the form read for explicit columns. Both intakes converge on the same matchers, persistence, and streaming.

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
- **mupdf (WASM)** — rasterizes sliced PDF pages to resolution-capped JPEGs and extracts the form page's text layer.
- **sharp** — downscales flat/CSV label images to the same resolution cap.
- **PostgreSQL via `pg`** — persistence and search; runs against any Postgres (managed, on-prem, or local Docker).
- **Docker** — containerized deploy to any host.
- **fastest-levenshtein** — string distance for the tolerant matcher.
- **Vitest** — the matching-core test suite.
- **lucide-react** — icons.

---

## Testing

The deterministic core is unit-tested with Vitest (`npm test`): the matcher / judge (`lib/matching.test.ts` — the confidence gate, the three matchers, the per-product rulesets, the strict warning check, the spirits ABV floor) and the intake layer (CSV tokenizer + validation, image resolution, PDF rasterization + image downscaling, the ZIP decompressed budgets). An end-to-end test (`lib/e2e.test.ts`) runs a batch through the *real* pipeline with the model calls replaced by fixtures, so the **judgment** is verified without depending on a live model. What's intentionally *not* unit-tested is model accuracy itself (non-deterministic — validated by hand against real labels) and the persistence / HTTP boundary (exercised against the live deploy). The same suite is the CI gate (`.github/workflows/ci.yml`): typecheck · test · build must pass before a deploy ships.

### Sample data

Real fixtures for a hands-on run live in the repo, 39 sample applications mirrored across each intake path:

- **`test-form-pdfs/`** — 39 combined-application PDFs (filled COLA Part I form + affixed label artwork), one application each, for the **Upload** tab. The same 39 are also bundled as `ttb_forms_with_new_high_res_labels_39_pdfs.zip` to exercise the drop-a-ZIP flow. (See its `README.md` for generating more.)
- **`test-form-images/`** — the page-1 JPG render of each of those applications, for the image-intake path (an image is treated as an un-sliceable single-page application). Also bundled as `ttb_forms_first_pages_39_jpg.zip`.
- **`test-csvs/`** — the **CSV bulk** path: `alcohol_label_text_bulk_template_jpg_filenames.csv` (39 rows of Part I columns + a `labelImages` JSON array), the label images it references in `img/`, and `label_images_jpg_matching_spreadsheet.zip` (those same images as one ZIP). Upload the CSV plus the images (loose or zipped) together.

---

## Assumptions

- Each uploaded PDF is one complete application: a filled COLA Part I plus the affixed label artwork.
- For CSV intake, each row's columns are treated as authoritative application (Part I) data — they are not re-read from any document — and the listed image names resolve to that application's label artwork among the uploaded images (loose files and/or a ZIP).
- The canonical government-warning text used for the strict check is the standard 27 CFR 16.21 wording (verified verbatim against the current regulation on 2026-06-07). Re-verify if the regulation ever changes — the strict matcher is only as correct as that constant.
- Product type (form item 5) selects which validation ruleset applies. When it can't be read confidently, a conservative default ruleset is used to evaluate the fields, but the verdict is routed to **review** (never a confident pass) because the ruleset selection itself was uncertain — the agent confirms the product type. Source (item 3) is gated the same way for the country-of-origin requirement.
- The reviewing agent makes the final call. Every "review" outcome is an invitation for human judgment, not an automated rejection.

---

## Limitations and trade-offs

### Accuracy & matching

- **Bold detection is approximate.** The warning header's bold requirement is judged visually by the model, which is less reliable than reading text. A bold-only doubt is downgraded to review rather than a hard fail.

- **Correlated misreads can produce a false pass.** On fields matched between the label and the form (brand, producer, appellation), both sides are read by the model. If it misreads the *same* text the *same* wrong way on both — and does so confidently — the two corrupted values match each other and the field passes, hiding a real discrepancy. The cause is the similarity of the inputs, not the use of one model; two different models can share the same blind spots. This is mitigated, not eliminated, by the confidence gate (an ambiguous read usually returns low confidence and routes to review), and it cannot affect the government warning, which is matched against a fixed constant rather than a second model read. Hardening options for production: extract high-stakes fields at two resolutions/crops and require agreement, cross-check derivable relationships (e.g. proof = ABV × 2), or always surface the extracted values to the agent on a pass, not only on a flag.

- **Net-contents parsing is not exhaustive.** Common units (mL, cL, L, fl oz) are handled; compound US statements like "1 PINT 9 FL OZ" are not yet parsed and would flag for review.

- **All inputs are normalized server-side before the model call.** PDF slices are rasterized to JPEGs capped at the model's native resolution (`VISION_MAX_EDGE_PX`, default 1568 px) via mupdf (`lib/pdfRaster.ts`), with the form page additionally carrying its machine-extracted text layer — the same image-plus-text the API's own PDF pipeline would produce, at a fraction of the payload. Flat and CSV images are downscaled to the same cap with sharp (`lib/imageDownscale.ts`), which also flattens alpha onto white and turns the API's per-image size cap into a non-issue (oversized images are shrunk, not rejected). Every preprocessing step falls back to the original bytes on any failure — it must never break a read. The remaining gap is EXIF orientation: the downscale pass does not bake rotation in, so a sideways phone photo stays sideways — the obvious next hardening if real phone-camera uploads show misreads.

- **Tolerant fields apply field-aware normalization + a containment rule.** Before scoring, the producer name/address folds away a label-only "BOTTLED BY"-style prefix and maps full US state names to abbreviations ("…Charleston, South Carolina" ≡ "…, SC"), and the fanciful name drops a leading vintage year ("2023 Rosé" ≡ "Rosé"). In addition, when one name's words are fully contained in the other (≥2 shared words) it's treated as a confident match — so a label that drops a suffix ("VERONA HILLS" ≡ "Verona Hills Vineyards") or carries extra boilerplate ("ESTATE BOTTLED BY …") still matches. All of this affects only the *scored* text (displayed values stay verbatim). The trade-off is a small, rare false-pass surface — a company named after a state, two fanciful names differing only by a leading year, or a name that is a strict subset of an unrelated one — bounded by the confidence gate and human review; none of it can affect the government warning.

### Performance

- **Single-label latency is ~7 s today — above the 5-second aspiration, by design honestly stated.** The brief's hard bar is per-label ("about 5 seconds"). Measured end-to-end, one application takes ~7 s, dominated by the two vision reads. What the design already does about it: the label and form reads run **concurrently**, the label read defaults to a **faster tier** (Haiku), the PDF is **sliced** so only the relevant pages are sent, every input is **rasterized/downscaled server-side** to the model's resolution cap (so payload no longer scales with source size — a 5 MB high-res scan costs the same per call as a 1 MB one), and results **stream per item** so batch throughput never waits on a single slow label. With inputs normalized, the residual per-call time is genuinely model inference. Closing the remaining gap is a faster/cheaper tier or a lower-round-trip in-VPC endpoint (Bedrock), not a rewrite. The UI surfaces the actual per-item time plus run median / p95 against the target (`LATENCY_TARGET_MS`), so the bar is *measured, not assumed*.

### Security & resource limits

- **Uploads are bounded to prevent memory exhaustion.** Both verify routes reject an oversized request by `Content-Length` before buffering it (`UPLOAD_MAX_BYTES`), and enforce per-file (`VERIFY_MAX_FILE_BYTES`), per-request item-count (`VERIFY_MAX_ITEMS`), and CSV size/row caps (`CSV_MAX_BYTES` / `CSV_MAX_ROWS`). A consequence: a very large batch must be split into smaller uploads rather than sent as one request — the whole-batch-in-one-multipart shape (and the in-memory buffering it implies) is itself the scaling limit; chunked/per-file upload is the production direction.
- **CSV label images are uploaded, never fetched.** The bulk path resolves each `labelImages` name against the images the agent uploads (loose files and/or a ZIP); the server makes no outbound request, so there is no URL-fetch / SSRF surface — a deliberate choice for a locked-down network. (Net contents and ABV still come from the label image, not the CSV, so a row can't assert compliance values directly.)

- **ZIP archives are bounded by a decompressed budget.** Both ZIP paths — the CSV image ZIP (`lib/zipImages.ts`) and the upload-tab ZIP of PDFs/images (`lib/zipDocs.ts`) — reject entries by their declared uncompressed size, per-entry and cumulative, from the ZIP metadata *before* decompressing, so a crafted "zip bomb" can't balloon memory. Both decompress synchronously (the CSV preview and the upload tab run in the browser), so a very large *legitimate* archive briefly blocks the UI thread during extraction. Only `.zip` is supported (not 7z/rar/tar/gz).

### Deployment & networking

- **Model endpoint for a real (federal) deployment.** The prototype calls the public Anthropic API directly — the lowest-friction path for running and evaluating it, and the single most likely thing to change for production. In a restricted federal network that traffic is both likely blocked and not FedRAMP-authorized, so a real deployment would route inference to an in-boundary endpoint — Claude on AWS Bedrock when deployed in AWS/GovCloud (same prompts, same accuracy), or a self-hosted / FedRAMP-authorized model inside the accreditation boundary. The swap is contained: every model call funnels through one integration (`lib/extraction.ts`, model id a per-call parameter) and the matchers judge deterministically regardless. But it's a prerequisite for any real use, not optional hardening — and a non-Claude backend would also need prompt re-validation. (PDF pages are already rasterized to images locally; the PDF document block survives only as a rasterization-failure fallback, which a non-Claude backend would drop.)

- **Long batches need a streaming-friendly proxy.** Processing runs in one streaming request. A long-running Node server has no function timeout, so large batches complete fine — but any reverse proxy in front must have response buffering disabled (the route sets `X-Accel-Buffering: no` for nginx) or results won't stream incrementally.

### Scope

- **Image intake assumes the whole application is in one image, and skips slicing.** A flat JPG/PNG can't be split into form/label regions, so the single image is sent to both parsers as-is — it must therefore show the filled Part I *and* the affixed label. There is no page-1 slice for images; the prompt scope guards and the confidence-gated matcher remain the safeguards. Multi-page applications are better submitted as PDFs.

- **No COLA integration.** By design. Results inform a potential future workflow; they are not written back to any system of record.

### Data and retention

The prototype stores extracted text and verdicts only. Uploaded PDFs and label images — including the images uploaded for a CSV run (loose files or a ZIP) — are processed in memory and discarded, which sidesteps document-retention and PII questions for a proof-of-concept. CSV image references (file names) are not persisted. A production system would need an explicit retention policy and the corresponding federal compliance review.
