/**
 * The six Live Sim pets. Each sprite is a 16x16 pixel map, one character per pixel:
 * "." empty, "k" ink, "w" white, "b" the pet's body colour, "d" a darker body shade,
 * and fixed accents "r" red, "g" gold, "G" green, "B" blue, "s" light.
 */

export type PetId = "bob" | "newt" | "hypo" | "blocky" | "quark" | "scope";

export type Pet = {
  id: PetId;
  name: string;
  blurb: string;
  body: string;
  shade: string;
  light: string;
  map: readonly string[];
};

export const SPRITE_SIZE = 16;

export const PETS: readonly Pet[] = [
  {
    id: "bob",
    name: "Bob",
    blurb: "A pendulum bob. Spoiler: being heavier doesn’t make him faster.",
    body: "#4b69ff",
    shade: "#344ab3",
    light: "#c6d0da",
    map: [
      "...kkkkkkkkkk...",
      ".......kk.......",
      ".......kk.......",
      ".......kk.......",
      ".....kkkkkk.....",
      "...kkbbbbbbkk...",
      "..kbbwwbbbbbbk..",
      ".kbbwbbbbbbbbbk.",
      ".kbbbkbbbbkbbbk.",
      ".kbbbkbbbbkbbbk.",
      ".kbrrbbbbbbrrbk.",
      ".kbbbbbkkbbbbdk.",
      "..kbbbbbbbbddk..",
      "...kkbbbbbbkk...",
      ".....kkkkkk.....",
      "................",
    ],
  },
  {
    id: "newt",
    name: "Newt",
    blurb: "Isaac Newt, waiting for the apple on his head to fall.",
    body: "#3fb950",
    shade: "#2c8238",
    light: "#c6d0da",
    map: [
      ".......kG.......",
      "......krrk......",
      ".....krrwrk.....",
      ".....krrrrk.....",
      "......kkkk......",
      "...kkkkkkkkkk...",
      "..kbbbbbbbbbbk..",
      ".kbwwbbbbbbwwbk.",
      ".kbwkbbbbbbwkbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbbkkkkkkbbbk.",
      "..kbbbbbbbbbbk..",
      "..kdgdgdgdgdgk..",
      ".kbk.kbbbbk.kbk.",
      ".kk...kkkk...kk.",
      "................",
    ],
  },
  {
    id: "hypo",
    name: "Hypo",
    blurb: "The hypothesis owl. Predict first, then run it.",
    body: "#8a6a4a",
    shade: "#614a34",
    light: "#e9d8c0",
    map: [
      "................",
      "..kk........kk..",
      "..kbk......kbk..",
      "..kbbkkkkkkbbk..",
      ".kbbbbbbbbbbbbk.",
      ".kbgggbbbbgggbk.",
      ".kgwwwgbbgwwwgk.",
      ".kgwkwgkkgwkwgk.",
      ".kgwwwgbbgwwwgk.",
      ".kbgggbggbgggbk.",
      ".kbbbbbbbbbbbbk.",
      ".kbbssbssbssbbk.",
      "..kbbsbbsbbsbk..",
      "...kbbbbbbbbk...",
      "....gkkkkkkg....",
      "....gg....gg....",
    ],
  },
  {
    id: "blocky",
    name: "Blocky",
    blurb: "The crate from every ramp problem. Friction is his love language.",
    body: "#e4ae39",
    shade: "#a07a28",
    light: "#c6d0da",
    map: [
      "................",
      "................",
      "................",
      "...kkkkkkkkkk...",
      "...kbbbbbbbbk...",
      "...kbbbbbbbbk...",
      "...kbkkbbkkbk...",
      "...kbkkbbkkbk...",
      "...kbbbbbbbbk...",
      "...kbbrkkrbbk...",
      "...kbbbbbbbbk...",
      "...kddddddddk...",
      "...kkkkkkkkkk...",
      "kkkkkkkkkkkkkkkk",
      "ssssssssssssssss",
      "ssssssssssssssss",
    ],
  },
  {
    id: "quark",
    name: "Quark",
    blurb: "A tiny particle that never quite sits still.",
    body: "#9b7bff",
    shade: "#6c56b3",
    light: "#c6d0da",
    map: [
      "................",
      "..G..........g..",
      "................",
      "......kkkk......",
      "....kkbbbbkk....",
      "...kbbwbbbbbk...",
      "...kbwbbbbbbk...",
      "..kbbkbbbbkbbk..",
      "..kbbkbbbbkbbk..",
      "..kbbbbkkbbbbk..",
      "...kbbbbbbbdk...",
      "...kbbbbbbddk...",
      "....kkddddkk....",
      "......kkkk......",
      ".B............r.",
      "................",
    ],
  },
  {
    id: "scope",
    name: "Scope",
    blurb: "A lab robot whose face is an oscilloscope screen.",
    body: "#c6d0da",
    shade: "#8b9299",
    light: "#c6d0da",
    map: [
      "........r.......",
      "........k.......",
      "..kkkkkkkkkkkk..",
      "..kbbbbbbbbbbk..",
      "..kbkkkkkkkkbk..",
      "..kbkkGGkkkkbk..",
      "..kbkGkkGkkkbk..",
      "..kbGkkkkGkkbk..",
      "..kbkkkkkkGGbk..",
      "..kbkkkkkkkkbk..",
      "..kbbbbbbbbbbk..",
      "..kbbrbbbbgbbk..",
      "..kkkkkkkkkkkk..",
      "....kk....kk....",
      "...kkk...kkk....",
      "................",
    ],
  },
];

const FIXED: Record<string, string> = {
  k: "#121314",
  w: "#ffffff",
  r: "#eb4b4b",
  g: "#e4ae39",
  G: "#3fb950",
  B: "#4b69ff",
};

export const PIXEL_CHARS = new Set([".", "b", "d", "s", ...Object.keys(FIXED)]);

export function petById(id: string | null | undefined): Pet | null {
  return PETS.find((p) => p.id === id) ?? null;
}

/** One SVG path per colour: `M x y h1 v1 h-1 z` for every pixel of that colour. */
export function spritePaths(pet: Pet): { color: string; d: string }[] {
  const colors: Record<string, string> = { ...FIXED, b: pet.body, d: pet.shade, s: pet.light };
  const byColor = new Map<string, string[]>();
  pet.map.forEach((row, y) => {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const color = colors[row[x]];
      if (!color) continue;
      const list = byColor.get(color) ?? [];
      list.push(`M${x} ${y}h1v1h-1z`);
      byColor.set(color, list);
    }
  });
  return Array.from(byColor, ([color, cells]) => ({ color, d: cells.join("") }));
}

/** The chosen pet lives in this browser only. */
export const PET_STORAGE_KEY = "livesim.pet";
const PET_EVENT = "livesim:pet";

export function readPetId(): PetId | null {
  try {
    return petById(window.localStorage.getItem(PET_STORAGE_KEY))?.id ?? null;
  } catch {
    return null;
  }
}

let unsavedPet: PetId | null = null;

export function writePetId(id: PetId): void {
  try {
    window.localStorage.setItem(PET_STORAGE_KEY, id);
    unsavedPet = null;
  } catch {
    unsavedPet = id;
  }
  window.dispatchEvent(new Event(PET_EVENT));
}

/** For useSyncExternalStore: changes in this tab and in other tabs. */
export function subscribePet(onChange: () => void): () => void {
  window.addEventListener(PET_EVENT, onChange);
  function onStorage(event: StorageEvent) {
    if (event.key !== PET_STORAGE_KEY && event.key !== PERCH_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea !== window.localStorage) return;
    unsavedPet = null;
    onChange();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PET_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function petSnapshot(): PetId | null {
  return unsavedPet ?? readPetId();
}

/** "tucked" when the student put the pet away into the header tile. */
export const PERCH_STORAGE_KEY = "livesim.pet.perch";
let unsavedTucked: boolean | null = null;

export function petTuckedSnapshot(): boolean {
  if (unsavedTucked !== null) return unsavedTucked;
  try {
    return window.localStorage.getItem(PERCH_STORAGE_KEY) === "tucked";
  } catch {
    return false;
  }
}

export function writePetTucked(tucked: boolean): void {
  try {
    if (tucked) window.localStorage.setItem(PERCH_STORAGE_KEY, "tucked");
    else window.localStorage.removeItem(PERCH_STORAGE_KEY);
    unsavedTucked = null;
  } catch {
    unsavedTucked = tucked;
  }
  window.dispatchEvent(new Event(PET_EVENT));
}

/** Asks the header PetPicker to open its dialog (the perch has no dialog of its own). */
export const PICK_PET_EVENT = "livesim:pick-pet";

/** How the perched pet behaves. Animations live in globals.css under `.pet-perch`. */
export type PetMood = "idle" | "lean" | "hop" | "think" | "cheer";

/** A speech bubble. A new `id` shows it again; the same id leaves it as it is. */
export type PetSay = { id: string; text: string; stay?: boolean };
export type PetCue = { mood: PetMood; say: PetSay | null };

/** The homework page: wait for a prediction, lean in while it's written, hop on Run, cheer when it's sent. */
export function studentPetCue(s: {
  hasPrediction: boolean;
  started: boolean;
  reflect: "editing" | "saving" | "saved" | "error";
}): PetCue {
  if (!s.started) {
    return s.hasPrediction
      ? { mood: "lean", say: { id: "typing", text: "Ooh, go on…" } }
      : { mood: "idle", say: { id: "wait", text: "Predict first. I'll wait." } };
  }
  if (s.reflect === "saving") return { mood: "think", say: null };
  if (s.reflect === "saved") return { mood: "cheer", say: { id: "saved", text: "Sent! Nice work." } };
  if (s.reflect === "error") return { mood: "idle", say: { id: "error", text: "Uh oh. Try sending again." } };
  return { mood: "hop", say: { id: "run", text: "Now look." } };
}

/** The board: think while Claude works, cheer when it's done. The panel's own status line has the details. */
export function boardPetCue(ask: { state: "idle" | "busy" | "done" | "error"; changes?: number }): PetCue {
  switch (ask.state) {
    case "busy":
      return { mood: "think", say: { id: "busy", text: "Hmm…", stay: true } };
    case "done":
      return ask.changes
        ? { mood: "cheer", say: { id: "done", text: "Done! Have a look." } }
        : { mood: "idle", say: { id: "done", text: "Looks good to me." } };
    case "error":
      return { mood: "idle", say: { id: "error", text: "Uh oh." } };
    default:
      return { mood: "idle", say: null };
  }
}
