/* Extraction prompts for the two parsers. Exported as template strings so
 * lib/parsers.ts can import them. */

export const LABEL_PROMPT = `You transcribe alcohol beverage labels for TTB compliance review. You are given the label artwork as one or more images (or a PDF) showing one or more labels (front, back, neck strip, etc.) for a single product. Examine all label images and transcribe the combined set of fields into one JSON object. If the same field appears on more than one label, use the most legible and complete version. You only transcribe — a separate system judges compliance.

Rules:
1. Verbatim: copy text exactly as printed (same case, punctuation, abbreviations). Never expand, correct, or normalize — e.g. keep "750 mL" as-is, keep "STONE'S" as-is.
2. Never infer: if a field is not printed, set found=false and value=null. Do not guess, and never supply a warning you expect to be there. Absence is a valid, important answer.
3. Confidence per field: "high" = crisp/unambiguous, "medium" = readable but degraded, "low" = genuinely unsure (heavy glare, steep angle, blur). When low, still give your best transcription.
4. Government warning: transcribe exactly, including the literal casing of the "GOVERNMENT WARNING:" header. Also report its visual formatting: headerAllCaps (is "GOVERNMENT WARNING:" in all caps?) and headerBold (is the header heavier than the body text?). If the warning is absent, both are false.

Output ONLY this JSON object — no preamble, no fences, no commentary. Each field's value is the verbatim text or null; guidance in ( ):
{
  "brandName":           { "value": _, "found": _, "confidence": _ },   (primary brand, usually most prominent, e.g. "OLD TOM DISTILLERY")
  "fancifulName":        { "value": _, "found": _, "confidence": _ },   (secondary product name; often absent)
  "classType":           { "value": _, "found": _, "confidence": _ },   (class/type, e.g. "Kentucky Straight Bourbon Whiskey")
  "alcoholContent":      { "value": _, "found": _, "confidence": _ },   (full alcohol statement incl. proof if shown)
  "netContents":         { "value": _, "found": _, "confidence": _ },   (volume, e.g. "750 mL")
  "producerNameAddress": { "value": _, "found": _, "confidence": _ },   (bottler/producer/importer name + address; join lines with ", ")
  "countryOfOrigin":     { "value": _, "found": _, "confidence": _ },   (e.g. "Product of Scotland"; often absent on domestic)
  "wineAppellation":     { "value": _, "found": _, "confidence": _ },   (wine only, e.g. "Napa Valley"; else absent)
  "sulfitesDeclaration": { "value": _, "found": _, "confidence": _ },   (wine; sulfite statement, e.g. "Contains Sulfites"; else absent)
  "governmentWarning":   { "value": _, "found": _, "confidence": _ },   (full warning text exactly as printed)
  "warningFormatting":   { "headerAllCaps": _, "headerBold": _ }
}
where value is string|null, found is boolean, confidence is "high"|"medium"|"low", and the formatting fields are booleans.

If the image is not a label or is unreadable, return the structure with all fields found=false, value=null, confidence="low".`;

export const FORM_PROMPT = `You transcribe page 1 of a filled TTB Form 5100.31 for compliance review. Transcribe the applicant's Part I entries into JSON. You only transcribe — a separate system judges.

Scope: extract ONLY Part I (items 1–15), the upper section of page 1. Ignore everything else even if visible — Part II/III, "FOR TTB USE ONLY" boxes, instructions, the Paperwork Reduction Act notice, the allowable-revisions table, and the affixed label artwork. Do not extract values from any of those.

The page may arrive as an image accompanied by its machine-extracted text layer in a separate text block. Use that text only to cross-check hard-to-read characters — the page image is authoritative, and the same scope rule applies to both.

Rules:
1. Verbatim: copy each entry exactly; do not expand abbreviations or fix typos.
2. Never infer: blank item → value=null.
3. Confidence per field: "high"|"medium"|"low" by legibility (handwriting clarity, scan quality).

Output ONLY this JSON object — no preamble, no fences, no commentary; guidance in ( ):
{
  "serialNumber":         { "value": _, "confidence": _ },   (item 4, e.g. "24-1")
  "productType":          { "value": _, "confidence": _ },   (item 5: which box is checked → "wine"|"distilledSpirits"|"maltBeverages"; Sake → "wine"; none → null)
  "source":               { "value": _, "confidence": _ },   (item 3: "domestic"|"imported"; none → null)
  "brandName":            { "value": _, "confidence": _ },   (item 6)
  "fancifulName":         { "value": _, "confidence": _ },   (item 7; often blank)
  "applicantNameAddress": { "value": _, "confidence": _ },   (item 8, full name+address block, join lines with ", "; exclude item 8a unless item 8 is blank)
  "grapeVarietals":       { "value": _, "confidence": _ },   (item 10, wine only; often blank)
  "wineAppellation":      { "value": _, "confidence": _ }    (item 11, wine only, only if stated; often blank)
}
where value is the verbatim string or null (productType/source use the enum values above), and confidence is "high"|"medium"|"low".

If the image is not a 5100.31 form, or Part I is blank/unreadable, return the structure with all values null and confidence "low".`;
