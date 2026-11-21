// The bridge between the sandboxed sim iframe and the app. Pure and client-safe.
import type { BridgeMessage, SimParam } from "./types";

export const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

export const SIM_WAIT_MS = 3000;

// Generated sims often draw more text than fits, so labels pile on top of each
// other. This wraps fillText/strokeText: within one synchronous draw, a string
// that would overlap text already drawn on the same canvas, run past the left
// or right edge, or repeat SIM.title / SIM.question (the host shows those) is
// skipped. Whatever is drawn first wins. The list of drawn boxes empties after
// each task, so it works with any animation loop.
const TEXT_GUARD_JS = [
  "(function(){var C=window.CanvasRenderingContext2D;if(!C||!C.prototype.measureText)return;",
  "var P=C.prototype,F=P.fillText,S=P.strokeText,boxes=[],pend=false;",
  "function clear(){boxes=[];pend=false;}",
  "function shown(s){var Q=window.SIM;if(!Q)return true;var q=typeof Q.question==='string'?Q.question.trim():'';",
  "if(typeof Q.title==='string'&&Q.title.trim()&&s===Q.title.trim())return false;",
  "if(q.length>12&&(s.indexOf(q.slice(0,24))>=0||(s.length>24&&q.indexOf(s)>=0)))return false;return true;}",
  "function box(c,s,x,y,mw){var m=c.measureText(s),l=m.actualBoundingBoxLeft||0,r=m.actualBoundingBoxRight,a=m.actualBoundingBoxAscent,d=m.actualBoundingBoxDescent;",
  "if(r==null)r=m.width;if(a==null){a=parseFloat(c.font)||10;d=a*0.25;}var w=l+r;if(mw>0&&w>mw){l*=mw/w;r*=mw/w;}",
  "var T=c.getTransform(),X=[],Y=[];[[x-l,y-a],[x+r,y-a],[x-l,y+d],[x+r,y+d]].forEach(function(p){X.push(T.a*p[0]+T.c*p[1]+T.e);Y.push(T.b*p[0]+T.d*p[1]+T.f);});",
  "return{c:c.canvas,s:s,x0:Math.min.apply(0,X),x1:Math.max.apply(0,X),y0:Math.min.apply(0,Y),y1:Math.max.apply(0,Y)};}",
  "function ok(c,s,x,y,mw){s=String(s);var t=s.trim();if(!t)return true;if(!shown(t))return false;",
  "if(!c.getTransform||!isFinite(x)||!isFinite(y))return true;var b=box(c,s,x,y,mw),W=c.canvas.width;",
  "if(b.x1-b.x0<1)return true;if(b.x0<-2||b.x1>W+2)return false;",
  "for(var i=0;i<boxes.length;i++){var o=boxes[i];if(o.c!==b.c)continue;",
  "if(o.s===s&&Math.abs(o.x0-b.x0)<2&&Math.abs(o.y0-b.y0)<2)return true;",
  "var ix=Math.min(o.x1,b.x1)-Math.max(o.x0,b.x0),iy=Math.min(o.y1,b.y1)-Math.max(o.y0,b.y0);",
  "if(ix>0&&iy>0&&ix*iy>0.1*Math.min((o.x1-o.x0)*(o.y1-o.y0),(b.x1-b.x0)*(b.y1-b.y0)))return false;}",
  "boxes.push(b);if(!pend){pend=true;Promise.resolve().then(clear);}return true;}",
  "function wrap(f){return function(s,x,y,mw){var go=true;try{go=ok(this,s,x,y,mw);}catch(_){}if(go)return f.apply(this,arguments);};}",
  "P.fillText=wrap(F);P.strokeText=wrap(S);})();",
].join("");

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
  TEXT_GUARD_JS,
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
