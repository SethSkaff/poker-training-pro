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
});
