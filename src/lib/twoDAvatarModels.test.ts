import { describe, expect, it } from "vitest";
import {
  TWO_D_AVATAR_GENDER_COUNTS,
  TWO_D_AVATAR_MODEL_COUNT,
  TWO_D_AVATAR_MODELS,
  genderFor2DName,
  unique2DPlayerIdentities,
} from "./twoDAvatarModels";

describe("authored 2D avatar library", () => {
  it("contains exactly 100 models with the requested 75/25 split", () => {
    expect(TWO_D_AVATAR_MODEL_COUNT).toBe(100);
    expect(TWO_D_AVATAR_MODELS).toHaveLength(100);
    expect(TWO_D_AVATAR_GENDER_COUNTS).toEqual({ male: 75, female: 25 });
    expect(new Set(TWO_D_AVATAR_MODELS.map((model) => model.id)).size).toBe(100);
    expect(new Set(TWO_D_AVATAR_MODELS.map((model) => model.name)).size).toBe(100);
  });

  it("keeps names and model gender aligned, defaulting unknown names to male", () => {
    expect(genderFor2DName("Maya Stone")).toBe("female");
    expect(genderFor2DName("Adrian Vale")).toBe("male");
    expect(genderFor2DName("Taylor Vale")).toBe("male");

    const players = [
      { id: "female-player", name: "Mara" },
      { id: "male-player", name: "Tomas" },
      { id: "unknown-player", name: "Taylor" },
    ];
    const identities = unique2DPlayerIdentities(players);
    for (const player of players) {
      expect(identities.get(player.id)?.model.gender).toBe(genderFor2DName(player.name));
    }
  });

  it("randomizes deterministically and avoids duplicate visible models", () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `player-${index}`,
      name: index === 2 ? "Nia" : `Adrian-${index}`,
    }));
    const first = unique2DPlayerIdentities(players);
    const replay = unique2DPlayerIdentities([...players].reverse());

    expect([...first.entries()]).toEqual([...replay.entries()]);
    expect(new Set([...first.values()].map((identity) => identity.model.id)).size).toBe(6);
    expect([...first.values()].every((identity) => identity.displayName === identity.model.name)).toBe(true);
  });
});
