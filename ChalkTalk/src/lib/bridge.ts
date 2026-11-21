// The bridge between the sandboxed sim iframe and the app. Pure and client-safe.
import type { BridgeMessage, SimParam } from "./types";

export const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

export const SIM_WAIT_MS = 3000;

// Kept on a single line so that injecting it doesn't shift the line numbers
// that error events report for the generated code.
export const BRIDGE_JS = [
  "(function(){",
  "var P=window.parent;",
  "function post(m){try{m.__simBridge=true;P.postMessage(m,'*');}catch(_){}}",
  "function msg(x){return x&&x.message?String(x.message):String(x);}",
  "window.addEventListener('error',function(e){post({type:'error',message:e.message||'Script error',line:e.lineno,col:e.colno});});",
  "window.addEventListener('unhandledrejection',function(e){post({type:'error',message:'Unhandled promise rejection: '+msg(e.reason)});});",
  "document.addEventListener('securitypolicyviolation',function(e){post({type:'error',message:'Blocked by the sandbox: '+e.violatedDirective+(e.blockedURI?' '+e.blockedURI:''),line:e.lineNumber,col:e.columnNumber});});",
  "document.addEventListener('DOMContentLoaded',function(){var t0=Date.now();(function poll(){var S=window.SIM;",
  "if(S&&Array.isArray(S.params)&&typeof S.reset==='function'){var params;try{params=JSON.parse(JSON.stringify(S.params));}catch(_){params=null;}",
  "post({type:'ready',title:S.title,params:params,question:S.question});return;}",
  `if(Date.now()-t0>=${SIM_WAIT_MS}){post({type:'error',message:'SIM was not defined within 3s'});return;}`,
  "setTimeout(poll,50);})();});",
  "window.addEventListener('message',function(e){if(e.source!==P)return;var d=e.data;if(!d||d.type!=='setParams')return;",
  "try{window.SIM.reset(d.values);post({type:'applied',values:d.values});}catch(err){post({type:'error',message:msg(err)});}});",
  "})();",
].join("");

/** Insert the CSP and the bridge right after <head>, before any generated script. */
export function buildSrcdoc(html: string): string {
  const inject = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${BRIDGE_JS}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return html.slice(0, at) + `<head>${inject}</head>` + html.slice(at);
  }
  const doctype = /<!DOCTYPE[^>]*>/i.exec(html);
  const at = doctype ? doctype.index + doctype[0].length : 0;
  return html.slice(0, at) + `<head>${inject}</head>` + html.slice(at);
}

/** Messages from the iframe carry `__simBridge: true`. The caller also checks e.source. */
export function asBridgeMessage(data: unknown): BridgeMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.__simBridge !== true) return null;
  if (d.type === "ready" || d.type === "applied") return d as unknown as BridgeMessage;
  if (d.type === "error")
    return {
      type: "error",
      message: typeof d.message === "string" && d.message ? d.message : "Unknown error",
      line: typeof d.line === "number" ? d.line : undefined,
      col: typeof d.col === "number" ? d.col : undefined,
    };
  return null;
}

export type ParamsResult = { ok: true; params: SimParam[] } | { ok: false; reason: string };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Check a SIM.params array from untrusted code. Clamps `value` into [min, max]. */
export function validateParams(raw: unknown): ParamsResult {
  if (!Array.isArray(raw)) return { ok: false, reason: "SIM.params is not an array." };
  if (raw.length < 1 || raw.length > 4) return { ok: false, reason: `SIM.params has ${raw.length} entries; it needs 1 to 4.` };
  const seen = new Set<string>();
  const params: SimParam[] = [];
  for (const [i, p] of raw.entries()) {
    if (!p || typeof p !== "object") return { ok: false, reason: `Param ${i + 1} is not an object.` };
    const { id, label, min, max, step, value } = p as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) return { ok: false, reason: `Param ${i + 1} has no id.` };
    if (seen.has(id)) return { ok: false, reason: `Param id "${id}" is used twice.` };
    seen.add(id);
    if (![min, max, step, value].every(finite)) return { ok: false, reason: `Param "${id}" has a non-numeric min, max, step or value.` };
    const [lo, hi, st, v] = [min, max, step, value] as number[];
    if (!(lo < hi)) return { ok: false, reason: `Param "${id}" has min ≥ max.` };
    if (!(st > 0)) return { ok: false, reason: `Param "${id}" has a step that isn't positive.` };
    params.push({
      id,
      label: typeof label === "string" && label.trim() ? label : id,
      min: lo,
      max: hi,
      step: st,
      value: Math.min(hi, Math.max(lo, v)),
    });
  }
  return { ok: true, params };
}

export function defaultValues(params: SimParam[]): Record<string, number> {
  return Object.fromEntries(params.map((p) => [p.id, p.value]));
}
