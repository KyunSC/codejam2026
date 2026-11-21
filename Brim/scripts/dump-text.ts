// Prints SHA-256 and text layer of named unsealed incoming files (refuses sealed ones).
import { readFileSync } from "node:fs";
import path from "node:path";
import { datasetDir } from "../src/lib/dataset";
import { inspectDocument } from "../src/lib/pipeline/inspect";
import { sealedFileNames } from "../src/lib/pipeline/sealed";

async function main() {
  const sealed = sealedFileNames();
  for (const name of process.argv.slice(2)) {
    if (sealed.has(name)) throw new Error(`sealed: ${name}`);
    const r = await inspectDocument(readFileSync(path.join(datasetDir(), "incoming_invoices", name)));
    console.log(`=== ${name} ${r.sha256} ${r.mime}\n${r.textLayer}\n`);
  }
}

void main();
