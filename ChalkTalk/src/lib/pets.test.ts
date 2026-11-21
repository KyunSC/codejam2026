import { describe, expect, it } from "vitest";
import { PETS, PIXEL_CHARS, SPRITE_SIZE, petById, spritePaths } from "./pets";

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
