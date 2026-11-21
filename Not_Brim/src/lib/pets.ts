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

export function writePetId(id: PetId): void {
  try {
    window.localStorage.setItem(PET_STORAGE_KEY, id);
  } catch {
    // Storage blocked (private window): the choice still applies until reload.
  }
  memory = id;
  window.dispatchEvent(new Event(PET_EVENT));
}

let memory: PetId | null = null;

/** For useSyncExternalStore: changes in this tab and in other tabs. */
export function subscribePet(onChange: () => void): () => void {
  window.addEventListener(PET_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PET_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function petSnapshot(): PetId | null {
  return readPetId() ?? memory;
}
