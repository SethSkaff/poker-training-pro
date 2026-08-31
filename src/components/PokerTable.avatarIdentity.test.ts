import { describe, expect, it } from "vitest";
import {
  avatarVariantForPlayerId,
  firstNameFor2DPlayer,
  unique2DDisplayNames,
  unique2DAvatarVariants,
} from "./PokerTable";
import {
  appearanceSignature,
  unique2DPlayerAppearances,
} from "../lib/opponentAppearance";
import {
  TWO_D_AVATAR_GENDER_COUNTS,
  TWO_D_AVATAR_MODEL_COUNT,
  genderFor2DName,
  unique2DPlayerIdentities,
} from "../lib/twoDAvatarModels";

describe("opponent avatar identity", () => {
  it("is deterministic for an entrant and stays independent of seat position", () => {
    const maya = avatarVariantForPlayerId("maya-tempo");
    expect(maya).toBe(avatarVariantForPlayerId("maya-tempo"));
    expect(maya).toBeGreaterThanOrEqual(0);
    expect(maya).toBeLessThan(TWO_D_AVATAR_MODEL_COUNT);
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

  it("ships exactly 100 authored models at a 75/25 gender split", () => {
    expect(TWO_D_AVATAR_MODEL_COUNT).toBe(100);
    expect(TWO_D_AVATAR_GENDER_COUNTS).toEqual({ male: 75, female: 25 });
  });

  it("uses deterministic, gender-matched names and models for 2D labels", () => {
    const players = [
      { id: "maya-tempo", name: "Maya" },
      { id: "rafael-solver", name: "Rafael" },
      { id: "adrian-pressure", name: "Adrian" },
      { id: "juno-mirror", name: "Juno" },
      { id: "lena-anchor", name: "Lena" },
      { id: "noor-value", name: "Noor" },
    ];
    const identities = unique2DPlayerIdentities(players);
    const names = unique2DDisplayNames(players);
    expect(new Set(names.values()).size).toBe(players.length);
    for (const player of players) {
      const id = player.id;
      const identity = identities.get(id)!;
      const name = names.get(id);
      const baseName = firstNameFor2DPlayer(id, player.name);
      expect(baseName).toBe(firstNameFor2DPlayer(id, player.name));
      expect(name).toMatch(/^[A-Z][a-z]+$/);
      expect(name).toBe(identity.model.name);
      expect(identity.model.gender).toBe(genderFor2DName(player.name));
    }
  });
});
