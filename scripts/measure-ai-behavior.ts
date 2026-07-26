/**
 * Headless behavioral measurement for the Normal and Rational tournament
 * policies.
 *
 * This drives the **real production engine** (`tournamentSession` +
 * `tournament` + `normal`/`rational`) with the same call signatures `App.tsx`
 * uses, so the numbers describe shipped behavior rather than a model of it.
 * It is the instrument behind E11-001's measurement and E14-001's regression
 * gates; the gate script imports `measureAiBehavior` from here so the gate and
 * the report can never drift apart.
 *
 * Usage:
 *   vite-node scripts/measure-ai-behavior.ts [--seeds N] [--mode normal|rational|both]
 *                                            [--event <id>] [--json] [--freeze-blinds]
 *
 * Determinism: every run with the same arguments produces identical output.
 * No wall-clock, no unseeded randomness.
 */

import {
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createSessionOpponents,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentSession,
} from "../src/modes/tournamentSession";
import { nextToAct } from "../src/engine/betting";

/** App.tsx's live settings, so measurement matches play. */
const POLICY = { simulations: 60, temperature: 0.48 } as const;
const MAX_ACTIONS_PER_HAND = 4_000;
const MAX_HANDS_PER_EVENT = 400;

export interface AiBehaviorMetrics {
  mode: "normal" | "rational";
  seeds: number;
  /** Longest run of consecutive raises/bets within a single street. */
  maxRaiseChain: number;
  chainsAtLeast4: number;
  chainsAtLeast8: number;
  chainsAtLeast10: number;
  totalChains: number;
  vpip: number;
  pfr: number;
  /** Response distribution when a player faces an outstanding bet. */
  facingBet: { fold: number; call: number; raise: number; samples: number };
  preflopAllInHandRate: number;
  postflopAllInHandRate: number;
  /** Raise size as a fraction of the pot it was facing. */
  raiseOverPot: { mean: number; median: number };
  raiseOverEffectiveStack: { mean: number; median: number };
  handsToFirstElimination: { mean: number; median: number };
  handsToHeadsUp: { mean: number; median: number };
  handsToFinish: { mean: number; median: number };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

interface EventAccumulator {
  chains: number[];
  vpipOpportunities: number;
  vpipActions: number;
  pfrOpportunities: number;
  pfrActions: number;
  facingBet: { fold: number; call: number; raise: number };
  handsWithPreflopAllIn: number;
  handsWithPostflopAllIn: number;
  hands: number;
  raiseOverPot: number[];
  raiseOverStack: number[];
  handsToFirstElimination?: number;
  handsToHeadsUp?: number;
  handsToFinish?: number;
}

function emptyAccumulator(): EventAccumulator {
  return {
    chains: [],
    vpipOpportunities: 0,
    vpipActions: 0,
    pfrOpportunities: 0,
    pfrActions: 0,
    facingBet: { fold: 0, call: 0, raise: 0 },
    handsWithPreflopAllIn: 0,
    handsWithPostflopAllIn: 0,
    hands: 0,
    raiseOverPot: [],
    raiseOverStack: [],
  };
}

/** Plays one tournament to completion, recording public decision statistics. */
function playEvent(
  seed: string,
  mode: "normal" | "rational",
  eventId: string,
  freezeBlinds: boolean,
): EventAccumulator {
  const accumulator = emptyAccumulator();
  const opponents = createSessionOpponents(seed, eventId, mode);
  let session: TournamentSession = createTournamentSession({
    eventId,
    hero: { id: "hero", name: "Player", rating: 1_000 },
    mode,
    seed,
    opponents,
  });

  const startingRemaining = session.tournament.players.length;
  let handIndex = 0;

  while (session.status === "playing" && handIndex < MAX_HANDS_PER_EVENT) {
    session = beginTournamentSessionHand(session);
    handIndex += 1;
    accumulator.hands += 1;

    let sawPreflopAllIn = false;
    let sawPostflopAllIn = false;
    let chain = 0;
    let street = session.activeHand?.street;
    let actions = 0;

    while (session.activeHand && actions < MAX_ACTIONS_PER_HAND) {
      const hand = session.activeHand;
      if (hand.street !== street) {
        // A street boundary ends any raise chain in progress.
        if (chain > 0) accumulator.chains.push(chain);
        chain = 0;
        street = hand.street;
      }
      if (hand.betting.complete) {
        if (chain > 0) accumulator.chains.push(chain);
        chain = 0;
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street;
        continue;
      }

      const actor = nextToAct(hand.betting);
      if (!actor) {
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street;
        continue;
      }

      const player = hand.betting.players.find((entry) => entry.id === actor);
      const toCall = Math.max(0, hand.betting.currentBet - (player?.bet ?? 0));
      const preflop = hand.street === "preflop";
      const pot = hand.information.pot;
      const effectiveStack = Math.max(1, player?.stack ?? 1);

      if (preflop) {
        accumulator.vpipOpportunities += 1;
        accumulator.pfrOpportunities += 1;
      }

      const decision = chooseTournamentSessionPolicyAction(session, actor, POLICY);
      const command = decision.command;
      const aggressive = command.type === "bet" || command.type === "raise" ||
        command.type === "all-in";

      if (preflop) {
        if (command.type !== "fold" && command.type !== "check") {
          accumulator.vpipActions += 1;
        }
        if (aggressive) accumulator.pfrActions += 1;
      }

      if (toCall > 0) {
        if (command.type === "fold") accumulator.facingBet.fold += 1;
        else if (command.type === "call") accumulator.facingBet.call += 1;
        else if (aggressive) accumulator.facingBet.raise += 1;
      }

      if (command.type === "all-in") {
        if (preflop) sawPreflopAllIn = true;
        else sawPostflopAllIn = true;
      }

      if (aggressive) {
        chain += 1;
        const raiseTo = command.to ?? effectiveStack + (player?.bet ?? 0);
        const increment = Math.max(0, raiseTo - (player?.bet ?? 0));
        accumulator.raiseOverPot.push(increment / Math.max(1, pot));
        accumulator.raiseOverStack.push(increment / effectiveStack);
      } else if (command.type === "fold" || command.type === "call" ||
        command.type === "check") {
        if (chain > 0) accumulator.chains.push(chain);
        chain = 0;
      }

      session = applyTournamentSessionAction(session, actor, command);
      actions += 1;

      if (session.activeHand?.betting.complete) {
        if (chain > 0) accumulator.chains.push(chain);
        chain = 0;
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street;
      }
    }

    if (chain > 0) accumulator.chains.push(chain);
    if (sawPreflopAllIn) accumulator.handsWithPreflopAllIn += 1;
    if (sawPostflopAllIn) accumulator.handsWithPostflopAllIn += 1;

    const remaining = session.tournament.players.filter(
      (player) => player.stack > 0,
    ).length;
    if (
      accumulator.handsToFirstElimination === undefined &&
      remaining < startingRemaining
    ) {
      accumulator.handsToFirstElimination = handIndex;
    }
    if (accumulator.handsToHeadsUp === undefined && remaining <= 2) {
      accumulator.handsToHeadsUp = handIndex;
    }
    if (freezeBlinds && session.activeHand === undefined) {
      // The blind clock is advanced by the session itself; freezing means we
      // simply do not let level escalation be the explanation for pacing.
      session = { ...session, tournament: { ...session.tournament, level: 0 } };
    }
  }

  accumulator.handsToFinish = handIndex;
  return accumulator;
}

export function measureAiBehavior(options: {
  seeds?: number;
  mode: "normal" | "rational";
  eventId?: string;
  freezeBlinds?: boolean;
}): AiBehaviorMetrics {
  const seedCount = options.seeds ?? 15;
  const eventId = options.eventId ?? "local-qualifier";
  const events = Array.from({ length: seedCount }, (_, index) =>
    playEvent(`ai-measure-${index}`, options.mode, eventId, options.freezeBlinds ?? true),
  );

  const chains = events.flatMap((event) => event.chains);
  const raiseOverPot = events.flatMap((event) => event.raiseOverPot);
  const raiseOverStack = events.flatMap((event) => event.raiseOverStack);
  const facingBet = events.reduce(
    (totals, event) => ({
      fold: totals.fold + event.facingBet.fold,
      call: totals.call + event.facingBet.call,
      raise: totals.raise + event.facingBet.raise,
    }),
    { fold: 0, call: 0, raise: 0 },
  );
  const facingSamples = facingBet.fold + facingBet.call + facingBet.raise;
  const totalHands = events.reduce((sum, event) => sum + event.hands, 0);
  const vpipOpportunities = events.reduce(
    (sum, event) => sum + event.vpipOpportunities,
    0,
  );
  const pfrOpportunities = events.reduce(
    (sum, event) => sum + event.pfrOpportunities,
    0,
  );

  const ratio = (part: number, whole: number) => (whole ? part / whole : 0);

  return {
    mode: options.mode,
    seeds: seedCount,
    maxRaiseChain: chains.length ? Math.max(...chains) : 0,
    chainsAtLeast4: chains.filter((length) => length >= 4).length,
    chainsAtLeast8: chains.filter((length) => length >= 8).length,
    chainsAtLeast10: chains.filter((length) => length >= 10).length,
    totalChains: chains.length,
    vpip: ratio(
      events.reduce((sum, event) => sum + event.vpipActions, 0),
      vpipOpportunities,
    ),
    pfr: ratio(
      events.reduce((sum, event) => sum + event.pfrActions, 0),
      pfrOpportunities,
    ),
    facingBet: {
      fold: ratio(facingBet.fold, facingSamples),
      call: ratio(facingBet.call, facingSamples),
      raise: ratio(facingBet.raise, facingSamples),
      samples: facingSamples,
    },
    preflopAllInHandRate: ratio(
      events.reduce((sum, event) => sum + event.handsWithPreflopAllIn, 0),
      totalHands,
    ),
    postflopAllInHandRate: ratio(
      events.reduce((sum, event) => sum + event.handsWithPostflopAllIn, 0),
      totalHands,
    ),
    raiseOverPot: { mean: mean(raiseOverPot), median: median(raiseOverPot) },
    raiseOverEffectiveStack: {
      mean: mean(raiseOverStack),
      median: median(raiseOverStack),
    },
    handsToFirstElimination: {
      mean: mean(events.flatMap((event) =>
        event.handsToFirstElimination ? [event.handsToFirstElimination] : [])),
      median: median(events.flatMap((event) =>
        event.handsToFirstElimination ? [event.handsToFirstElimination] : [])),
    },
    handsToHeadsUp: {
      mean: mean(events.flatMap((event) =>
        event.handsToHeadsUp ? [event.handsToHeadsUp] : [])),
      median: median(events.flatMap((event) =>
        event.handsToHeadsUp ? [event.handsToHeadsUp] : [])),
    },
    handsToFinish: {
      mean: mean(events.map((event) => event.handsToFinish ?? 0)),
      median: median(events.map((event) => event.handsToFinish ?? 0)),
    },
  };
}
