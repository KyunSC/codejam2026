import { createContext, useContext, useMemo } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditMode } from "./EditMode";

// Drag to reorder, in edit mode only. Outside edit mode both components render their children as they are.
// SortableArea adds no element of its own: the caller's container (a nav, a grid, a <tr>) holds the items.
// Each item gets a grip button (focusable: Space picks up, arrows move, Space drops, Esc cancels) and can be
// dragged with the pointer anywhere on the item, or only by its header for cards and sections.

export type Strategy = "horizontal" | "vertical" | "grid";
const STRATEGY = { horizontal: horizontalListSortingStrategy, vertical: verticalListSortingStrategy, grid: rectSortingStrategy };

const LabelCtx = createContext<(id: UniqueIdentifier) => string>((id) => String(id));

export function SortableArea({ ids, labels, strategy, onReorder, children }: {
  ids: string[]; // the movable items, in order (locked items are left out and rendered as plain children)
  labels: Record<string, string>; // for screen-reader announcements
  strategy: Strategy;
  onReorder: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const { editing, setDragging } = useEditMode();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // a click (tab, chip, button) never starts a drag
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const label = useMemo(() => (id: UniqueIdentifier) => labels[String(id)] ?? String(id), [labels]);
  if (!editing) return <>{children}</>;

  const pos = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}. Position ${pos(active.id)} of ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${label(active.id)} moved to position ${pos(over.id)} of ${ids.length}.` : `${label(active.id)} is not over a position.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${label(active.id)} at position ${pos(over.id)} of ${ids.length}.` : `Dropped ${label(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${label(active.id)} stays at position ${pos(active.id)} of ${ids.length}.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(false)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "To move this item, press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel." } }}
    >
      <LabelCtx.Provider value={label}>
        <SortableContext items={ids} strategy={STRATEGY[strategy]}>{children}</SortableContext>
      </LabelCtx.Provider>
    </DndContext>
  );
}

type DragProps = React.HTMLAttributes<HTMLElement>;
export type ItemParts = {
  grip: React.ReactNode; // the grip button, or null outside edit mode
  dragProps: DragProps; // for handle items: spread on the header that starts a pointer drag (empty otherwise)
};
type ItemProps = {
  id: string;
  as?: "div" | "span" | "section" | "th" | "li";
  className?: string;
  handle?: boolean; // drag by a header (cards, sections) instead of anywhere on the item
  children: (parts: ItemParts) => React.ReactNode;
};

export function SortableItem(props: ItemProps) {
  const { editing } = useEditMode();
  if (!editing) {
    const Tag = props.as ?? "div";
    return <Tag className={props.className}>{props.children({ grip: null, dragProps: {} })}</Tag>;
  }
  return <DraggableItem {...props} />;
}

function DraggableItem({ id, as = "div", className = "", handle, children }: ItemProps) {
  const label = useContext(LabelCtx);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  // Keyboard drags start only from the grip, so Space on a link or the hide button inside the item keeps its own meaning.
  const dragProps: DragProps = {
    ...listeners,
    onKeyDown: (e) => {
      if ((e.target as HTMLElement).dataset.grip) listeners?.onKeyDown?.(e);
    },
  };
  const grip = (
    <button type="button" className="grip" data-grip="true" ref={setActivatorNodeRef} {...attributes} aria-label={`Move ${label(id)}`}>
      <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.3" /><circle cx="6" cy="2" r="1.3" /><circle cx="2" cy="6" r="1.3" /><circle cx="6" cy="6" r="1.3" /><circle cx="2" cy="10" r="1.3" /><circle cx="6" cy="10" r="1.3" /></g></svg>
    </button>
  );
  const Tag = as;
  return (
    <Tag
      ref={setNodeRef as React.Ref<never>}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${className} sortable${isDragging ? " is-dragging" : ""}${handle ? " sortable--handle" : ""}`}
      {...(handle ? {} : dragProps)}
    >
      {children({ grip, dragProps: handle ? dragProps : {} })}
    </Tag>
  );
}
