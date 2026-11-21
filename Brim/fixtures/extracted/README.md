# Hand-made extraction answers

Written by hand from the text layer (or, for the scan, the image) of a few unsealed files, so
normalisation, evidence and intake can be tested with no API key. Each file says
`"handMade": true`. The recorded stand-in (`src/lib/pipeline/extract/recorded.ts`) serves
them by SHA-256; the real extraction cache (`extraction-cache/`) refuses them.

Never add a sealed file (`brim_ap_dataset/sealed_invoices.txt`) here.

There is one answer for each of the 41 unsealed inbox files. The seven named by purpose
(`credit-note.json`, `scan-image.json`, ...) came first; the other 34 are named `inbox-<file>.json`.
Each value was copied from the text layer and checked against the rendered page: every value is
in the text, and each file's arithmetic closes as printed. `notes` is left empty unless a remark
matters for payment.
