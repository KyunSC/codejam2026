"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { InkItem, Stroke } from "@/lib/board";

export function strokePath(points: number[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
  if (points.length === 2) d += `l0.1 0`;
  return d;
}

export function StrokePaths({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
}

/** Handwriting. Its points are in board coordinates, so the SVG's viewBox is the item's box. */
export function InkView({
  item,
  selected,
  onDragStart,
}: {
  item: InkItem;
  selected: boolean;
  onDragStart: (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      className={`board-item ink-item h-full w-full rounded-lg ${selected ? "outline-3 outline-dashed outline-[var(--gold)]" : ""}`}
      data-testid="ink"
      data-item-id={item.id}
      data-author={item.author}
      onPointerDown={onDragStart}
    >
      <svg className="block h-full w-full overflow-visible" viewBox={`${item.x} ${item.y} ${item.w} ${item.h}`}>
        <StrokePaths strokes={item.strokes} />
      </svg>
    </div>
  );
}
