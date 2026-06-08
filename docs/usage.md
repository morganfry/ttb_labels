# Using the app (for reviewing agents)

The app has two screens, linked by the top navigation: **Verify** (review new applications) and **Review History** (search past results).

## Verifying applications

1. **Upload.** On the Verify screen, drag application PDFs onto the upload area, or click it to browse. You can add one file or many at once. Each PDF should be a complete application — the COLA form with the label affixed. Each file appears in the queue marked *Ready*; remove any with the **×** on its row, or **Clear all** to start over.

2. **Process.** Once at least one file is queued, the large **Process** button shows how many it will run. Click it. A progress bar shows results arriving ("Processing… 3 of 12 done") — you don't have to wait for the whole batch before reading the early ones.

3. **Read the results table.** Each application becomes a row. Every field has a colored verdict:
    - **Green — Pass**: the label matches the application (or meets the requirement).
    - **Amber — Review / Unreadable**: close but not exact, or couldn't be read confidently. Worth a human look.
    - **Red — Fail**: a genuine mismatch or a missing required field.
    - **Gray — N/A**: not applicable to this product type (e.g. wine appellation on a spirit).
      The **Overall** column summarizes the row, and the strip above the table tallies how many passed, need review, or failed.

4. **See why.** Click any row to expand a per-field breakdown showing the value the app read from the label and, for anything flagged, the specific reason (e.g. *"GOVERNMENT WARNING:" must be in all capital letters*). The verdict is guidance — you make the final call.

## Bulk verification by CSV

Switch to the **CSV bulk** tab on the Verify screen when you already have the application data in a spreadsheet and the label artwork as image files.

1. **Prepare the CSV.** One application per row. The COLA Part I fields are columns; the final `labelImages` column is a JSON array of image **file names** you upload alongside the CSV (a folder path like `labels/24-1.jpg` works; a bare file name resolves if it is unique across everything you uploaded). The tab shows the full column list with notes, a worked example, and a **Download template** button. Required columns: `serialNumber`, `productType` (`wine` / `distilledSpirits` / `maltBeverages`), `source` (`domestic` / `imported`), `brandName`, `applicantNameAddress`, and `labelImages`. Multiple names in one row are treated as several views (front / back / neck) of a single label.

2. **Upload it.** Drag the CSV in or browse to it. The app parses it immediately and shows how many rows are valid and lists any rows with errors (a bad product type, a malformed reference array, a missing required value). Bad rows don't block the others — they're reported, not verified.

3. **Upload the images.** A row references its label artwork by file name, so an uploader appears — drop the images individually and/or as a ZIP. The app reads them in the browser and flags any referenced name that isn't among the uploads, before you run. (Images are always uploaded, never fetched from a URL.)

4. **Verify.** Click **Verify N rows**. As with PDFs, results stream into the same table row by row, with the same per-field verdicts and expandable detail. Rows whose images weren't found among the uploads, or couldn't be read, are listed separately with the reason.

## Searching past reviews

On the **Review History** screen, the most recent reviews load automatically. Narrow them with any combination of filters — serial number, brand (partial text is fine), outcome, product type, and a date range — then click **Search**. Results paginate; click any row to expand the same per-field detail you saw at verification time. **Clear filters** returns to the full recent list.

## Good to know

- **Amber means "look," not "rejected."** The app flags uncertainty rather than deciding for you. Anything amber or red is surfaced so a person can judge it.
- **The government warning is checked strictly** — exact wording and an all-caps header. Small deviations that would be fine elsewhere will fail here, by design.
- **Brand and producer names are matched leniently** — differences in capitalization, punctuation, or spacing won't be treated as a mismatch.
