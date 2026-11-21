// Pull the HTML document out of a model reply and check it against the sim contract.

export const MAX_HTML_BYTES = 150 * 1024;

export function extractHtml(raw: string): string {
  let s = raw.replace(/```[a-zA-Z]*\s*\n?/g, "");
  const doctype = s.search(/<!DOCTYPE/i);
  const start = doctype >= 0 ? doctype : s.search(/<html/i);
  if (start > 0) s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf("</html>");
  if (end >= 0) s = s.slice(0, end + "</html>".length);
  return s.trim();
}

export type Validation = { ok: true } | { ok: false; reason: string };

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<script\b[^>]*\bsrc\s*=/i, "it loads an external script (<script src>)"],
  [/<link\b/i, "it uses a <link> tag"],
  [/@import/i, "it uses CSS @import"],
  [/<iframe\b/i, "it embeds an <iframe>"],
  [/\b(?:src|href)\s*=\s*["']?\s*https?:\/\//i, "it points src/href at the network"],
  [/url\(\s*["']?\s*https?:\/\//i, "it loads a url() from the network"],
];

export function validateHtml(html: string): Validation {
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES)
    return { ok: false, reason: "The simulation is larger than 150 KB." };
  if (!/window\.SIM\b/.test(html)) return { ok: false, reason: "The simulation never defines window.SIM." };
  if (!/<canvas\b/i.test(html)) return { ok: false, reason: "The simulation has no <canvas>." };
  for (const [re, why] of FORBIDDEN) if (re.test(html)) return { ok: false, reason: `The simulation is not self-contained: ${why}.` };
  return { ok: true };
}
