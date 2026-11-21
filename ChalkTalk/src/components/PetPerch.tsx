"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  PICK_PET_EVENT,
  petById,
  petSnapshot,
  petTuckedSnapshot,
  subscribePet,
  writePetTucked,
  type PetCue,
} from "@/lib/pets";
import { PetSprite } from "./PetPicker";

/** Pixels around the pet where a nearby pointer fades it, so it never hides what's under it. */
const FADE_MARGIN = 80;

/**
 * The chosen pet, perched on the top edge of a panel that is already on screen, with a speech bubble.
 * The wrapper lets clicks through; only the pet and its bubble catch them. Clicking the pet tucks it
 * back into the header tile (choosing a pet in the picker brings it back).
 */
export function PetPerch({ cue, className = "", fadeNear = false }: { cue: PetCue; className?: string; fadeNear?: boolean }) {
  const petId = useSyncExternalStore(subscribePet, petSnapshot, () => null);
  const tucked = useSyncExternalStore(subscribePet, petTuckedSnapshot, () => true);
  const pet = petById(petId);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!fadeNear || tucked) return;
    function onMove(e: PointerEvent) {
      const r = button.current?.getBoundingClientRect();
      if (!r || !root.current) return;
      const onPet = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const near =
        e.clientX > r.left - FADE_MARGIN &&
        e.clientX < r.right + FADE_MARGIN &&
        e.clientY > r.top - FADE_MARGIN &&
        e.clientY < r.bottom + FADE_MARGIN;
      root.current.classList.toggle("is-faded", near && !onPet);
    }
    // A pointer that leaves the page, or a touch or pen that lifts, mustn't leave the pet faded.
    function clear(e: PointerEvent) {
      if (e.type === "pointerup" && e.pointerType === "mouse") return;
      root.current?.classList.remove("is-faded");
    }
    const page = document.documentElement;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", clear);
    page.addEventListener("pointerleave", clear);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", clear);
      page.removeEventListener("pointerleave", clear);
    };
  }, [fadeNear, tucked]);

  if (tucked) return null;

  const say = pet ? cue.say : { id: "pick", text: "Pick a lab pet!" };
  return (
    <div ref={root} className={`pet-perch ${className}`} data-mood={pet ? cue.mood : "idle"} data-testid="pet-perch">
      {say ? (
        // Decorative: the page's own status text carries the same news for screen readers.
        <p key={say.id} className={`pet-bubble ${say.stay ? "" : "pet-bubble-brief"}`} aria-hidden data-testid="pet-bubble">
          {say.text}
        </p>
      ) : null}
      <button
        ref={button}
        type="button"
        className="pet-perch-btn"
        data-testid="pet-perch-button"
        title={pet ? `${pet.name}. Click to tuck into the header` : "Pick a pet"}
        aria-label={pet ? `${pet.name}. Tuck into the header` : "Pick a pet"}
        onClick={() => (pet ? writePetTucked(true) : window.dispatchEvent(new Event(PICK_PET_EVENT)))}
      >
        <span className="pet-perch-body">
          {pet ? (
            <PetSprite pet={pet} size={60} />
          ) : (
            <span className="pix grid size-[60px] place-items-center rounded-[6px] border-2 border-ink bg-[#e9edf1] text-[1.6rem] text-ink">
              ?
            </span>
          )}
        </span>
        <span className="pet-sparks" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>
    </div>
  );
}
