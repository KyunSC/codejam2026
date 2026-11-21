/**
 * Currency from the total label or the printed currency (BUILD_PLAN "Normalisation", Currency).
 * `Total CAD`, `CA$`, `C$`, `$ CA` → CAD; `Total USD`, `US$`, `$US`, `$ US` → USD. A bare `$`
 * says nothing: the result is null and Resolution falls back to the vendor's country.
 * Naming both currencies is also null rather than a guess.
 */
import type { Currency } from "../../types";

export function currencyFromLabel(...texts: Array<string | null | undefined>): Currency | null {
  const s = texts.filter(Boolean).join(" ").toUpperCase();
  const usd = /\bUSD\b|\bUS\s?\$|\$\s?US\b|\bU\.S\.\s?DOLLARS?\b|\bDOLLARS? AMERICAINS?\b|\bDOLLARS? US\b/.test(s);
  const cad = /\bCAD\b|\bCAN?\s?\$|\bC\$|\$\s?CA(N|D)?\b|\bCANADIAN DOLLARS?\b|\bDOLLARS? CANADIENS?\b/.test(s);
  if (usd === cad) return null;
  return usd ? "USD" : "CAD";
}
