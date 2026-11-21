// Draws the board into a PNG for Claude, from the items themselves (sims run in sandboxed
// iframes that can't be captured, so they're drawn as labelled boxes). Browser only.
import type { BoardItem } from "./board";

const MAX_SIDE = 1568;
const MARGIN = 24;

export const NOTE_COLORS = { student: { fill: "#fff4d6", stroke: "#121314" }, claude: { fill: "#e3e8ff", stroke: "#4b69ff" } };

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Base64 PNG (no data: prefix) of the whole board, or null when it's empty. */
export function renderBoardImage(items: BoardItem[]): string | null {
  if (!items.length) return null;
  const x0 = Math.min(...items.map((i) => i.x)) - MARGIN;
  const y0 = Math.min(...items.map((i) => i.y)) - MARGIN;
  const x1 = Math.max(...items.map((i) => i.x + i.w)) + MARGIN;
  const y1 = Math.max(...items.map((i) => i.y + i.h)) + MARGIN;
  const scale = Math.min(1, MAX_SIDE / Math.max(x1 - x0, y1 - y0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((x1 - x0) * scale));
  canvas.height = Math.max(1, Math.round((y1 - y0) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.textBaseline = "top";

  const label = (it: BoardItem, text: string) => {
    ctx.font = "bold 14px system-ui";
    ctx.fillStyle = "#475569";
    ctx.fillText(text, it.x + 6, it.y - 18);
  };

  for (const it of items) {
    if (it.kind === "note") {
      const c = NOTE_COLORS[it.author];
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 3;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = "#0f172a";
      ctx.font = "20px system-ui";
      wrap(ctx, it.text, it.w - 24).forEach((line, i) => {
        if (24 + 26 * (i + 1) < it.h) ctx.fillText(line, it.x + 12, it.y + 12 + 26 * i);
      });
      label(it, `[${it.id}] note by ${it.author}`);
    } else if (it.kind === "ink") {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of it.strokes) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        for (let i = 0; i < s.points.length; i += 2) {
          if (i === 0) ctx.moveTo(s.points[0], s.points[1]);
          else ctx.lineTo(s.points[i], s.points[i + 1]);
        }
        if (s.points.length === 2) ctx.lineTo(s.points[0] + 0.1, s.points[1]);
        ctx.stroke();
      }
      label(it, `[${it.id}] ink by ${it.author}`);
    } else {
      ctx.fillStyle = "#f1f5f9";
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 3;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 24px system-ui";
      ctx.fillText("Simulation", it.x + 16, it.y + 16);
      ctx.font = "20px system-ui";
      wrap(ctx, it.title || it.prompt, it.w - 32).slice(0, 4).forEach((line, i) => ctx.fillText(line, it.x + 16, it.y + 52 + 26 * i));
      label(it, `[${it.id}] simulation by ${it.author}`);
    }
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? null;
}
