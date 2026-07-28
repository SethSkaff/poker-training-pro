import { describe, expect, it } from "vitest";
import { createTableSceneSnapshot } from "./tableSceneSnapshot";

const input = { players: [
  { id: "villain", canonicalSeat: 8, stack: 900, bet: 25, status: "active" as const },
  { id: "hero", canonicalSeat: 3, stack: 1000, bet: 0, status: "active" as const },
  { id: "folded", canonicalSeat: 5, stack: 700, bet: 40, status: "folded" as const },
], heroId: "hero", actingPlayerId: "villain", publicActions: { villain: "bet" as const }, pot: 65, boardCards: 3, cameraPan: 1, reducedMotion: false };

describe("table scene snapshot", () => {
  it("is deterministic and keeps canonical identity through hero-relative projection", () => {
    const first = createTableSceneSnapshot(input);
    expect(createTableSceneSnapshot(input)).toEqual(first);
    expect(first.seats.map((seat) => [seat.id, seat.canonicalSeat, seat.relativeSeat])).toEqual([["hero", 3, 0], ["folded", 5, 2], ["villain", 8, 5]]);
    expect(first.seats.at(-1)).toMatchObject({ acting: true, action: "bet" });
  });

  it("does not accept private cards and omits eliminated seats", () => {
    const snapshot = createTableSceneSnapshot({ ...input, players: [...input.players, { id: "out", canonicalSeat: 7, stack: 0, bet: 0, status: "out" }] });
    expect(snapshot.seats.map((seat) => seat.id)).not.toContain("out");
    expect(JSON.stringify(snapshot)).not.toContain("cards");
  });

  it("carries only legal public reveal and table-marker vocabulary", () => {
    const snapshot = createTableSceneSnapshot({ ...input, buttonCanonicalSeat: 8, smallBlindCanonicalSeat: 3, bigBlindCanonicalSeat: 5, revealedPlayerIds: ["villain"], tier: "regional" });
    expect(snapshot).toMatchObject({ buttonRelativeSeat: 5, smallBlindRelativeSeat: 0, bigBlindRelativeSeat: 2, tier: "regional" });
    expect(snapshot.seats.map((seat) => [seat.id, seat.cardVisibility])).toEqual([["hero", "shown"], ["folded", "hidden"], ["villain", "shown"]]);
    expect(snapshot.seats[0].appearance).toBe(createTableSceneSnapshot(input).seats[0].appearance);
  });

  it("reconciles a table move by immutable identity rather than array position", () => {
    const moved = createTableSceneSnapshot({ ...input, players: [
      { id: "hero", canonicalSeat: 1, stack: 1000, bet: 0, status: "active" },
      { id: "villain", canonicalSeat: 4, stack: 900, bet: 25, status: "active" },
    ] });
    expect(moved.seats.map((seat) => [seat.id, seat.canonicalSeat, seat.relativeSeat])).toEqual([["hero", 1, 0], ["villain", 4, 3]]);
  });

  it("keeps valid hero-relative projections from heads-up through six-handed", () => {
    for (let count = 2; count <= 6; count += 1) {
      const players = Array.from({ length: count }, (_, seat) => ({ id: seat === 0 ? "hero" : `p${seat}`, canonicalSeat: seat, stack: 1000, bet: 0, status: "active" as const }));
      const snapshot = createTableSceneSnapshot({ ...input, players, heroId: "hero" });
      expect(snapshot.seats).toHaveLength(count);
      expect(new Set(snapshot.seats.map((seat) => seat.id)).size).toBe(count);
      expect(snapshot.seats[0]).toMatchObject({ id: "hero", relativeSeat: 0 });
    }
  });

  it("contains card identities only for the hero and engine-authorized reveal", () => {
    const snapshot = createTableSceneSnapshot({ ...input, heroCardCodes: ["As", "Kd"], publicBoardCardCodes: ["2c", "3d", "4h"], revealedPlayerIds: ["villain"], revealedCardCodesByPlayer: { villain: ["Qs", "Qd"] } });
    expect(snapshot.publicBoardCardCodes).toEqual(["2c", "3d", "4h"]);
    expect(snapshot.seats.map((seat) => [seat.id, seat.publicCardCodes])).toEqual([["hero", ["As", "Kd"]], ["folded", []], ["villain", ["Qs", "Qd"]]]);
  });
});
