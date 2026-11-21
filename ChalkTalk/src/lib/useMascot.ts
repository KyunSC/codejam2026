"use client";

import { useSyncExternalStore } from "react";
import { petById, petSnapshot, subscribePet } from "./pets";

/** What the app calls the assistant before a pet is picked. */
export const NO_PET_NAME = "your pet";

/**
 * The name the student sees for the assistant: the lab pet they picked (Bob, Newt, Hypo…), so the board says
 * "Ask Hypo" rather than "Ask Claude". Picked in this browser; "your pet" until then and while rendering on the server.
 */
export function useMascotName(): string {
  const id = useSyncExternalStore(subscribePet, petSnapshot, () => null);
  return petById(id)?.name ?? NO_PET_NAME;
}

/** The name at the start of a sentence or on a label: "Your pet" rather than "your pet". */
export const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
