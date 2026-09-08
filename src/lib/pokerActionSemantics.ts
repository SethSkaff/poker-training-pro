import {
  applyBettingAction,
  getLegalActions,
  raisingReopenedFor,
  type BettingActionCommand,
  type BettingActionResult,
  type BettingPlayerState,
  type BettingRoundState,
  type LegalActionSet,
} from "../engine/betting";
import { buildLivePots, type ContestablePot, type PotRefund } from "../engine/pots";
import type { Street } from "../types/poker";

export type CanonicalActionKind = "fold" | "check" | "call" | "bet" | "raise";
export type StackOffClass = "none" | "aggressive_jam" | "all_in_call";

export interface CanonicalAction {
  key: string;
  kind: CanonicalActionKind;
  rawCommand: BettingActionCommand;
  targetChips: number;
  investedChips: number;
  raisesCurrentBet: boolean;
  raiseByChips: number;
  isActorAllIn: boolean;
  stackOffClass: StackOffClass;
  isFullRaise: boolean;
  isShortAllInIncrease: boolean;
  newlyReopenedPlayerIds: string[];
  /** The engine facts are retained for independent postcondition checks. */
  playerId: string;
  preActionLegal: LegalActionSet;
  result: BettingActionResult;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function transitionKey(state: BettingRoundState): string {
  return stableJson({
    currentBet: state.currentBet,
    lastFullRaise: state.lastFullRaise,
    lastAggressorId: state.lastAggressorId ?? null,
    pending: state.pending,
    complete: state.complete,
    handComplete: state.handComplete,
    players: [...state.players]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((player) => ({
        id: player.id,
        stack: player.stack,
        streetCommitted: player.streetCommitted,
        totalCommitted: player.totalCommitted,
        status: player.status,
      })),
    lastActedAtBet: Object.fromEntries(
      Object.entries(state.lastActedAtBet).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
}

function actionKind(
  preState: BettingRoundState,
  result: BettingActionResult,
): CanonicalActionKind {
  const { event } = result;
  if (event.type === "fold") return "fold";
  if (event.type === "check") return "check";
  if (event.to <= event.previousBet) return "call";
  return event.previousBet === 0 ? "bet" : "raise";
}

/**
 * Canonicalizes every legal command through the real betting engine. An
 * explicit all-in call and a normal call therefore receive the same transition
 * key, while a max-target raise remains an aggressive jam.
 */
export function canonicalizeBettingAction(
  preState: BettingRoundState,
  command: BettingActionCommand,
): CanonicalAction {
  const playerId = preState.pending[0];
  if (!playerId) throw new Error("Cannot canonicalize an action on a completed round");
  const legal = getLegalActions(preState, playerId);
  const result = applyBettingAction(preState, playerId, command);
  const kind = actionKind(preState, result);
  const actorBefore = preState.players.find((player) => player.id === playerId);
  if (!actorBefore) throw new Error(`Missing actor ${playerId}`);
  const investedChips = result.event.to - actorBefore.streetCommitted;
  const isActorAllIn = result.event.allIn;
  const isFullRaise = result.event.fullRaise;
  const raisesCurrentBet = result.event.to > preState.currentBet;
  const isShortAllInIncrease =
    raisesCurrentBet && isActorAllIn && !isFullRaise;
  const newlyReopenedPlayerIds = preState.players
    .filter((player) => player.id !== playerId && player.status === "active" && player.stack > 0)
    .filter((player) => !raisingReopenedFor(preState, player.id) && raisingReopenedFor(result.state, player.id))
    .map((player) => player.id)
    .sort();
  const stackOffClass: StackOffClass =
    kind === "call" && isActorAllIn
      ? "all_in_call"
      : (kind === "bet" || kind === "raise") && isActorAllIn
        ? "aggressive_jam"
        : "none";
  return {
    key: transitionKey(result.state),
    kind,
    rawCommand: { ...command },
    targetChips: result.event.to,
    investedChips,
    raisesCurrentBet,
    raiseByChips: raisesCurrentBet ? result.event.to - preState.currentBet : 0,
    isActorAllIn,
    stackOffClass,
    isFullRaise,
    isShortAllInIncrease,
    newlyReopenedPlayerIds,
    playerId,
    preActionLegal: { ...legal },
    result,
  };
}

export interface PreviousAggression {
  decisionId: string;
  potBeforeChips: number;
  investedChips: number;
  previousBetChips: number;
  targetChips: number;
  investedOverPot: MaybeNumber;
  raiseOverPotAfterCall: MaybeNumber;
}

export type MaybeNumber =
  | { value: number; reason: null }
  | { value: null; reason: string };

export interface WagerGeometryContext {
  preState: BettingRoundState;
  canonicalAction: CanonicalAction;
  street?: Street;
  bigBlindChips?: number;
  smallestChipChips?: number;
  configuredAnteChips?: number;
  anteAppliedChips?: number;
  potAtStreetStartChips?: MaybeNumber;
  previousAggression?: PreviousAggression;
  potAtDecisionChips?: number;
  potAtDecisionSource?: "commitment-ledger" | "information-set" | "declared";
}

export interface OpponentExposure {
  opponentId: string;
  status: "active" | "all-in";
  remainingStackChips: number;
  streetCommittedChips: number;
  futureMatchedChips: number;
  contestableAdditionalChips: number;
  callableAtTargetChips: number;
  facingAdditionalCost: boolean;
  canMakeDecisionAtTarget: boolean;
}

export interface WagerGeometry {
  bigBlindChips: number;
  smallestChipChips: number;
  configuredAnteChips: number;
  anteAppliedChips: number;
  potAtDecisionChips: number;
  potAtStreetStartChips: MaybeNumber;
  actorStackChips: number;
  actorStreetCommittedChips: number;
  currentBetChips: number;
  outstandingCallChips: number;
  actualCallChips: number;
  potAfterActorCallChips: number;
  targetChips: number;
  investedChips: number;
  raiseByChips: number;
  callCostOverCurrentPot: MaybeNumber;
  previousAggression: PreviousAggression | null;
  investmentOverCurrentPot: MaybeNumber;
  raiseOverPotAfterCall: MaybeNumber;
  actorCommitmentFraction: number;
  opponents: OpponentExposure[];
  minPositiveFutureMatchedChips: MaybeNumber;
  maxFutureMatchedChips: MaybeNumber;
  decisionMinSpr: MaybeNumber;
  decisionMaxSpr: MaybeNumber;
  streetStartMinSpr: MaybeNumber;
  streetStartMaxSpr: MaybeNumber;
  livePots: ContestablePot[];
  currentlyUnmatched: PotRefund[];
  actualSettlementRefundChips: MaybeNumber;
}

function known(value: number): MaybeNumber {
  return { value, reason: null };
}

function missing(reason: string): MaybeNumber {
  return { value: null, reason };
}

function ratio(numerator: number, denominator: number, reason: string): MaybeNumber {
  return denominator > 0 ? known(numerator / denominator) : missing(reason);
}

function sprValues(opponents: readonly OpponentExposure[], pot: number): {
  min: MaybeNumber;
  max: MaybeNumber;
} {
  const positive = opponents
    .map((opponent) => opponent.futureMatchedChips)
    .filter((value) => value > 0);
  if (positive.length === 0) {
    return { min: missing("no_future_responder"), max: missing("no_future_responder") };
  }
  return {
    min: ratio(Math.min(...positive), pot, "zero_pot"),
    max: ratio(Math.max(...positive), pot, "zero_pot"),
  };
}

/** Computes pre-action geometry from the immutable betting prestate. */
export function computeWagerGeometry(context: WagerGeometryContext): WagerGeometry {
  const { preState, canonicalAction: action } = context;
  const actor = preState.players.find((player) => player.id === action.playerId);
  if (!actor) throw new Error(`Missing actor ${action.playerId}`);
  const pot = context.potAtDecisionChips ?? preState.players.reduce((sum, player) => sum + player.totalCommitted, 0);
  const callAmount = action.preActionLegal.callAmount;
  const afterCall = pot + callAmount;
  const opponents: OpponentExposure[] = preState.players
    .filter((player) => player.id !== actor.id && player.status !== "folded")
    .map((player) => ({
      opponentId: player.id,
      status: player.status === "all-in" ? "all-in" : "active",
      remainingStackChips: player.stack,
      streetCommittedChips: player.streetCommitted,
      futureMatchedChips: Math.min(actor.stack, player.stack),
      contestableAdditionalChips: Math.max(
        0,
        Math.min(
          actor.stack,
          player.streetCommitted + player.stack - actor.streetCommitted,
        ),
      ),
      callableAtTargetChips: Math.min(
        player.stack,
        Math.max(0, action.targetChips - player.streetCommitted),
      ),
      facingAdditionalCost: action.targetChips > player.streetCommitted && player.stack > 0,
      canMakeDecisionAtTarget:
        player.status === "active" && player.stack > 0 && action.targetChips > player.streetCommitted,
    }));
  const spr = sprValues(opponents.filter((opponent) => opponent.canMakeDecisionAtTarget || opponent.futureMatchedChips > 0), pot);
  const streetStart = context.potAtStreetStartChips?.value !== null && context.potAtStreetStartChips?.value !== undefined
    ? sprValues(opponents, context.potAtStreetStartChips.value)
    : { min: missing("street_start_unavailable"), max: missing("street_start_unavailable") };
  const live = buildLivePots(preState.players.map((player) => ({
    playerId: player.id,
    amount: player.totalCommitted,
    folded: player.status === "folded",
    allIn: player.status === "all-in",
  })));
  const targetForRaise = action.kind === "bet" || action.kind === "raise";
  return {
    bigBlindChips: context.bigBlindChips ?? 1,
    smallestChipChips: context.smallestChipChips ?? 1,
    configuredAnteChips: context.configuredAnteChips ?? 0,
    anteAppliedChips: context.anteAppliedChips ?? 0,
    potAtDecisionChips: pot,
    potAtStreetStartChips: context.potAtStreetStartChips ?? missing("street_start_unavailable"),
    actorStackChips: actor.stack,
    actorStreetCommittedChips: actor.streetCommitted,
    currentBetChips: preState.currentBet,
    outstandingCallChips: Math.max(0, preState.currentBet - actor.streetCommitted),
    actualCallChips: callAmount,
    potAfterActorCallChips: afterCall,
    targetChips: action.targetChips,
    investedChips: action.investedChips,
    raiseByChips: action.raiseByChips,
    callCostOverCurrentPot: ratio(callAmount, pot, "zero_pot"),
    previousAggression: context.previousAggression ?? null,
    investmentOverCurrentPot: ratio(action.investedChips, pot, "zero_pot"),
    raiseOverPotAfterCall:
      targetForRaise && action.isFullRaise
        ? ratio(action.raiseByChips, afterCall, "zero_pot_after_call")
        : missing(action.isShortAllInIncrease ? "short_all_in_increase" : "not_full_raise"),
    actorCommitmentFraction: actor.stack > 0 ? action.investedChips / actor.stack : 1,
    opponents,
    minPositiveFutureMatchedChips: spr.min.value === null
      ? missing(spr.min.reason ?? "no_future_responder")
      : known(Math.min(...opponents.filter((opponent) => opponent.futureMatchedChips > 0).map((opponent) => opponent.futureMatchedChips))),
    maxFutureMatchedChips: opponents.length === 0
      ? missing("no_contestant")
      : known(Math.max(...opponents.map((opponent) => opponent.futureMatchedChips))),
    decisionMinSpr: spr.min,
    decisionMaxSpr: spr.max,
    streetStartMinSpr: streetStart.min,
    streetStartMaxSpr: streetStart.max,
    livePots: live.pots,
    currentlyUnmatched: live.refunds,
    actualSettlementRefundChips: missing("settlement_not_completed"),
  };
}

export function isCanonicalAggressive(action: CanonicalAction): boolean {
  return action.kind === "bet" || action.kind === "raise";
}
