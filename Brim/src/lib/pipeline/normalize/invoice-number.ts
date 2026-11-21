/**
 * Invoice number keys (BUILD_PLAN "Normalisation", Invoice number). The number is kept as
 * printed; the keys let duplicate detection ignore formatting:
 * - numberKey: upper case, letters and digits only, no leading zeros. `000604` → `604`,
 *   `FA-001655` → `FA001655`, `inv 01561` → `INV01561`. Used by DUP_EXACT.
 * - digitsKey: digits only, no leading zeros. `FA-001655` and `1655-A` → `1655`. Used by DUP_NEAR.
 * A number with nothing left after stripping gives null; one that is all zeros gives "0".
 */
export interface InvoiceNumberKeys {
  numberKey: string | null;
  digitsKey: string | null;
}

function stripLeadingZeros(s: string): string | null {
  if (s === "") return null;
  const t = s.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

export function invoiceNumberKeys(printed: string | null | undefined): InvoiceNumberKeys {
  if (printed == null) return { numberKey: null, digitsKey: null };
  // NFKD splits accented letters so "é" keeps its base letter instead of being dropped.
  const plain = printed.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return {
    numberKey: stripLeadingZeros(plain.replace(/[^A-Z0-9]/g, "")),
    digitsKey: stripLeadingZeros(plain.replace(/[^0-9]/g, "")),
  };
}
