import { describe, expect, it } from "vitest";
import {
  currentBlindLevel,
  getLegalActions,
  nextToAct,
} from "../engine";
import type { BettingActionCommand } from "../engine";
import {
  SESSION_FORMAT,
  SESSION_TABLE_SIZE,
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  calculatePairwiseTournamentElo,
  chooseTournamentSessionPolicyAction,
  createPokerTableSnapshot,
  createTournamentSession,
  listTournamentSessionEvents,
  progressTournamentSessionHand,
  type TournamentSession,
  type TournamentSessionCareerResult,
  type TournamentSessionEntrant,
} from "./tournamentSession";

const hero: TournamentSessionEntrant = {
  id: "hero",
  name: "Player",
  rating: 1_000,
  normalProfile: "tempo",
};

function createSession(
  mode: "normal" | "rational" = "normal",
  seed = "session-seed",
): TournamentSession {
  return createTournamentSession({
    eventId: "local-qualifier",
    hero,
    mode,
    seed,
  });
}

function foldOutHand(source: TournamentSession): TournamentSession {
  let session = source;
  while (session.activeHand && !session.activeHand.betting.complete) {
    const actor = nextToAct(session.activeHand.betting);
    if (!actor) throw new Error("Expected an actor");
    session = applyTournamentSessionAction(session, actor, { type: "fold" });
  }
  return progressTournamentSessionHand(session);
}

function allPlayersAllIn(source: TournamentSession): TournamentSession {
  let session = source;
  let first = true;
  while (session.activeHand && !session.activeHand.betting.complete) {
    const actor = nextToAct(session.activeHand.betting);
    if (!actor) throw new Error("Expected an actor");
    const legal = getLegalActions(session.activeHand.betting, actor);
    let command: BettingActionCommand;
    if (first) {
      command = { type: "all-in" };
      first = false;
    } else if (legal.call) {
      command = { type: "call" };
    } else if (legal.allIn) {
      command = { type: "all-in" };
    } else {
      command = { type: "check" };
    }
    session = applyTournamentSessionAction(session, actor, command);
  }

  while (session.activeHand) {
    session = progressTournamentSessionHand(session);
  }
  return session;
}

describe("compressed career event selection", () => {
  it("discloses the six-seat format and scales qualification from source fields", () => {
    const events = listTournamentSessionEvents();
    const local = events[0];
    const world = events[events.length - 1];

    expect(events).toHaveLength(5);
    expect(local).toMatchObject({
      id: "local-qualifier",
      sourceFieldSize: 27,
      sessionFieldSize: 6,
      qualifyingPlaces: 2,
      unlocked: true,
      format: SESSION_FORMAT,
    });
    expect(local.disclosure).toContain("Compressed local six-seat");
    expect(world).toMatchObject({
      id: "world-championship",
      sourceFieldSize: 360,
      qualifyingPlaces: 1,
      unlocked: false,
    });
  });

  it("unlocks the next event only after a qualifying compressed result", () => {
    const missed: TournamentSessionCareerResult = {
      eventId: "local-qualifier",
      finishPlace: 3,
      fieldSize: 6,
      sourceFieldSize: 27,
      qualifyingPlaces: 2,
      qualified: false,
      tournamentEloDelta: -4,
    };
    const qualified: TournamentSessionCareerResult = {
      ...missed,
      finishPlace: 2,
      qualified: true,
      tournamentEloDelta: 7,
    };

    expect(
      listTournamentSessionEvents([missed]).find(
        (event) => event.id === "regional-open",
      )?.unlocked,
    ).toBe(false);
    expect(
      listTournamentSessionEvents([qualified]).find(
        (event) => event.id === "regional-open",
      )?.unlocked,
    ).toBe(true);
    expect(() =>
      createTournamentSession({
        eventId: "regional-open",
        hero,
        mode: "normal",
        seed: "locked",
      }),
    ).toThrow(/locked/);
  });

  it("preserves WSOP-like blind ratios and the source level amounts", () => {
    const event = listTournamentSessionEvents()[0];
    for (const level of event.structure.levels.slice(0, 12)) {
      expect(level.smallBlind / level.bigBlind).toBeGreaterThanOrEqual(0.4);
      expect(level.smallBlind / level.bigBlind).toBeLessThanOrEqual(2 / 3);
      expect(level.bigBlindAnte).toBe(level.bigBlind);
    }
    expect(event.structure.maxSeats).toBe(SESSION_TABLE_SIZE);
  });
});

describe("six-seat tournament session", () => {
  it("seats and deals deterministically, posting a big-blind ante and blinds", () => {
    const first = beginTournamentSessionHand(createSession());
    const replay = beginTournamentSessionHand(createSession());
    const hand = first.activeHand;
    if (!hand) throw new Error("Expected a hand");
    const level = currentBlindLevel(first.tournament);

    expect(first.tournament.players).toHaveLength(6);
    expect(first.tournament.players).toEqual(replay.tournament.players);
    expect(hand.holeCards).toEqual(replay.activeHand?.holeCards);
    expect(hand.information.pot).toBe(
      level.bigBlindAnte + level.smallBlind + level.bigBlind,
    );
    expect(hand.information.actingPlayerId).toBe(nextToAct(hand.betting));
    expect(new Set(first.tournament.players.map((player) => player.seat)).size).toBe(
      6,
    );
  });

  it("advances blind levels with residual time through the core clock", () => {
    let session = createSession();
    const first = currentBlindLevel(session.tournament);
    session = advanceTournamentSessionClock(
      session,
      first.durationMs + 12_345,
    );

    expect(currentBlindLevel(session.tournament).level).toBe(2);
    expect(session.tournament.levelElapsedMs).toBe(12_345);
    expect(session.tournament.totalElapsedMs).toBe(
      first.durationMs + 12_345,
    );
  });

  it("rotates the button and increments hand number after a settled hand", () => {
    let session = beginTournamentSessionHand(createSession());
    const firstButton = session.activeHand?.buttonSeat;
    session = foldOutHand(session);
    expect(session.activeHand).toBeUndefined();
    expect(session.lastHand?.awards).toHaveLength(1);

    session = beginTournamentSessionHand(session);
    expect(session.activeHand?.buttonSeat).not.toBe(firstButton);
    expect(session.tournament.tables[0].handNumber).toBe(2);
  });

  it("uses the core pot and elimination engines for an all-in runout", () => {
    let session = beginTournamentSessionHand(
      createSession("normal", "all-in-field"),
    );
    const totalChips = session.tournament.players.reduce(
      (sum, player) => sum + player.stack,
      0,
    ) + (session.activeHand?.information.pot ?? 0);
    session = allPlayersAllIn(session);

    expect(session.lastHand?.board).toHaveLength(5);
    expect(session.lastHand?.eliminatedPlayerIds.length).toBeGreaterThan(0);
    expect(session.tournament.players.filter((player) => player.stack === 0).length)
      .toBeGreaterThan(0);
    expect(
      session.tournament.players.reduce(
        (sum, player) => sum + player.stack,
        0,
      ),
    ).toBe(totalChips);
    expect(session.status).toBe("complete");
    expect(session.result).toBeDefined();
    expect(session.result?.finishPlace).toBeGreaterThanOrEqual(1);
    expect(session.result?.finishPlace).toBeLessThanOrEqual(6);
    expect(session.result?.qualified).toBe(
      (session.result?.finishPlace ?? 6) <= 2,
    );
    expect(session.result?.placementLabel).toMatch(/^[1-6](st|nd|rd|th) of 6$/);
    expect(session.result?.qualificationLabel.length).toBeGreaterThan(0);
    expect(session.result?.unlockedEventIds).toContain("local-qualifier");
    if (session.result?.qualified) {
      expect(session.result.newlyUnlockedEventIds).toContain("regional-open");
      expect(session.result.nextEventId).toBe("regional-open");
    } else {
      expect(session.result?.newlyUnlockedEventIds).not.toContain(
        "regional-open",
      );
    }
  });

  it("builds a PokerTable-compatible snapshot without opponent cards", () => {
    const session = beginTournamentSessionHand(createSession());
    const snapshot = createPokerTableSnapshot(session);
    const heroSnapshot = snapshot.players.find((player) => player.id === "hero");

    expect(snapshot.players).toHaveLength(6);
    expect(snapshot.heroSeat).toBe(0);
    expect(snapshot.heroCards).toHaveLength(2);
    expect(heroSnapshot?.cards).toEqual(snapshot.heroCards);
    expect(
      snapshot.players
        .filter((player) => player.id !== "hero")
        .every((player) => player.cards === undefined),
    ).toBe(true);
    expect(snapshot.pot).toBeGreaterThan(0);
    expect(snapshot.tags).toContain(SESSION_FORMAT);
  });
});

describe("policy and rating adapters", () => {
  it("calls both Rational and Normal policies from the same session contract", () => {
    const rationalSession = beginTournamentSessionHand(
      createSession("rational", "policy-rational"),
    );
    const rationalActor = nextToAct(
      rationalSession.activeHand?.betting as NonNullable<
        TournamentSession["activeHand"]
      >["betting"],
    );
    if (!rationalActor) throw new Error("Expected rational actor");
    const rational = chooseTournamentSessionPolicyAction(
      rationalSession,
      rationalActor,
      { simulations: 60 },
    );

    const normalSession = beginTournamentSessionHand(
      createSession("normal", "policy-normal"),
    );
    const normalActor = nextToAct(
      normalSession.activeHand?.betting as NonNullable<
        TournamentSession["activeHand"]
      >["betting"],
    );
    if (!normalActor) throw new Error("Expected normal actor");
    const normal = chooseTournamentSessionPolicyAction(
      normalSession,
      normalActor,
      { simulations: 60 },
    );

    expect(rational.mode).toBe("rational");
    expect(normal.mode).toBe("normal");
    expect(
      getLegalActions(
        rationalSession.activeHand!.betting,
        rationalActor,
      ),
    ).toBeDefined();
    expect(normal.command).toEqual(
      chooseTournamentSessionPolicyAction(normalSession, normalActor, {
        simulations: 60,
      }).command,
    );
  });

  it("computes pairwise tournament Elo symmetrically for an equal field", () => {
    const opponents = Array.from({ length: 5 }, (_, index) => ({
      id: `opponent-${index}`,
      rating: 1_000,
      actual: 1 as const,
    }));
    const win = calculatePairwiseTournamentElo(hero, opponents, 1);
    const loss = calculatePairwiseTournamentElo(
      hero,
      opponents.map((opponent) => ({ ...opponent, actual: 0 as const })),
      1,
    );

    expect(win.entries).toHaveLength(5);
    expect(win.totalDelta).toBe(16);
    expect(loss.totalDelta).toBe(-16);
    expect(win.entries.every((entry) => entry.expectedScore === 0.5)).toBe(true);
  });
});
