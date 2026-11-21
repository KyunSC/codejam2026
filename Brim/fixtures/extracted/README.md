# Hand-made extraction answers

Written by hand from the text layer (or, for the scan, the image) of a few unsealed files, so
normalisation, evidence and intake can be tested with no API key. Each file says
`"handMade": true`. The recorded stand-in (`src/lib/pipeline/extract/recorded.ts`) serves
them by SHA-256; the real extraction cache (`extraction-cache/`) refuses them.

Never add a sealed file (`brim_ap_dataset/sealed_invoices.txt`) here.
