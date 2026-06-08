# Integration PDF fixtures

The deterministic E2E tests (lib/e2e.test.ts) stub the parsers with fixtures
and need no real PDFs. For an occasional INTEGRATION smoke test against the
real model, generate combined application PDFs (filled COLA form + affixed
label) and run them through POST /api/verify manually.

## Generating fixtures

A combined PDF = page 1 of TTB F 5100.31 with Part I filled in and a label
image affixed at the bottom. Options:

1. **AI image tools** (suggested in the project brief): generate label artwork
   (e.g. "vintage bourbon label, brand OLD TOM DISTILLERY, 45% Alc./Vol.,
   750 mL, with the standard US government health warning in bold all-caps"),
   then composite it onto a filled 5100.31 page 1 in any PDF editor.

2. **Scripted**: fill the official fillable PDF (ttb.gov/forms/f510031.pdf)
   programmatically and stamp a label PNG onto it with pdf-lib.

   ## Suggested fixtures (mirror the deterministic scenarios)

- clean-pass.pdf       — everything matches and is compliant
- warning-titlecase.pdf — "Government Warning:" instead of all-caps (should fail)
- warning-missing.pdf  — no warning block (should fail)
- brand-variant.pdf    — label "STONE'S THROW", form "Stone's Throw" (should pass)
- imported-no-origin.pdf — item 3 = imported, no country on label (should fail)
- bad-photo.pdf        — skewed/low-contrast label (should yield unreadable/review)

## Running a smoke test

curl -F 'pairs=[{"id":"1","name":"clean-pass.pdf"}]' \
-F 'label_1=@test-form-pdfs/clean-pass.pdf' \
-F 'form_1=@test-form-pdfs/clean-pass.pdf' \
http://localhost:3000/api/verify

           Expect an NDJSON stream; the `result` line's `overall` should match the
scenario. Because the model is non-deterministic, treat mismatches as a prompt
to inspect rather than a hard failure.
