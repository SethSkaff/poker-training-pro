import { describe, expect, it } from "vitest";
import { createSeededRandom, getLegalActions, nextToAct } from "../engine";
import { accountChips, chipValue, createChipLedger } from "../engine/chips";
import type { Card, Rank, Suit } from "../types/poker";
import {
  applyTournamentSessionAction, assertSessionChipInvariant, beginTournamentSessionHand,
  createPokerTableSnapshot, createTournamentSession, progressTournamentSessionHand,
  settleTournamentSessionHand, type TournamentSession,
} from "./tournamentSession";

function create(seed = "physical-chips"): TournamentSession {
  return createTournamentSession({ eventId: "local-qualifier", hero: { id: "hero", name: "Player", rating: 1000 }, mode: "normal", seed });
}

/** Explicit test issuance before play: never repair or regenerate a live ledger. */
function shortTable(stacks: number[]): TournamentSession {
  const session = create();
  session.tournament.players = [...session.tournament.players].sort((a, b) => a.seat! - b.seat!).map((p, i) => ({
    ...p, stack: stacks[i] ?? 0, status: i < stacks.length ? "active" : "eliminated",
  }));
  session.chips = createChipLedger(session.tournament.players);
  return beginTournamentSessionHand(session);
}

function allIn(source: TournamentSession): TournamentSession {
  let session = source;
  while (session.activeHand && !session.activeHand.betting.complete) {
    const actor = nextToAct(session.activeHand.betting)!;
    const legal = getLegalActions(session.activeHand.betting, actor);
    session = applyTournamentSessionAction(session, actor, { type: legal.allIn ? "all-in" : "call" });
  }
  return session;
}

function cards(...codes: string[]): Card[] {
  const suits: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
  return codes.map((code) => ({ rank: code[0] as Rank, suit: suits[code[1]] }));
}

function showdown(session: TournamentSession, holes: Card[][]): TournamentSession {
  const hand = session.activeHand!;
  return {
    ...session,
    activeHand: { ...hand, board: cards("2c", "3d", "4h", "8s", "9c"),
      holeCards: Object.fromEntries(hand.betting.players.map((p, i) => [p.id, holes[i]])) },
  };
}

describe("tournament chip continuity", () => {
  it("projects actual racks, bets, collected chips and public movement events", () => {
    const source = create();
    assertSessionChipInvariant(source);
    const before = JSON.stringify(source);
    const session = beginTournamentSessionHand(source);
    expect(JSON.stringify(source)).toBe(before);
    const snapshot = createPokerTableSnapshot(session);
    expect(snapshot.collectedChipInventory).toEqual({});
    for (const p of snapshot.players) {
      expect(chipValue(p.chipInventory!)).toBe(p.stack);
      expect(chipValue(p.betChipInventory!)).toBe(p.bet);
    }
    expect(snapshot.chipMovements!.filter((m) => m.reason !== "change").map((m) => m.reason)).toEqual(["small-blind", "big-blind"]);
    expect(JSON.stringify(snapshot.chipMovements)).not.toMatch(/"rank"|"suit"|holeCards|seed/);
  });

  it("collects unchanged denominations each street and retains the winning rack into the next hand", () => {
    let session = beginTournamentSessionHand(create());
    while (!session.activeHand!.betting.complete) {
      const actor = nextToAct(session.activeHand!.betting)!;
      const legal = getLegalActions(session.activeHand!.betting, actor);
      session = applyTournamentSessionAction(session, actor, { type: legal.call ? "call" : "check" });
    }
    const bets = session.activeHand!.betting.players.map((p) => [p.id, accountChips(session.chips, `bet:${p.id}`)] as const);
    session = progressTournamentSessionHand(session);
    for (const [id, chips] of bets) {
      expect(accountChips(session.chips, `collected:${id}`)).toEqual(chips);
      expect(accountChips(session.chips, `bet:${id}`)).toEqual({});
    }
    while (session.activeHand) {
      if (session.activeHand.betting.complete) session = progressTournamentSessionHand(session, { completionScope: "full-field" });
      else session = applyTournamentSessionAction(session, nextToAct(session.activeHand.betting)!, { type: "fold" });
    }
    assertSessionChipInvariant(session);
    const before = JSON.stringify(session);
    const next = beginTournamentSessionHand(session);
    expect(JSON.stringify(session)).toBe(before);
    const posters = new Set(next.chips.movements.filter((m) => m.reason.endsWith("blind")).map((m) => m.from));
    for (const player of session.tournament.players) {
      if (!posters.has(`player:${player.id}`)) expect(accountChips(next.chips, `player:${player.id}`)).toEqual(accountChips(session.chips, `player:${player.id}`));
    }
    expect(next.chips.movements[0].sequence).toBeGreaterThan(session.chips.movements.at(-1)!.sequence);
  });

  it("pays unequal all-ins, nested side pots, uncalled returns and eliminations correctly", () => {
    let session = allIn(shortTable([1000, 500, 250]));
    session = showdown(session, [cards("Kc", "Kd"), cards("Qc", "Qd"), cards("Ac", "Ad")]);
    const ids = session.activeHand!.betting.players.map((p) => p.id);
    const source = JSON.stringify(session);
    const settled = settleTournamentSessionHand(session, { completionScope: "full-field" });
    expect(JSON.stringify(session)).toBe(source);
    expect(ids.map((id) => settled.tournament.players.find((p) => p.id === id)!.stack)).toEqual([1000, 0, 750]);
    expect(settled.lastHand!.pots.map((p) => p.amount)).toEqual([750, 500]);
    expect(Object.values(settled.lastHand!.chipPots).map(chipValue)).toEqual([750, 500]);
    expect(settled.chips.movements.filter((m) => m.reason === "refund").map((m) => [m.to, m.value])).toEqual([[`player:${ids[0]}`, 500]]);
    expect(settled.lastHand!.eliminatedPlayerIds).toEqual([ids[1]]);
    expect(accountChips(settled.chips, `player:${ids[1]}`)).toEqual({});
    assertSessionChipInvariant(settled);
  });

  it("preserves the existing clockwise odd-chip rule in both main and side pots", () => {
    let session = allIn(shortTable([175, 175, 75]));
    session = showdown(session, [cards("Ac", "Kd"), cards("Ad", "Kh"), cards("Qc", "Jd")]);
    const eligible = session.activeHand!.betting.players.slice(0, 2).map((p) => p.id);
    const settled = settleTournamentSessionHand(session, { completionScope: "full-field" });
    expect(settled.lastHand!.pots.map((p) => p.amount)).toEqual([225, 200]);
    expect(settled.lastHand!.awards.filter((a) => a.potId === "main").map((a) => a.amount).sort((a, b) => a - b)).toEqual([100, 125]);
    const distance = (id: string) => {
      const seat = session.tournament.players.find((p) => p.id === id)!.seat!;
      return (seat - session.activeHand!.buttonSeat + 6) % 6 || 6;
    };
    const oddWinner = eligible.sort((a, b) => distance(a) - distance(b))[0];
    expect(settled.lastHand!.awards.find((a) => a.potId === "main" && a.playerId === oddWinner)!.amount).toBe(125);
    expect(settled.tournament.players.find((p) => p.id === oddWinner)!.stack).toBe(225);
    assertSessionChipInvariant(settled);
  });

  it("allocates several physical side pots without crossing eligibility caps", () => {
    let session = allIn(shortTable([1000, 800, 600, 400, 200]));
    session = showdown(session, [cards("Tc", "Td"), cards("Jc", "Jd"), cards("Qc", "Qd"), cards("Kc", "Kd"), cards("Ac", "Ad")]);
    const ids = session.activeHand!.betting.players.map((p) => p.id);
    const settled = settleTournamentSessionHand(session, { completionScope: "full-field" });
    expect(settled.lastHand!.pots.map((p) => p.amount)).toEqual([1000, 800, 600, 400]);
    expect(Object.values(settled.lastHand!.chipPots).map(chipValue)).toEqual([1000, 800, 600, 400]);
    expect(ids.map((id) => settled.tournament.players.find((p) => p.id === id)!.stack)).toEqual([200, 400, 600, 800, 1000]);
    assertSessionChipInvariant(settled);
  });

  it("rejects a scalar-only edit instead of silently rebuilding chip denominations", () => {
    const session = beginTournamentSessionHand(create());
    session.tournament.players[0].stack += 25;
    expect(() => assertSessionChipInvariant(session)).toThrow(/stack/);
    expect(() => applyTournamentSessionAction(session, nextToAct(session.activeHand!.betting)!, { type: "fold" })).toThrow(/stack/);
  });

  it("conserves physical inventory through seeded legal bets, raises, calls and full-field runouts", () => {
    for (let seed = 0; seed < 12; seed++) {
      let session = create(`ledger-soak-${seed}`);
      const random = createSeededRandom(`actions-${seed}`);
      for (let step = 0; step < 1500 && session.status !== "complete"; step++) {
        assertSessionChipInvariant(session);
        if (!session.activeHand) { session = beginTournamentSessionHand(session); continue; }
        if (session.activeHand.betting.complete) { session = progressTournamentSessionHand(session, { completionScope: "full-field" }); continue; }
        const actor = nextToAct(session.activeHand.betting)!;
        const legal = getLegalActions(session.activeHand.betting, actor);
        const roll = random();
        const command = roll < 0.15 && legal.allIn ? { type: "all-in" as const }
          : roll < 0.3 && legal.raise ? { type: "raise" as const, to: legal.raise.minTo }
          : roll < 0.45 && legal.bet ? { type: "bet" as const, to: legal.bet.min }
          : roll < 0.6 ? { type: "fold" as const }
          : { type: legal.call ? "call" as const : "check" as const };
        session = applyTournamentSessionAction(session, actor, command);
      }
      expect(session.status).toBe("complete");
      assertSessionChipInvariant(session);
    }
  });
});
