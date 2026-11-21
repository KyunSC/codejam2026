import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { datasetDir, type EmailRow, loadDataset } from "../../dataset";
import { partitionInbox, sealedFileNames } from "../../pipeline/sealed";
import { inboxSeedRows } from "../inbox";

const ds = loadDataset();
const sealed = sealedFileNames();

describe("sealed drill", () => {
  it("lists 15 sealed files", () => {
    expect(sealed.size).toBe(15);
  });

  it("refuses an email that mixes sealed and unsealed attachments", () => {
    const e = { emailId: "EM-X", attachments: ["a.pdf", [...sealed][0]] } as Pick<EmailRow, "emailId" | "attachments">;
    expect(() => partitionInbox([e], new Set(sealed))).toThrow(/both sealed and unsealed/);
  });
});

describe("inbox seed", () => {
  const read: string[] = [];
  const rows = inboxSeedRows(ds, sealed, (name) => {
    read.push(name);
    return readFileSync(path.join(datasetDir(), "incoming_invoices", name));
  });

  it("keeps 44 emails and 41 documents, skipping the 15 sealed emails", () => {
    expect(rows.emails).toHaveLength(44);
    expect(rows.documents).toHaveLength(41);
    expect(rows.sealedEmailCount).toBe(15);
  });

  it("never reads a sealed file", () => {
    expect(read).toHaveLength(41);
    expect(read.filter((n) => sealed.has(n))).toEqual([]);
  });

  it("keeps the two-attachment email and the four without attachments", () => {
    const byId = Object.fromEntries(rows.emails.map((e) => [e.id, e]));
    expect(byId["EM-029"].attachments).toHaveLength(2);
    for (const id of ["EM-056", "EM-057", "EM-058", "EM-059"]) expect(byId[id].attachments).toEqual([]);
    expect(rows.emails.every((e) => e.label === undefined)).toBe(true);
  });

  it("stores each file by SHA-256 with its dataset location and type", () => {
    const scan = rows.documents.find((d) => d.fileName === "scan_8049.png")!;
    expect(scan).toMatchObject({ mime: "image/png", url: "dataset:incoming_invoices/scan_8049.png" });
    expect(scan.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(rows.documents.map((d) => d.sha256)).size).toBe(41);
  });
});
