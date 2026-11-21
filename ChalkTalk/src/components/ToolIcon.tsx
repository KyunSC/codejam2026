// Line icons for the toolbox bar, drawn in the text colour.
const PATHS: Record<string, string> = {
  back: "M15 5l-7 7 7 7",
  select: "M5 3l13 7-6 2-2 6z",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  erase: "M8 20h12M5 15l8-8 6 6-6 6H9z",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  laser: "M4 20l8-8M15 9h.01M15 3v2M21 9h-2M19.2 4.8l-1.4 1.4M10.8 4.8l1.4 1.4M19.2 13.2l-1.4-1.4",
  sim: "M4 19h16M7 16V9M12 16V5M17 16v-4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  share: "M12 15V3M7 8l5-5 5 5M5 14v6h14v-6",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13",
};

export function ToolIcon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
