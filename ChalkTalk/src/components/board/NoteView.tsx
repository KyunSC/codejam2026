"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { MAX_NOTE_CHARS, type NoteItem } from "@/lib/board";
import { NOTE_COLORS } from "@/lib/board-image";
import { capitalized, useMascotName } from "@/lib/useMascot";

/** A note. The student can type in their own notes; Claude's notes are read-only for the student but can be moved or deleted. */
export function NoteView({
  item,
  selected,
  autoFocus,
  onText,
  onDragStart,
  onResizeStart,
  onDelete,
}: {
  item: NoteItem;
  selected: boolean;
  autoFocus: boolean;
  onText: (text: string) => void;
  onDragStart: (e: ReactPointerEvent) => void;
  onResizeStart: (e: ReactPointerEvent) => void;
  onDelete: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const mascot = useMascotName();
  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);
  const c = NOTE_COLORS[item.author];
  const mine = item.author === "student";
  return (
    <div
      className="board-item flex h-full flex-col overflow-hidden rounded-[6px] border-2 text-[#121314]"
      style={{ background: c.fill, borderColor: "#121314", boxShadow: `5px 5px 0 ${selected ? "#e4ae39" : c.stroke}` }}
      data-testid="note"
      data-item-id={item.id}
      data-author={item.author}
    >
      <div className="flex h-8 shrink-0 cursor-grab items-center gap-2 px-2 active:cursor-grabbing" onPointerDown={onDragStart} data-testid="item-handle">
        <span className="flex-1 text-base font-bold uppercase tracking-wide text-[#55595e]">{mine ? "You" : capitalized(mascot)}</span>
        <button type="button" className="item-x" aria-label="Delete note" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete}>
          ×
        </button>
      </div>
      {mine ? (
        <textarea
          ref={area}
          className="min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-[1.1rem] font-medium leading-snug outline-none placeholder:text-[#55595e]"
          aria-label="Note"
          data-testid="note-text"
          placeholder="Write here…"
          value={item.text}
          maxLength={MAX_NOTE_CHARS}
          onChange={(e) => onText(e.target.value)}
        />
      ) : (
        <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-3 pb-3 text-[1.1rem] font-medium leading-snug" data-testid="note-text" data-scrolls="1">
          {item.text}
        </p>
      )}
      <div className="resize-handle" onPointerDown={onResizeStart} aria-hidden />
    </div>
  );
}
