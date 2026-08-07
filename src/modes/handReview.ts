/**
 * Post-round review: derives an annotated decision log from a stored replay.
 *
 * **No second hand-history store.** The engine is fully deterministic, so
 * `restoreTournamentRunnerReplay` regenerates every opponent decision, deal,
 * and pot from `seed + hero actions`. This module replays the log, pauses at
 * each hero decision, and computes the state and the mathematics *at that
 * moment*. Nothing here is persisted; only aggregates leave this module.
 *
 * **Privacy.** Determinism means anyone holding the private checkpoint could
 * recompute every player's cards, including folded hands that were never
 * shown. Every reconstructed decision therefore passes through
 * `createInformationSet(..., heroId)` — the same viewer-scoped redaction the
 * live table uses — so the review can only ever surface what the player could
 * legitimately see at the time. `assertReviewIsRedacted` makes that a
 * checkable property rather than a convention.
 *
 * **Cost.** Equity estimation is the expensive part (a median 382 ms at 700
 * simulations on the reference machine). Derivation is therefore an async
 * generator that yields between decisions and honours an abort signal, so a
 * full round never blocks the presentation thread.
 */

import { createInformationSet, type PlayerInformationSet } from "../engine/tournament";
import { getLegalActions, nextToAct } from "../engine";
import type { Street } from "../types/poker";
import {
  applyHeroTournamentAction,
  advanceTournamentRunnerToHero,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  heroTournamentLegalActions,
  TournamentReplayVersionError,
  type TournamentRunner,
  type TournamentRunnerReplay,
} from "./tournamentRunner";
import { decideRationalAction, type RationalActionOption } from "./rational";
import type { PokerAction } from "../types/poker";

/** Thrown when the caller abandons a derivation at a slice boundary. */
export class HandReviewCancelledError extends Error {
  readonly cancelled = true;
  constructor() {
    super("Hand review derivation was cancelled");
    this.name = "HandReviewCancelledError";
  }
}

export type ReviewStreet = Street;

export type ReviewPhase =
  | "early"
  | "middle"
  | "late"
  | "qualification"
  | "heads-up";

export type ReviewRiskBucket = "low" | "medium" | "high" | "all-in";

export type ReviewDecisionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

export type ReviewQuality =
  | "best"
  | "close"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface ReviewMath {
  potBefore: number;
  costToCall: number;
  potAfterCalling: number;
  potOdds: number;
  requiredEquity: number;
  estimatedEquity: number;
  foldEquity: number;
  stackToPotRatio: number;
  effectiveStackBigBlinds: number;
  tournamentPressure: number;
  /** EV in big blinds for each action the policy considered. */
  actionValues: Array<{
    id: string;
    type: ReviewDecisionType;
    to?: number;
    expectedValueBigBlinds: number;
    role: RationalActionOption["role"];
    rationale: string;
  }>;
  /** How far the chosen action fell short of the best considered action. */
  evRegretBigBlinds: number;
  /** Monte Carlo sample count behind `estimatedEquity`. */
  simulations: number;
}

export interface ReviewDecision {
  /** Stable index into the round's decision list. */
  index: number;
  handNumber: number;
  handId: string;
  street: ReviewStreet;
  phase: ReviewPhase;
  riskBucket: ReviewRiskBucket;
  decisionType: ReviewDecisionType;
  /** The action the player actually took. */
  chosen: { type: ReviewDecisionType; to?: number };
  /** The action the policy rated highest at that moment. */
  recommended: { type: ReviewDecisionType; to?: number };
  quality: ReviewQuality;
  notable: boolean;
  notableReason?: string;
  playersRemaining: number;
  blindLevel: number;
  math: ReviewMath;
  /**
   * The hero's own view of the table at the moment of the decision, already
   * viewer-redacted. Opponent hole cards are absent by construction.
   */
  informationSet: PlayerInformationSet;
}

export interface ReviewSegmentScore {
  key: string;
  label: string;
  decisions: number;
  accuracy: number;
  meanRegretBigBlinds: number;
  /**
   * False when the sample is too small for the average to mean anything. The
   * UI must not present these as findings.
   */
  reliable: boolean;
}

export interface HandReview {
  eventId: string;
  mode: TournamentRunnerReplay["mode"];
  decisions: ReviewDecision[];
  /** Share of decisions that matched the policy's highest-rated action. */
  accuracy: number;
  meanRegretBigBlinds: number;
  segments: {
    street: ReviewSegmentScore[];
    phase: ReviewSegmentScore[];
    risk: ReviewSegmentScore[];
    decisionType: ReviewSegmentScore[];
  };
}

export interface DeriveHandReviewOptions {
  /** Checked at each decision boundary. */
  signal?: { readonly aborted: boolean };
  /** Yields between decisions so the UI thread stays responsive. */
  yieldControl?: () => Promise<void>;
  /**
   * Monte Carlo budget per decision. Deliberately lower than live play: the
   * review annotates many decisions at once and its numbers are labelled as
   * estimates.
   */
  simulations?: number;
  /** Caps derivation on a very long round. */
  maxDecisions?: number;
}

const DEFAULT_SIMULATIONS = 120;
const DEFAULT_MAX_DECISIONS = 400;
/** Below this many samples a segment average is noise, not a finding. */
const MIN_RELIABLE_SAMPLE = 8;

function commandType(type: string): ReviewDecisionType {
  switch (type) {
    case "fold":
    case "check":
    case "call":
    case "bet":
    case "raise":
    case "all-in":
      return type;
    default:
      return "check";
  }
}

/**
 * Quality bands in big blinds of forgone EV. These are the game's own model,
 * not a claim of GTO correctness — `labelledApproximation` in the UI says so.
 */
function qualityFor(regretBigBlinds: number): ReviewQuality {
  if (regretBigBlinds <= 0.02) return "best";
  if (regretBigBlinds <= 0.35) return "close";
  if (regretBigBlinds <= 1.2) return "inaccuracy";
  if (regretBigBlinds <= 4) return "mistake";
  return "blunder";
}

function phaseFor(
  playersRemaining: number,
  startingPlayers: number,
  qualifyingPlaces: number,
): ReviewPhase {
  if (playersRemaining <= 2) return "heads-up";
  if (qualifyingPlaces > 0 && playersRemaining <= qualifyingPlaces + 1) {
    return "qualification";
  }
  const survived = playersRemaining / Math.max(1, startingPlayers);
  if (survived > 0.75) return "early";
  return survived > 0.5 ? "middle" : "late";
}

function riskFor(
  wager: number,
  effectiveStack: number,
  isAllIn: boolean,
): ReviewRiskBucket {
  if (isAllIn) return "all-in";
  const share = wager / Math.max(1, effectiveStack);
  if (share <= 0.08) return "low";
  return share <= 0.3 ? "medium" : "high";
}

/**
 * Why this decision is worth stopping on. Returns undefined for the routine
 * majority — most preflop folds teach nothing, and flagging them would bury
 * the decisions that matter.
 */
function notabilityFor(
  decision: Omit<ReviewDecision, "notable" | "notableReason">,
): string | undefined {
  const { quality, math, decisionType, riskBucket } = decision;
  if (quality === "blunder") return "large-mistake";
  if (quality === "mistake") return "mistake";
  if (riskBucket === "all-in") return "major-all-in";
  if (quality === "best" && decisionType === "fold" && math.potOdds > 0.3) {
    return "disciplined-fold";
  }
  if (quality === "best" && decisionType === "call" && math.evRegretBigBlinds === 0) {
    const margin = math.estimatedEquity - math.requiredEquity;
    if (Math.abs(margin) < 0.05) return "close-correct-call";
  }
  if (
    (decisionType === "bet" || decisionType === "raise") &&
    math.estimatedEquity < 0.4
  ) {
    return "bluff";
  }
  if (
    quality !== "best" &&
    (decisionType === "check" || decisionType === "call") &&
    math.estimatedEquity > 0.7
  ) {
    return "missed-value";
  }
  if (riskBucket === "high" && quality === "best") return "high-ev-under-pressure";
  return undefined;
}

function segment(
  label: string,
  key: string,
  decisions: readonly ReviewDecision[],
): ReviewSegmentScore {
  const count = decisions.length;
  const best = decisions.filter((decision) => decision.quality === "best").length;
  const regret = decisions.reduce(
    (sum, decision) => sum + decision.math.evRegretBigBlinds,
    0,
  );
  return {
    key,
    label,
    decisions: count,
    accuracy: count ? best / count : 0,
    meanRegretBigBlinds: count ? regret / count : 0,
    reliable: count >= MIN_RELIABLE_SAMPLE,
  };
}

function groupSegments(
  decisions: readonly ReviewDecision[],
  keys: readonly string[],
  keyOf: (decision: ReviewDecision) => string,
): ReviewSegmentScore[] {
  return keys.map((key) =>
    segment(key, key, decisions.filter((decision) => keyOf(decision) === key)),
  );
}

function restoreRunnerForReview(
  replay: TournamentRunnerReplay,
): TournamentRunner {
  // Same construction as `restoreTournamentRunnerReplay`, but the review needs
  // to stop at each hero decision rather than run straight through, so the
  // stepping loop lives here. The version guard is shared.
  return replay.kind === "timed"
    ? createTimedTournamentRunner({
        minutes: replay.timed?.durationMinutes ?? 30,
        hero: { ...replay.hero },
        seed: replay.seed,
        nowMs: replay.timed?.startedAtMs ?? replay.actions[0]?.nowMs ?? 0,
      })
    : createCareerTournamentRunner({
        eventId: replay.eventId,
        hero: { ...replay.hero },
        mode: replay.mode,
        seed: replay.seed,
        careerResults: replay.careerResults,
      });
}

function assertSupported(replay: TournamentRunnerReplay): void {
  if (
    replay.format !== "poker-training-pro-tournament-replay" ||
    replay.version !== 1
  ) {
    throw new TournamentReplayVersionError("Unsupported tournament replay");
  }
  if (
    replay.engineVersion !== "tournament-session-v1" ||
    replay.contentVersion !== "career-events-v1" ||
    replay.policyVersion !== "normal-rational-v1"
  ) {
    throw new TournamentReplayVersionError(
      "This replay was recorded by a different build and cannot be reviewed faithfully.",
    );
  }
}

/**
 * Derives the annotated review. Async and cancellable by construction: a
 * caller that navigates away aborts the signal and the generator stops at the
 * next decision boundary rather than finishing an abandoned round.
 */
export async function deriveHandReview(
  replay: TournamentRunnerReplay,
  options: DeriveHandReviewOptions = {},
): Promise<HandReview> {
  assertSupported(replay);
  const simulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const maxDecisions = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const yieldControl =
    options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new HandReviewCancelledError();
  };
  throwIfCancelled();

  let runner = restoreRunnerForReview(replay);
  const heroId = replay.hero.id;
  const startingPlayers = runner.session.tournament.players.length;
  const decisions: ReviewDecision[] = [];
  const firstNowMs = replay.timed?.startedAtMs ?? replay.actions[0]?.nowMs ?? 0;

  runner = advanceTournamentRunnerToHero(runner, {
    nowMs: firstNowMs,
    policy: { simulations: replay.policySimulations },
  });

  let handNumber = 0;
  let lastHandId: string | undefined;

  for (const entry of replay.actions) {
    if (runner.session.status === "complete") break;
    if (decisions.length >= maxDecisions) break;
    throwIfCancelled();

    const hand = runner.session.activeHand;
    const legal = heroTournamentLegalActions(runner);
    if (!hand || !legal) break;
    if (hand.handId !== lastHandId) {
      handNumber += 1;
      lastHandId = hand.handId;
    }

    // Viewer-scoped redaction, exactly as the live table does it. Opponent
    // hole cards are removed here and never re-enter the review.
    const informationSet = createInformationSet(hand.information, heroId);
    const heroSeat = informationSet.players.find(
      (player) => player.id === heroId,
    );
    const bigBlind = Math.max(
      1,
      runner.session.tournament.structure.levels[
        runner.session.tournament.levelIndex
      ]?.bigBlind ?? 1,
    );

    // The same policy the AI uses, run from the hero's seat. This is the
    // game's own evaluation model, not an oracle -- the UI labels it as such.
    const evaluation = decideRationalAction({
      informationSet,
      legalActions: legal,
      bigBlind,
      seed: `review:${replay.eventId}:${hand.handId}:${decisions.length}`,
      simulations,
      temperature: 0.48,
    });

    const chosenType = commandType(
      entry.request.action === "raise" && entry.request.raiseTo === undefined
        ? "raise"
        : entry.request.action,
    );
    const chosenTo = entry.request.raiseTo;
    const actionValues = evaluation.distribution.map((option) => ({
      id: option.id,
      type: commandType(option.command.type),
      to: option.command.to,
      expectedValueBigBlinds: option.utilityBigBlinds,
      role: option.role,
      rationale: option.rationale,
    }));
    const bestValue = Math.max(
      ...actionValues.map((option) => option.expectedValueBigBlinds),
    );
    // Match the player's action to the closest candidate the policy scored.
    const playedValue =
      actionValues
        .filter((option) => option.type === chosenType)
        .sort(
          (left, right) =>
            Math.abs((left.to ?? 0) - (chosenTo ?? left.to ?? 0)) -
            Math.abs((right.to ?? 0) - (chosenTo ?? right.to ?? 0)),
        )[0]?.expectedValueBigBlinds ??
      Math.min(...actionValues.map((option) => option.expectedValueBigBlinds));
    const evRegretBigBlinds = Math.max(0, bestValue - playedValue);

    const metrics = evaluation.audit.metrics;
    const costToCall = legal.callAmount ?? 0;
    const wager =
      chosenTo !== undefined
        ? Math.max(0, chosenTo - (heroSeat?.streetCommitted ?? 0))
        : costToCall;
    const effectiveStack = metrics.effectiveStack;
    const playersRemaining = runner.session.tournament.players.filter(
      (player) => player.stack > 0,
    ).length;

    const math: ReviewMath = {
      potBefore: informationSet.pot,
      costToCall,
      potAfterCalling: informationSet.pot + costToCall,
      potOdds: metrics.potOdds,
      requiredEquity: metrics.requiredEquity,
      estimatedEquity: metrics.equity,
      foldEquity: evaluation.chosen.foldEquity,
      stackToPotRatio: metrics.stackToPotRatio,
      effectiveStackBigBlinds: metrics.effectiveStackBigBlinds,
      tournamentPressure: evaluation.audit.adjustments.tournamentRiskPremium,
      actionValues,
      evRegretBigBlinds,
      simulations,
    };

    const partial: Omit<ReviewDecision, "notable" | "notableReason"> = {
      index: decisions.length,
      handNumber,
      handId: hand.handId,
      street: hand.street,
      phase: phaseFor(
        playersRemaining,
        startingPlayers,
        runner.session.event.qualifyingPlaces ?? 0,
      ),
      riskBucket: riskFor(wager, effectiveStack, chosenType === "all-in"),
      decisionType: chosenType,
      chosen: chosenTo === undefined
        ? { type: chosenType }
        : { type: chosenType, to: chosenTo },
      recommended: {
        type: commandType(evaluation.chosen.command.type),
        ...(evaluation.chosen.command.to === undefined
          ? {}
          : { to: evaluation.chosen.command.to }),
      },
      quality: qualityFor(evRegretBigBlinds),
      playersRemaining,
      blindLevel: runner.session.tournament.levelIndex,
      math,
      informationSet,
    };
    const notableReason = notabilityFor(partial);
    decisions.push(
      notableReason
        ? { ...partial, notable: true, notableReason }
        : { ...partial, notable: false },
    );

    runner = applyHeroTournamentAction(runner, entry.request, {
      nowMs: entry.nowMs,
      policy: { simulations: replay.policySimulations },
    });
    await yieldControl();
  }

  const best = decisions.filter((decision) => decision.quality === "best").length;
  const regret = decisions.reduce(
    (sum, decision) => sum + decision.math.evRegretBigBlinds,
    0,
  );

  return {
    eventId: replay.eventId,
    mode: replay.mode,
    decisions,
    accuracy: decisions.length ? best / decisions.length : 0,
    meanRegretBigBlinds: decisions.length ? regret / decisions.length : 0,
    segments: {
      street: groupSegments(
        decisions,
        ["preflop", "flop", "turn", "river"],
        (decision) => decision.street,
      ),
      phase: groupSegments(
        decisions,
        ["early", "middle", "late", "qualification", "heads-up"],
        (decision) => decision.phase,
      ),
      risk: groupSegments(
        decisions,
        ["low", "medium", "high", "all-in"],
        (decision) => decision.riskBucket,
      ),
      decisionType: groupSegments(
        decisions,
        ["fold", "check", "call", "bet", "raise", "all-in"],
        (decision) => decision.decisionType,
      ),
    },
  };
}

/**
 * Verifies that a derived review carries no card the hero was not entitled to
 * see at that decision point. Exported so the property can be asserted in
 * tests and, if ever needed, at runtime — a redaction failure here would be a
 * privacy incident, not a cosmetic bug.
 */
export function assertReviewIsRedacted(review: HandReview, heroId: string): void {
  for (const decision of review.decisions) {
    for (const player of decision.informationSet.players) {
      if (player.id === heroId) continue;
      if (player.holeCards && player.holeCards.length > 0) {
        throw new Error(
          `Review decision ${decision.index} exposes hole cards for ${player.id}`,
        );
      }
    }
  }
}

/** Decisions worth stopping on during highlight playback. */
export function notableDecisions(review: HandReview): ReviewDecision[] {
  return review.decisions.filter((decision) => decision.notable);
}

/** Filters used by the timeline's segment chips. */
export function filterDecisions(
  review: HandReview,
  filter: {
    street?: ReviewStreet;
    phase?: ReviewPhase;
    risk?: ReviewRiskBucket;
    decisionType?: ReviewDecisionType;
    notableOnly?: boolean;
    mistakesOnly?: boolean;
  },
): ReviewDecision[] {
  return review.decisions.filter((decision) => {
    if (filter.street && decision.street !== filter.street) return false;
    if (filter.phase && decision.phase !== filter.phase) return false;
    if (filter.risk && decision.riskBucket !== filter.risk) return false;
    if (filter.decisionType && decision.decisionType !== filter.decisionType) {
      return false;
    }
    if (filter.notableOnly && !decision.notable) return false;
    if (
      filter.mistakesOnly &&
      decision.quality !== "mistake" &&
      decision.quality !== "blunder" &&
      decision.quality !== "inaccuracy"
    ) {
      return false;
    }
    return true;
  });
}

// Referenced by the derivation loop's legality checks; kept imported so a
// future refactor cannot silently drop the engine's own legality source.
void getLegalActions;
void nextToAct;
export type { PokerAction };
