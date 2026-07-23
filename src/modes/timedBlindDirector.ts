export type TimedBlindPhase =
  | "opening"
  | "pressure"
  | "closing"
  | "deadline";

export interface TimedBlindLevel {
  smallBlind: number;
  bigBlind: number;
  bigBlindAnte: number;
}

export interface TimedBlindPlayer {
  id: string;
  stack: number;
  eliminated?: boolean;
}

export interface TimedBlindDirectorInput {
  durationMinutes: number;
  elapsedMs: number;
  current: TimedBlindLevel;
  players: readonly TimedBlindPlayer[];
  startingTotalChips: number;
}

export interface TimedBlindDecision extends TimedBlindLevel {
  phase: TimedBlindPhase;
  progress: number;
  livePlayers: number;
  nextReviewMs: number;
  forcedAllInStack: number | null;
  reason: string;
}

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 180;

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function friendlyStep(value: number) {
  if (value < 500) return 25;
  if (value < 2_000) return 50;
  if (value < 10_000) return 100;
  if (value < 50_000) return 500;
  return 1_000;
}

function roundUpFriendly(value: number) {
  const safe = Math.max(1, value);
  const step = friendlyStep(safe);
  return Math.ceil(safe / step) * step;
}

function phaseForProgress(progress: number): TimedBlindPhase {
  if (progress >= 1) return "deadline";
  if (progress < 0.25) return "opening";
  if (progress < 0.72) return "pressure";
  return "closing";
}

function reviewCadenceMs(durationMs: number, phase: TimedBlindPhase) {
  const normalCadence = Math.max(
    20_000,
    Math.min(90_000, Math.round(durationMs / 24)),
  );
  if (phase === "opening") return normalCadence;
  if (phase === "pressure") return Math.max(15_000, normalCadence * 0.8);
  if (phase === "closing") return Math.max(10_000, normalCadence * 0.55);
  return Math.max(5_000, normalCadence * 0.3);
}

export function directTimedBlinds(
  input: TimedBlindDirectorInput,
): TimedBlindDecision {
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < MIN_DURATION_MINUTES ||
    input.durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw new Error(
      `durationMinutes must be an integer from ${MIN_DURATION_MINUTES} to ${MAX_DURATION_MINUTES}.`,
    );
  }
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new Error("elapsedMs must be a non-negative finite number.");
  }
  assertPositiveInteger(input.current.smallBlind, "smallBlind");
  assertPositiveInteger(input.current.bigBlind, "bigBlind");
  assertPositiveInteger(input.current.bigBlindAnte, "bigBlindAnte");
  assertPositiveInteger(input.startingTotalChips, "startingTotalChips");

  const liveStacks = input.players
    .filter((player) => !player.eliminated && player.stack > 0)
    .map((player) => {
      assertPositiveInteger(player.stack, `stack for ${player.id}`);
      return player.stack;
    })
    .sort((left, right) => right - left);

  const durationMs = input.durationMinutes * 60_000;
  const progress = input.elapsedMs / durationMs;
  const phase = phaseForProgress(progress);
  const currentBigBlind = input.current.bigBlind;
  const currentSmallBlind = input.current.smallBlind;
  const nextReviewMs = reviewCadenceMs(durationMs, phase);

  if (liveStacks.length <= 1) {
    return {
      ...input.current,
      phase,
      progress,
      livePlayers: liveStacks.length,
      nextReviewMs,
      forcedAllInStack: null,
      reason: "The table is complete, so the blind level is held.",
    };
  }

  const chipsInPlay = liveStacks.reduce((sum, stack) => sum + stack, 0);
  const averageStack = chipsInPlay / liveStacks.length;
  const secondLargestStack = liveStacks[1];
  let targetBigBlind = currentBigBlind;
  let reason =
    "Opening levels are intentionally stable so the table begins like normal tournament poker.";

  if (phase === "pressure") {
    const pressureProgress = smoothstep((progress - 0.25) / 0.47);
    const desiredAverageBigBlinds = 42 - pressureProgress * 26;
    const stackTarget = averageStack / desiredAverageBigBlinds;
    const populationPressure =
      1 + Math.max(0, liveStacks.length - 3) * 0.055 * pressureProgress;
    targetBigBlind = stackTarget * populationPressure;
    reason =
      "Blinds rise gradually from public time, field size, and the average live stack.";
  } else if (phase === "closing") {
    const closingProgress = smoothstep((progress - 0.72) / 0.28);
    const desiredAverageBigBlinds = 14 - closingProgress * 10;
    const stackTarget = averageStack / desiredAverageBigBlinds;
    const deadlineTarget =
      currentBigBlind +
      (secondLargestStack - currentBigBlind) *
        Math.pow(closingProgress, 1.65);
    targetBigBlind = Math.max(stackTarget, deadlineTarget);
    reason =
      "Closing pressure accelerates toward the second-largest stack without decreasing the current level.";
  } else if (phase === "deadline") {
    targetBigBlind = secondLargestStack;
    reason =
      "The deadline safety level covers the second-largest stack, forcing every player except the chip leader all-in.";
  }

  if (phase !== "deadline") {
    const jumpCap =
      phase === "opening"
        ? currentBigBlind
        : currentBigBlind * (phase === "pressure" ? 2 : 3);
    targetBigBlind = Math.min(targetBigBlind, jumpCap);
  }

  const bigBlind = Math.max(currentBigBlind, roundUpFriendly(targetBigBlind));
  const smallBlind = Math.max(
    currentSmallBlind,
    roundUpFriendly(bigBlind / 2),
  );
  const bigBlindAnte = Math.max(input.current.bigBlindAnte, bigBlind);

  return {
    smallBlind,
    bigBlind,
    bigBlindAnte,
    phase,
    progress,
    livePlayers: liveStacks.length,
    nextReviewMs,
    forcedAllInStack: phase === "deadline" ? secondLargestStack : null,
    reason,
  };
}

