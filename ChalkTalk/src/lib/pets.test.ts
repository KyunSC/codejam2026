import { describe, expect, it } from "vitest";
import { PETS, PIXEL_CHARS, SPRITE_SIZE, boardPetCue, petById, spritePaths, studentPetCue } from "./pets";

describe("pets", () => {
  it("has six pets with unique ids", () => {
    expect(PETS).toHaveLength(6);
    expect(new Set(PETS.map((p) => p.id)).size).toBe(6);
  });

  it("every sprite is 16x16 and uses known pixel characters", () => {
    for (const pet of PETS) {
      expect(pet.map, pet.id).toHaveLength(SPRITE_SIZE);
      for (const row of pet.map) {
        expect(row, `${pet.id}: ${row}`).toHaveLength(SPRITE_SIZE);
        for (const ch of row) expect(PIXEL_CHARS.has(ch), `${pet.id} uses "${ch}"`).toBe(true);
      }
    }
  });

  it("draws one path per colour, using the body colour", () => {
    const bob = petById("bob")!;
    const paths = spritePaths(bob);
    expect(new Set(paths.map((p) => p.color)).size).toBe(paths.length);
    expect(paths.some((p) => p.color === bob.body)).toBe(true);
  });

  it("ignores unknown ids", () => {
    expect(petById("dragon")).toBeNull();
    expect(petById(null)).toBeNull();
  });
});

describe("pet cues", () => {
  it("follows the homework flow: wait, lean in, hop on Run, cheer when sent", () => {
    const base = { hasPrediction: false, started: false, reflect: "editing" as const };
    expect(studentPetCue(base).mood).toBe("idle");
    expect(studentPetCue({ ...base, hasPrediction: true }).mood).toBe("lean");
    expect(studentPetCue({ ...base, hasPrediction: true, started: true }).mood).toBe("hop");
    expect(studentPetCue({ ...base, hasPrediction: true, started: true, reflect: "saving" }).mood).toBe("think");
    expect(studentPetCue({ ...base, hasPrediction: true, started: true, reflect: "saved" }).mood).toBe("cheer");
  });

  it("only re-shows the bubble when the step changes", () => {
    const a = studentPetCue({ hasPrediction: true, started: false, reflect: "editing" });
    const b = studentPetCue({ hasPrediction: true, started: false, reflect: "editing" });
    expect(a.say?.id).toBe(b.say?.id);
    expect(studentPetCue({ hasPrediction: false, started: false, reflect: "editing" }).say?.id).not.toBe(a.say?.id);
  });

  it("thinks while Claude works and only cheers when the board changed", () => {
    expect(boardPetCue({ state: "idle" })).toEqual({ mood: "idle", say: null });
    expect(boardPetCue({ state: "busy" }).say?.stay).toBe(true);
    expect(boardPetCue({ state: "done", changes: 2 }).mood).toBe("cheer");
    expect(boardPetCue({ state: "done", changes: 0 }).mood).toBe("idle");
  });
});
