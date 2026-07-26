import { describe, expect, it } from "vitest";
import { createSessionOpponents } from "./tournamentSession";

describe("seeded tournament roster", () => {
  it("reproduces the same public field for the same seed, event, and mode", () => {
    expect(createSessionOpponents("roster-1", "local-qualifier", "normal")).toEqual(
      createSessionOpponents("roster-1", "local-qualifier", "normal"),
    );
  });

  it("varies the field across mode or event without changing the field size", () => {
    const normal = createSessionOpponents("roster-1", "local-qualifier", "normal");
    const rational = createSessionOpponents("roster-1", "local-qualifier", "rational");
    const regional = createSessionOpponents("roster-1", "regional-classic", "normal");
    expect(normal).toHaveLength(5);
    expect(new Set(normal.map((player) => player.id)).size).toBe(5);
    expect(normal).not.toEqual(rational);
    expect(normal).not.toEqual(regional);
  });

  it("changes the seated field for consecutive deterministic session seeds", () => {
    const first = createSessionOpponents("career-session-1", "local-qualifier", "normal");
    const second = createSessionOpponents("career-session-2", "local-qualifier", "normal");

    expect(first.map((entrant) => entrant.id)).not.toEqual(
      second.map((entrant) => entrant.id),
    );
  });

  it("seats six distinguishable people, never two sharing a name part", () => {
    const field = createSessionOpponents("roster-names", "local-qualifier", "normal");
    const given = field.map((entrant) => entrant.name.split(" ")[0]);
    const family = field.map((entrant) => entrant.name.split(" ")[1]);
    expect(new Set(given).size).toBe(given.length);
    expect(new Set(family).size).toBe(family.length);
  });

  it("avoids re-seating the field the player just finished an event against", () => {
    const previous = createSessionOpponents("career-1", "local-qualifier", "normal");
    const previousIds = previous.map((entrant) => entrant.id);
    const next = createSessionOpponents("career-1", "regional-classic", "normal", {
      avoidIds: previousIds,
    });

    expect(next).toHaveLength(5);
    expect(
      next.filter((entrant) => previousIds.includes(entrant.id)),
    ).toHaveLength(0);
    // Avoidance must not cost determinism.
    expect(
      createSessionOpponents("career-1", "regional-classic", "normal", {
        avoidIds: previousIds,
      }),
    ).toEqual(next);
  });

  it("does not re-seat a field across consecutive career events", () => {
    // This is what actually delivers "immediate repeats are avoided": the
    // identity pool is large enough that avoidance is unnecessary, which is
    // why no avoid-list is persisted into the replay envelope.
    const events = ["local-qualifier", "regional-classic"];
    let identicalFields = 0;
    let pairsSharingAnyone = 0;

    for (let index = 0; index < 400; index += 1) {
      const first = createSessionOpponents(
        `career:e:${index}`,
        events[index % 2],
        "normal",
      ).map((entrant) => entrant.id);
      const second = createSessionOpponents(
        `career:e:${index + 1}`,
        events[(index + 1) % 2],
        "normal",
      ).map((entrant) => entrant.id);
      const shared = first.filter((id) => second.includes(id)).length;
      if (shared === first.length) identicalFields += 1;
      if (shared > 0) pairsSharingAnyone += 1;
    }

    expect(identicalFields).toBe(0);
    // A familiar face now and then is fine; a familiar table is not.
    expect(pairsSharingAnyone).toBeLessThan(60);
  });

  it("fields measurably stronger opponents at higher tiers", () => {
    const meanRating = (tier: Parameters<typeof createSessionOpponents>[3]) =>
      createSessionOpponents("tier-band", "local-qualifier", "normal", tier)
        .reduce((sum, entrant) => sum + entrant.rating, 0) / 5;

    const local = meanRating({ tier: "local" });
    const circuit = meanRating({ tier: "circuit" });
    const world = meanRating({ tier: "world" });

    expect(circuit).toBeGreaterThan(local);
    expect(world).toBeGreaterThan(circuit);
    // The identities themselves are unchanged by tier -- only the strength of
    // the field is, so tier can never be inferred from who is sitting there.
    expect(
      createSessionOpponents("tier-band", "local-qualifier", "normal", {
        tier: "world",
      }).map((entrant) => entrant.id),
    ).toEqual(
      createSessionOpponents("tier-band", "local-qualifier", "normal", {
        tier: "local",
      }).map((entrant) => entrant.id),
    );
  });
});
