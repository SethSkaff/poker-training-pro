import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import {
  AUTHENTIC_MAIN_EVENT_STRUCTURE,
  CAREER_EVENTS,
  advanceTournamentClock,
  createInformationSet,
  createTournament,
  currentBlindLevel,
  getUnlockedCareerEventIds,
  planTableBalance,
  planTableBreak,
  recordEliminations,
  type HandInformationSource,
  type TournamentStructure,
} from "./tournament";

const suits: Record<string, Suit> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

function cards(...values: string[]): Card[] {
  return values.map((value) => ({
    rank: value[0] as Rank,
    suit: suits[value[1]],
  }));
}

function entrants(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
  }));
}

describe("tournament director", () => {
  it("contains the WSOP-like Main Event opening structure", () => {
    expect(AUTHENTIC_MAIN_EVENT_STRUCTURE.startingStack).toBe(60_000);
    expect(AUTHENTIC_MAIN_EVENT_STRUCTURE.levels[0]).toMatchObject({
      smallBlind: 100,
      bigBlind: 200,
      bigBlindAnte: 200,
      durationMs: 120 * 60_000,
    });
    expect(AUTHENTIC_MAIN_EVENT_STRUCTURE.levels).toHaveLength(47);
  });

  it("advances multiple blind levels without losing residual time", () => {
    const structure: TournamentStructure = {
      id: "test",
      name: "Test",
      startingStack: 1_000,
      maxSeats: 9,
      rated: false,
      levels: [
        {
          level: 1,
          smallBlind: 5,
          bigBlind: 10,
          bigBlindAnte: 10,
          durationMs: 1_000,
        },
        {
          level: 2,
          smallBlind: 10,
          bigBlind: 20,
          bigBlindAnte: 20,
          durationMs: 2_000,
        },
        {
          level: 3,
          smallBlind: 20,
          bigBlind: 40,
          bigBlindAnte: 40,
          durationMs: 3_000,
        },
      ],
    };
    let state = createTournament("clock", structure, entrants(2), "seed");
    state = advanceTournamentClock(state, 3_500);

    expect(currentBlindLevel(state).level).toBe(3);
    expect(state.levelElapsedMs).toBe(500);
    expect(state.totalElapsedMs).toBe(3_500);
  });

  it("seats entrants deterministically and keeps tables balanced", () => {
    const first = createTournament(
      "event",
      AUTHENTIC_MAIN_EVENT_STRUCTURE,
      entrants(20),
      "same-seed",
    );
    const replay = createTournament(
      "event",
      AUTHENTIC_MAIN_EVENT_STRUCTURE,
      entrants(20),
      "same-seed",
    );
    const different = createTournament(
      "event",
      AUTHENTIC_MAIN_EVENT_STRUCTURE,
      entrants(20),
      "different-seed",
    );

    expect(replay.players).toEqual(first.players);
    expect(different.players).not.toEqual(first.players);
    const counts = first.tables.map(
      (table) =>
        first.players.filter((player) => player.tableId === table.id).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("unlocks career events only after qualifying finishes", () => {
    expect(getUnlockedCareerEventIds([])).toEqual(["local-qualifier"]);
    expect(
      getUnlockedCareerEventIds([
        { eventId: "local-qualifier", finishPlace: 10, fieldSize: 27 },
      ]),
    ).toEqual(["local-qualifier"]);
    expect(
      getUnlockedCareerEventIds([
        { eventId: "local-qualifier", finishPlace: 9, fieldSize: 27 },
      ]),
    ).toEqual(["local-qualifier", "regional-open"]);
    expect(CAREER_EVENTS.map((event) => event.id)).toContain(
      "world-championship",
    );
  });

  it("plans deterministic table balancing and table breaks", () => {
    const state = createTournament(
      "tables",
      AUTHENTIC_MAIN_EVENT_STRUCTURE,
      entrants(18),
      "balance-seed",
    );
    const shortTable = state.tables[1].id;
    const eliminated = state.players
      .filter((player) => player.tableId === shortTable)
      .slice(0, 3);
    for (const player of eliminated) player.status = "eliminated";

    const balance = planTableBalance(state);
    expect(balance).not.toBeNull();
    expect(balance?.toTableId).toBe(shortTable);
    expect(
      state.players.some(
        (player) =>
          player.tableId === balance?.toTableId &&
          player.seat === balance?.toSeat &&
          player.status === "active",
      ),
    ).toBe(false);

    const activeBeforeBreak = state.players.filter(
      (player) => player.status === "active",
    );
    for (const player of activeBeforeBreak.slice(0, activeBeforeBreak.length - 9)) {
      player.status = "eliminated";
    }
    expect(
      state.players.filter((player) => player.status === "active"),
    ).toHaveLength(9);
    const breakPlan = planTableBreak(state);
    expect(breakPlan).not.toBeNull();
    expect(
      new Set(breakPlan?.moves.map((move) => `${move.toTableId}:${move.toSeat}`))
        .size,
    ).toBe(breakPlan?.moves.length);
  });

  it("orders simultaneous same-table busts by starting stack", () => {
    const state = createTournament(
      "elimination",
      AUTHENTIC_MAIN_EVENT_STRUCTURE,
      entrants(4),
      "elimination-seed",
    );
    const [short, deep] = state.players;
    const next = recordEliminations(state, [
      {
        playerId: short.id,
        handId: "hand-1",
        tableId: short.tableId as string,
        startedHandWith: 1_000,
      },
      {
        playerId: deep.id,
        handId: "hand-1",
        tableId: deep.tableId as string,
        startedHandWith: 4_000,
      },
    ]);

    expect(next.players.find((player) => player.id === deep.id)?.finishPlace).toBe(
      3,
    );
    expect(next.players.find((player) => player.id === short.id)?.finishPlace).toBe(
      4,
    );
  });
});

describe("information-set projection", () => {
  const source: HandInformationSource = {
    handId: "hand-12",
    street: "turn",
    board: cards("Ah", "7d", "2c", "Js"),
    pot: 1_200,
    currentBet: 400,
    actingPlayerId: "hero",
    buttonSeat: 3,
    players: [
      {
        id: "hero",
        name: "Hero",
        seat: 1,
        stack: 5_000,
        status: "active",
        streetCommitted: 0,
        totalCommitted: 400,
        holeCards: cards("As", "Kd"),
      },
      {
        id: "villain",
        name: "Villain",
        seat: 2,
        stack: 4_000,
        status: "active",
        streetCommitted: 400,
        totalCommitted: 800,
        holeCards: cards("7s", "7c"),
      },
      {
        id: "allin",
        name: "All In",
        seat: 3,
        stack: 0,
        status: "all-in",
        streetCommitted: 400,
        totalCommitted: 400,
        holeCards: cards("Qh", "Jh"),
        revealed: true,
      },
    ],
    actions: [{ playerId: "villain", type: "bet", amount: 400 }],
    deck: cards("3s", "4s"),
    burnCards: cards("5s"),
    seed: "super-secret",
  };

  it("shows only the viewer's cards and explicitly revealed hands", () => {
    const view = createInformationSet(source, "hero");
    expect(view.players.find((player) => player.id === "hero")?.holeCards).toEqual(
      cards("As", "Kd"),
    );
    expect(
      view.players.find((player) => player.id === "villain")?.holeCards,
    ).toBeUndefined();
    expect(
      view.players.find((player) => player.id === "allin")?.holeCards,
    ).toEqual(cards("Qh", "Jh"));
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("burnCards");
    expect(view).not.toHaveProperty("seed");
  });

  it("is invariant when hidden opponent cards and deck order change", () => {
    const changed: HandInformationSource = {
      ...source,
      players: source.players.map((player) =>
        player.id === "villain"
          ? { ...player, holeCards: cards("2h", "3h") }
          : player,
      ),
      deck: cards("4c", "5c"),
      seed: "different-secret",
    };
    expect(createInformationSet(changed, "hero")).toEqual(
      createInformationSet(source, "hero"),
    );
  });
});
