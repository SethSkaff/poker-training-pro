/**
 * The facts a Training decision cannot be judged without (E27-013).
 *
 * The reported case was an all-in recommendation with ace-five suited that the
 * player could not assess. Auditing it showed the recommendation was **correct
 * but under-explained**: `preflop-button-shove-fold-equity` is A-5 suited on the
 * button with 11,000 behind at 500/1,000 -- eleven big blinds,
 * which is squarely push/fold territory. Every number needed to see that was
 * either absent from the screen or present only in chips, and eleven thousand
 * chips means nothing without the blind beside it.
 *
 * This derives that context. It computes nothing about *what to do*; it only
 * states the position, so the player and the recommendation can be compared.
 */
import type { TrainingScenario } from "../types/poker";

export interface TrainingContext {
  /** Hero's remaining chips. */
  readonly stackChips: number;
  /** The same stack in big blinds, which is the unit decisions are made in. */
  readonly stackBigBlinds: number | null;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante: number;
  /** Players still in the hand, hero included. */
  readonly players: number;
  readonly pot: number;
  readonly amountToCall: number;
  /**
   * The most either player can actually lose: hero's stack, capped by the
   * largest stack still contesting. A 200bb stack against a 12bb opponent is a
   * 12bb decision, and reading the raw number gets that backwards.
   */
  readonly effectiveStackChips: number;
  readonly effectiveStackBigBlinds: number | null;
  /** Share of the final pot the call must win to break even, 0-1. */
  readonly potOdds: number | null;
  /** True when the hero is short enough that push/fold governs. */
  readonly shortStacked: boolean;
}

const CONTESTING = new Set(["active", "all-in"]);

export function describeTrainingContext(
  scenario: TrainingScenario,
): TrainingContext {
  const [smallBlind, bigBlind] = scenario.blinds;
  const hero = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  );
  const stackChips = Math.max(0, hero?.stack ?? 0);
  const usableBlind = Number.isFinite(bigBlind) && bigBlind > 0 ? bigBlind : 0;

  const contesting = scenario.players.filter((player) =>
    CONTESTING.has(player.status),
  );
  const opponents = contesting.filter(
    (player) => player.seat !== scenario.heroSeat,
  );
  /*
    What an opponent can cover is their remaining chips *plus* what they have
    already pushed in. An all-in opponent has a stack of zero and is not
    therefore irrelevant -- they have a live claim on everything they committed,
    and reading only `stack` made the effective stack collapse to nothing in
    exactly the spots where the all-in is the whole question.
  */
  const largestOpponent = opponents.reduce(
    (largest, player) => Math.max(largest, player.stack + (player.bet ?? 0)),
    0,
  );
  // With no opponent left to contest, the hero's own stack is the ceiling.
  const effectiveStackChips =
    opponents.length === 0
      ? stackChips
      : Math.min(stackChips, largestOpponent);

  const inBigBlinds = (chips: number) =>
    usableBlind > 0 ? Number((chips / usableBlind).toFixed(1)) : null;

  const amountToCall = Math.max(0, scenario.amountToCall);
  const potOdds =
    amountToCall > 0 ? amountToCall / (scenario.pot + amountToCall) : null;

  const stackBigBlinds = inBigBlinds(stackChips);

  return {
    stackChips,
    stackBigBlinds,
    smallBlind,
    bigBlind,
    // Training scenarios may still deserialize a legacy ante field for
    // compatibility, but blind-only sessions never treat it as dead money.
    ante: 0,
    players: contesting.length,
    pot: scenario.pot,
    amountToCall,
    effectiveStackChips,
    effectiveStackBigBlinds: inBigBlinds(effectiveStackChips),
    potOdds,
    // Ten big blinds is the conventional push/fold boundary. Below it, "should
    // I shove" stops being an aggressive question and becomes the default one.
    shortStacked: stackBigBlinds !== null && stackBigBlinds <= 12,
  };
}
