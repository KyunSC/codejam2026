"use client";

import { useRef, useSyncExternalStore } from "react";
import { PETS, SPRITE_SIZE, petById, petSnapshot, spritePaths, subscribePet, writePetId, type Pet } from "@/lib/pets";

/** A pet's pixel sprite on a light tile (the ink outlines need a light ground in both themes). */
export function PetSprite({ pet, size }: { pet: Pet; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden
      className="block shrink-0"
    >
      {spritePaths(pet).map((p) => (
        <path key={p.color} d={p.d} fill={p.color} />
      ))}
    </svg>
  );
}

/** Header button showing the chosen pet; opens a dialog to pick one of the six. */
export function PetPicker() {
  const petId = useSyncExternalStore(subscribePet, petSnapshot, () => null);
  const pet = petById(petId);
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      {/* A compact tile: the teacher header has little room to spare at 1280px. */}
      <button
        type="button"
        className="grid size-[2.2rem] shrink-0 cursor-pointer place-items-center rounded-[6px] border-2 border-ink bg-[#e9edf1] text-ink shadow-[3px_3px_0_var(--shadow)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
        data-testid="pet-button"
        aria-haspopup="dialog"
        title={pet ? `Your pet: ${pet.name}. Change pet` : "Pick a pet"}
        onClick={() => dialog.current?.showModal()}
      >
        {pet ? <PetSprite pet={pet} size={32} /> : <span className="pix leading-none" aria-hidden>?</span>}
        <span className="sr-only" data-testid="pet-name">
          {pet ? `Your pet: ${pet.name}. Change pet` : "Pick a pet"}
        </span>
      </button>

      <dialog
        ref={dialog}
        data-testid="pet-dialog"
        aria-labelledby="pet-dialog-title"
        className="card m-auto w-[min(920px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto p-6 text-text backdrop:bg-[rgba(18,19,20,0.55)]"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="pet-dialog-title" className="pix text-[1.8rem] leading-none">
              Pick your lab pet
            </h2>
            <p className="mt-2 text-muted">It keeps you company while you predict. Saved in this browser.</p>
          </div>
          <button type="button" className="btn-secondary min-h-[2.2rem] py-1" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {PETS.map((p) => {
            const chosen = p.id === petId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`pet-option-${p.id}`}
                  aria-pressed={chosen}
                  className={`flex h-full w-full flex-col items-start gap-3 rounded-[6px] border-2 p-4 text-left transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 ${
                    chosen ? "border-ink bg-gold text-ink shadow-[4px_4px_0_var(--shadow)]" : "border-[var(--border)] bg-card-soft"
                  }`}
                  onClick={() => {
                    writePetId(p.id);
                    dialog.current?.close();
                  }}
                >
                  <span className="rounded-[3px] border-2 border-ink bg-[#e9edf1] p-1">
                    <PetSprite pet={p} size={96} />
                  </span>
                  <span className="pix text-[1.3rem] leading-none">
                    {p.name}
                    {chosen ? <span className="sr-only"> (chosen)</span> : null}
                  </span>
                  <span className="leading-snug">{p.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
}
