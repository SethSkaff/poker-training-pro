import { performance } from "node:perf_hooks";
import type { Card } from "../src/types/poker";
import type { LegalActionSet } from "../src/engine/betting";
import type { PlayerInformationSet } from "../src/engine/tournament";
import {
  estimateRangeEquity,
  MAX_EQUITY_SIMULATIONS_PER_DECISION,
} from "../src/modes/rational";

const card = (rank: Card["rank"], suit: Card["suit"]): Card => ({
  rank,
  suit,
});

const informationSet: PlayerInformationSet = {
  handId: "equity-profile-fixed-hand",
  viewerId: "hero",
  street: "flop",
  board: [
    card("T", "hearts"),
    card("7", "diamonds"),
    card("2", "clubs"),
  ],
  pot: 1_200,
  currentBet: 400,
  actingPlayerId: "hero",
  buttonSeat: 6,
  players: [
    {
      id: "hero",
      name: "Hero",
      seat: 6,
      stack: 8_000,
      status: "active",
      streetCommitted: 0,
      totalCommitted: 400,
      holeCards: [card("A", "spades"), card("K", "spades")],
    },
    {
      id: "villain-a",
      name: "Villain A",
      seat: 2,
      stack: 8_000,
      status: "active",
      streetCommitted: 400,
      totalCommitted: 800,
    },
    {
      id: "villain-b",
      name: "Villain B",
      seat: 4,
      stack: 6_000,
      status: "active",
      streetCommitted: 400,
      totalCommitted: 800,
    },
  ],
  actions: [
    { playerId: "villain-a", type: "bet", amount: 400 },
    { playerId: "villain-b", type: "call", amount: 400 },
  ],
};

const legalActions: LegalActionSet = {
  playerId: "hero",
  toCall: 400,
  check: false,
  fold: true,
  call: true,
  callAmount: 400,
  raise: { minTo: 800, maxTo: 8_000 },
  allIn: true,
  allInTo: 8_000,
  raisingReopened: true,
};

const counts = [50, 200, 700, MAX_EQUITY_SIMULATIONS_PER_DECISION];
const repeats = 5;
const rows = counts.map((simulations) => {
  const elapsed: number[] = [];
  let final = estimateRangeEquity(
    informationSet,
    legalActions,
    "profile-warmup",
    simulations,
  );
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const start = performance.now();
    final = estimateRangeEquity(
      informationSet,
      legalActions,
      `profile-${simulations}-${repeat}`,
      simulations,
    );
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((left, right) => left - right);
  return {
    simulations,
    medianObservedMs: Number(elapsed[Math.floor(elapsed.length / 2)].toFixed(3)),
    minimumObservedMs: Number(elapsed[0].toFixed(3)),
    maximumObservedMs: Number(elapsed[elapsed.length - 1].toFixed(3)),
    exactWork: final.work,
  };
});

process.stdout.write(
  `${JSON.stringify(
    {
      evidenceKind: "local-observation-not-release-gate",
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      repeats,
      note:
        "Elapsed time is reported for profiling only and never affects samples, stopping, or decisions.",
      rows,
    },
    null,
    2,
  )}\n`,
);

