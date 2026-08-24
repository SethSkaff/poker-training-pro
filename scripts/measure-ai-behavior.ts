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
  advanceTournamentSessionClock,
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

/**
 * Nominal time a six-handed hand takes at the table.
 *
 * Blind levels are wall-clock timed, and the running game advances the clock
 * from real elapsed time between actions. A headless run has no wall clock, so
 * without a stand-in the level never escalates -- which silently erases the
 * difference between a 4-minute level and an 8-minute one, and makes every
 * tier pace identically. 75 s is the middle of a live six-handed hand,
 * counting the deal.
 */
const MS_PER_HAND = 75_000;

export interface AiBehaviorMetrics {
  mode: "normal" | "rational";
  seeds: number;
  /** Number of events that reached a terminal tournament state. */
  completedEvents: number;
  /** Events stopped by a harness safety cap before the tournament finished. */
  cappedEvents: number;
  /** One explicit outcome timeline per requested seed. */
  eventTimelines: readonly AiBehaviorEventTimeline[];
  /** Longest run of consecutive raises/bets within a single street. */
  maxRaiseChain: number;
  chainsAtLeast4: number;
  chainsAtLeast8: number;
  chainsAtLeast10: number;
  totalChains: number;
  vpip: number;
  pfr: number;
  /** Share of preflop re-raise opportunities taken, by depth of the raise. */
  threeBet: number;
  fourBet: number;
  /** Response distribution when a player faces an outstanding bet. */
  facingBet: { fold: number; call: number; raise: number; samples: number };
  preflopAllInHandRate: number;
  postflopAllInHandRate: number;
  /** Raise size as a fraction of the pot it was facing. */
  raiseOverPot: { mean: number; median: number };
  raiseOverEffectiveStack: { mean: number; median: number };
  handsToFirstElimination: { mean: number; median: number; samples: number };
  handsToHeadsUp: { mean: number; median: number; samples: number };
  handsToFinish: { mean: number; median: number; samples: number };
}

export type AiBehaviorEventTermination = "finished" | "hand-cap" | "action-cap";

/**
 * A milestone timeline is deliberately retained per seed. Aggregating only
 * defined milestones is useful for descriptive statistics, but is unsafe as a
 * regression gate: a capped event otherwise disappears from heads-up samples.
 */
export interface AiBehaviorEventTimeline {
  seed: string;
  handsPlayed: number;
  termination: AiBehaviorEventTermination;
  handsToFirstElimination?: number;
  handsToHeadsUp?: number;
  handsToFinish?: number;
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
  seed: string;
  chains: number[];
  vpipOpportunities: number;
  vpipActions: number;
  pfrOpportunities: number;
  pfrActions: number;
  threeBetOpportunities: number;
  threeBetActions: number;
  fourBetOpportunities: number;
  fourBetActions: number;
  facingBet: { fold: number; call: number; raise: number };
  handsWithPreflopAllIn: number;
  handsWithPostflopAllIn: number;
  hands: number;
  raiseOverPot: number[];
  raiseOverStack: number[];
  handsToFirstElimination?: number;
  handsToHeadsUp?: number;
  handsToFinish?: number;
  timeline?: AiBehaviorEventTimeline;
}

function emptyAccumulator(seed: string): EventAccumulator {
  return {
    seed,
    chains: [],
    vpipOpportunities: 0,
    vpipActions: 0,
    pfrOpportunities: 0,
    pfrActions: 0,
    threeBetOpportunities: 0,
    threeBetActions: 0,
    fourBetOpportunities: 0,
    fourBetActions: 0,
    facingBet: { fold: 0, call: 0, raise: 0 },
    handsWithPreflopAllIn: 0,
    handsWithPostflopAllIn: 0,
    hands: 0,
    raiseOverPot: [],
    raiseOverStack: [],
  };
}

/**
 * Career results that unlock the requested event.
 *
 * Higher tiers are gated behind qualifying at the tier below, so measuring one
 * in isolation requires synthesising the qualifications that would have got a
 * player there. These are inputs to the *unlock check* only -- they do not
 * change how the event plays.
 */
const UNLOCK_CHAIN: Record<string, readonly string[]> = {
  "local-qualifier": [],
  "regional-open": ["local-qualifier"],
  "circuit-main": ["local-qualifier", "regional-open"],
  "national-championship": ["local-qualifier", "regional-open", "circuit-main"],
  "world-championship": [
    "local-qualifier",
    "regional-open",
    "circuit-main",
    "national-championship",
  ],
};

function unlockingResults(eventId: string) {
  return (UNLOCK_CHAIN[eventId] ?? []).map((id) => ({
    eventId: id,
    finishPlace: 1,
    fieldSize: 6 as const,
    sourceFieldSize: 6,
    qualifyingPlaces: 2,
    qualified: true,
    tournamentEloDelta: 0,
  }));
}

/** Plays one tournament to completion, recording public decision statistics. */
function playEvent(
  seed: string,
  mode: "normal" | "rational",
  eventId: string,
  freezeBlinds: boolean,
): EventAccumulator {
  const accumulator = emptyAccumulator(seed);
  const opponents = createSessionOpponents(seed, eventId, mode);
  let session: TournamentSession = createTournamentSession({
    eventId,
    hero: { id: "hero", name: "Player", rating: 1_000 },
    mode,
    seed,
    opponents,
    careerResults: unlockingResults(eventId),
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

      // Preflop raise depth: the blinds are not raises, so the first
      // voluntary raise is the open, the second is a 3-bet, the third a
      // 4-bet. Counted from public actions only.
      const preflopRaisesSoFar = preflop
        ? hand.information.actions.filter(
            (entry) =>
              entry.type === "raise" ||
              entry.type === "bet" ||
              entry.type === "all-in",
          ).length
        : 0;

      if (preflop) {
        accumulator.vpipOpportunities += 1;
        accumulator.pfrOpportunities += 1;
        if (preflopRaisesSoFar === 1) accumulator.threeBetOpportunities += 1;
        if (preflopRaisesSoFar === 2) accumulator.fourBetOpportunities += 1;
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
        if (aggressive && preflopRaisesSoFar === 1) {
          accumulator.threeBetActions += 1;
        }
        if (aggressive && preflopRaisesSoFar === 2) {
          accumulator.fourBetActions += 1;
        }
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
    if (!freezeBlinds) {
      session = advanceTournamentSessionClock(session, MS_PER_HAND);
    }
  }

  const termination: AiBehaviorEventTermination =
    session.status !== "playing"
      ? "finished"
      : handIndex >= MAX_HANDS_PER_EVENT
        ? "hand-cap"
        : "action-cap";
  // A safety cap is right-censored data, not a completed tournament. Never
  // report the cap itself as a finish milestone.
  if (termination === "finished") accumulator.handsToFinish = handIndex;
  accumulator.timeline = {
    seed,
    handsPlayed: handIndex,
    termination,
    ...(accumulator.handsToFirstElimination === undefined
      ? {}
      : { handsToFirstElimination: accumulator.handsToFirstElimination }),
    ...(accumulator.handsToHeadsUp === undefined
      ? {}
      : { handsToHeadsUp: accumulator.handsToHeadsUp }),
    ...(accumulator.handsToFinish === undefined
      ? {}
      : { handsToFinish: accumulator.handsToFinish }),
  };
  return accumulator;
}

export interface AiBehaviorMilestoneStats {
  mean: number;
  median: number;
  samples: number;
}

function milestoneStats(values: number[]): AiBehaviorMilestoneStats {
  return { mean: mean(values), median: median(values), samples: values.length };
}

export interface AiBehaviorTimelineSummary {
  completedEvents: number;
  cappedEvents: number;
  handsToFirstElimination: AiBehaviorMilestoneStats;
  handsToHeadsUp: AiBehaviorMilestoneStats;
  handsToFinish: AiBehaviorMilestoneStats;
}

/**
 * Summarize right-censored event timelines without treating missing outcomes
 * as zero or as the safety-cap hand count. Kept pure so the censoring rule has
 * a cheap regression test independent of the full tournament simulation.
 */
export function summarizeEventTimelines(
  timelines: readonly AiBehaviorEventTimeline[],
): AiBehaviorTimelineSummary {
  const values = (key: keyof Pick<
    AiBehaviorEventTimeline,
    "handsToFirstElimination" | "handsToHeadsUp" | "handsToFinish"
  >) =>
    timelines.flatMap((timeline) =>
      timeline[key] === undefined ? [] : [timeline[key] as number],
    );
  return {
    completedEvents: timelines.filter(
      (timeline) => timeline.termination === "finished",
    ).length,
    cappedEvents: timelines.filter(
      (timeline) => timeline.termination !== "finished",
    ).length,
    handsToFirstElimination: milestoneStats(values("handsToFirstElimination")),
    handsToHeadsUp: milestoneStats(values("handsToHeadsUp")),
    handsToFinish: milestoneStats(values("handsToFinish")),
  };
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
  const timelines = events.map((event) => {
    if (!event.timeline) {
      throw new Error(`AI behavior event ${event.seed} has no outcome timeline`);
    }
    return event.timeline;
  });
  const timelineSummary = summarizeEventTimelines(timelines);
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
    completedEvents: timelineSummary.completedEvents,
    cappedEvents: timelineSummary.cappedEvents,
    eventTimelines: timelines,
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
    threeBet: ratio(
      events.reduce((sum, event) => sum + event.threeBetActions, 0),
      events.reduce((sum, event) => sum + event.threeBetOpportunities, 0),
    ),
    fourBet: ratio(
      events.reduce((sum, event) => sum + event.fourBetActions, 0),
      events.reduce((sum, event) => sum + event.fourBetOpportunities, 0),
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
    handsToFirstElimination: timelineSummary.handsToFirstElimination,
    handsToHeadsUp: timelineSummary.handsToHeadsUp,
    handsToFinish: timelineSummary.handsToFinish,
  };
}
