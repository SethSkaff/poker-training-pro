import { describe, expect, it } from "vitest";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import { createSceneTransition } from "./sceneTransition";
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
    expect(snapshot).toMatchObject({
      buttonRelativeSeat: 5,
      smallBlindRelativeSeat: 0,
      bigBlindRelativeSeat: 2,
      buttonPlayerId: "villain",
      smallBlindPlayerId: "hero",
      bigBlindPlayerId: "folded",
      tier: "regional",
    });
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

  it("reconciles a fixed public hand through every street without exposing a live opponent", () => {
    const publicHand = {
      ...input,
      heroCardCodes: ["A♠", "K♦"],
      buttonCanonicalSeat: 8,
      smallBlindCanonicalSeat: 3,
      bigBlindCanonicalSeat: 5,
    };
    const beats = [
      { board: [], button: 8, smallBlind: 3, bigBlind: 5, markers: [5, 0, 2] },
      { board: ["2♣", "7♦", "T♥"], button: 8, smallBlind: 3, bigBlind: 5, markers: [5, 0, 2] },
      { board: ["2♣", "7♦", "T♥", "J♠"], button: 5, smallBlind: 8, bigBlind: 3, markers: [2, 5, 0] },
      { board: ["2♣", "7♦", "T♥", "J♠", "Q♣"], button: 5, smallBlind: 8, bigBlind: 3, markers: [2, 5, 0] },
    ] as const;

    for (const beat of beats) {
      const snapshot = createTableSceneSnapshot({
        ...publicHand,
        boardCards: beat.board.length,
        publicBoardCardCodes: beat.board,
        buttonCanonicalSeat: beat.button,
        smallBlindCanonicalSeat: beat.smallBlind,
        bigBlindCanonicalSeat: beat.bigBlind,
      });
      expect(snapshot.publicBoardCardCodes).toEqual(beat.board);
      expect(snapshot.boardCards).toBe(beat.board.length);
      expect([snapshot.buttonRelativeSeat, snapshot.smallBlindRelativeSeat, snapshot.bigBlindRelativeSeat])
        .toEqual(beat.markers);
      expect(snapshot.seats.find((seat) => seat.id === "hero")?.publicCardCodes).toEqual(["A♠", "K♦"]);
      expect(snapshot.seats.find((seat) => seat.id === "villain")?.publicCardCodes).toEqual([]);
    }

    const showdown = createTableSceneSnapshot({
      ...publicHand,
      boardCards: 5,
      publicBoardCardCodes: ["2♣", "7♦", "T♥", "J♠", "Q♣"],
      revealedPlayerIds: ["villain"],
      revealedCardCodesByPlayer: { villain: ["A♥", "A♦"] },
    });
    expect(showdown.seats.find((seat) => seat.id === "villain")?.publicCardCodes).toEqual(["A♥", "A♦"]);
  });

  it("is invariant to unapproved opponent card-code inputs", () => {
    const publicInput = { ...input, heroCardCodes: ["As", "Kd"] };
    const expected = createTableSceneSnapshot(publicInput);

    for (const privateCards of [["Qs", "Qd"], ["2c", "3d"], ["Th", "9h"]]) {
      expect(createTableSceneSnapshot({
        ...publicInput,
        revealedCardCodesByPlayer: { villain: privateCards },
      })).toEqual(expected);
    }
  });

  it("hands skip and reduced motion the identical terminal public scene state", () => {
    const fold: TournamentPresentationEvent = {
      id: "h1:fold:2",
      kind: "action",
      handId: "h1",
      playerId: "villain",
      command: { type: "fold" },
    };
    const skipped = createSceneTransition(fold, 1, false);
    const reduced = createSceneTransition(fold, 0, true);
    expect(reduced).toEqual(skipped);
    expect(createTableSceneSnapshot({ ...input, transition: reduced })).toEqual(
      createTableSceneSnapshot({ ...input, transition: skipped }),
    );
  });

  it("keeps camera motion policy separate from table-action reduced motion", () => {
    const snapshot = createTableSceneSnapshot({
      ...input,
      cameraMotion: "off",
      // Turning only the camera off must not turn a public bet into a scene
      // terminal state; table/transition motion owns that choice.
      reducedMotion: false,
    });
    expect(snapshot).toMatchObject({ cameraMotion: "off", reducedMotion: false });
  });

  it("retains only public swept amounts while the next street has cleared DOM bets", () => {
    const collect: TournamentPresentationEvent = {
      id: "h1:collect", kind: "bets-collected", handId: "h1", amount: 90,
      collections: [{ playerId: "villain", amount: 25 }, { playerId: "folded", amount: 40 }],
    };
    const snapshot = createTableSceneSnapshot({
      ...input,
      // This is the next authoritative street: the DOM quite correctly has no
      // live bet. The scene temporarily draws only the already-public sweep.
      players: input.players.map((player) => ({ ...player, bet: 0 })),
      publicActions: {},
      transition: createSceneTransition(collect, 0, false),
    });
    expect(snapshot.seats.find((seat) => seat.id === "villain")).toMatchObject({
      bet: 25,
      action: "collect",
    });
    expect(snapshot.seats.find((seat) => seat.id === "hero")?.bet).toBe(0);
    expect(snapshot.seats.find((seat) => seat.id === "folded")).toMatchObject({
      folded: true,
      bet: 40,
      action: "collect",
    });
    expect(JSON.stringify(snapshot)).not.toContain("holeCards");
  });

  it("keeps a skipped fold terminal while its pre-fold result snapshot is readable", () => {
    const result: TournamentPresentationEvent = {
      id: "skip:h1:hand-result", kind: "hand-result", handId: "h1", awards: [],
    };
    const transition = createSceneTransition(result, 0, false);
    const retained = { ...transition, foldedPlayerIds: ["villain"] };
    const snapshot = createTableSceneSnapshot({
      ...input,
      publicActions: {},
      transition: retained,
    });
    const villain = snapshot.seats.find((seat) => seat.id === "villain");
    expect(villain).toMatchObject({ folded: true });
    expect(villain).not.toHaveProperty("action");
    expect(snapshot.transition).toMatchObject({
      id: "skip:h1:hand-result",
      foldedPlayerIds: ["villain"],
    });
  });
});
