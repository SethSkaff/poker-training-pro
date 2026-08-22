import { describe, expect, it } from "vitest";
import {
  avatarVariantForPlayerId,
  firstNameFor2DPlayer,
  unique2DDisplayNames,
  unique2DAvatarVariants,
} from "./PokerTable";
import {
  appearanceSignature,
  describeOpponentCharacter,
  unique2DPlayerAppearances,
} from "../lib/opponentAppearance";

describe("opponent avatar identity", () => {
  it("is deterministic for an entrant and stays independent of seat position", () => {
    const maya = avatarVariantForPlayerId("maya-tempo");
    expect(maya).toBe(avatarVariantForPlayerId("maya-tempo"));
    expect(maya).toBeGreaterThanOrEqual(0);
    expect(maya).toBeLessThan(6);
  });

  it("gives the roster more than one visual variant", () => {
    const variants = new Set(
      ["maya-tempo", "rafael-solver", "adrian-pressure", "juno-mirror", "lena-anchor"]
        .map(avatarVariantForPlayerId),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it("assigns every visible 2D seat a distinct sprite cell", () => {
    const ids = ["maya-tempo", "rafael-solver", "adrian-pressure", "juno-mirror", "lena-anchor", "noor-value"];
    const variants = unique2DAvatarVariants(ids);
    expect(new Set(variants.values()).size).toBe(ids.length);
  });

  it("assigns distinct full procedural combinations and stays stable in replay", () => {
    const ids = ["maya-tempo", "rafael-solver", "adrian-pressure", "juno-mirror", "lena-anchor", "noor-value"];
    const first = unique2DPlayerAppearances(ids);
    const replay = unique2DPlayerAppearances([...ids].reverse());
    expect(new Set([...first.values()].map(appearanceSignature)).size).toBe(ids.length);
    expect([...first.entries()]).toEqual([...replay.entries()]);
    expect(new Set([...first.values()].map((appearance) => appearance.faceShape)).size).toBeGreaterThanOrEqual(2);
    expect(new Set([...first.values()].map((appearance) => appearance.hairStyle)).size).toBeGreaterThanOrEqual(2);
    expect(new Set([...first.values()].map((appearance) => appearance.hairColor)).size).toBeGreaterThanOrEqual(2);
    expect(new Set([...first.values()].map((appearance) => appearance.clothing.name)).size).toBeGreaterThanOrEqual(2);
  });

  it("uses deterministic, gender-matched first names for 2D labels", () => {
    const ids = ["maya-tempo", "rafael-solver", "adrian-pressure", "juno-mirror", "lena-anchor", "noor-value"];
    const names = unique2DDisplayNames(ids);
    expect(new Set(names.values()).size).toBe(ids.length);
    for (const id of ids) {
      const name = names.get(id);
      const baseName = firstNameFor2DPlayer(id);
      expect(baseName).toBe(firstNameFor2DPlayer(id));
      expect(name).toMatch(/^[A-Z][a-z]+$/);
      const expected = describeOpponentCharacter(id).gender === "male"
        ? ["Adrian", "Caleb", "Darius", "Elias", "Jonah", "Mateo", "Nolan", "Rafael"]
        : ["Amara", "Elena", "Isla", "Juno", "Lena", "Maya", "Nadia", "Talia"];
      expect(expected).toContain(name);
    }
  });
});
