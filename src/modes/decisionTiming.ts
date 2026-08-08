import type { PokerAction, Street } from "../types/poker";

export type DecisionTimingSurface = "desktop";

export interface DecisionTimingInput {
  seed: string;
  decisionId: string;
  street: Street;
  action: PokerAction;
  /**
   * 0 is far from a policy cutoff; 1 is directly on a cutoff. This contribution
   * is deliberately capped well below the seeded noise envelope.
   */
  cutoffCloseness: number;
  /** Range/equity ambiguity from 0 to 1. Do not pass private hand strength. */
  uncertainty: number;
  /** Opponent personality tempo from -1 (quick) to 1 (deliberate). */
  tempo: number;
  /** User-facing animation/presentation speed from 0.5x to 3x. */
  presentationRate: number;
  surface?: DecisionTimingSurface;
}

export interface DecisionTiming {
  delayMs: number;
  unscaledDelayMs: number;
  surface: DecisionTimingSurface;
  presentationRate: number;
  antiTellNoiseMs: number;
  boundedDifficultyMs: number;
}

const STREET_WEIGHT: Record<Street, number> = {
  preflop: 0,
  flop: 90,
  turn: 150,
  river: 210,
};

const ACTION_WEIGHT: Record<PokerAction, number> = {
  fold: 0,
  check: 20,
  call: 85,
  raise: 190,
  "all-in": 230,
};

/**
 * Produces a reproducible presentation delay without accepting hole-card
 * strength as an input. Mathematical difficulty affects at most 300 ms while
 * seeded anti-tell noise spans more than 2 seconds, preventing a stable
 * "long tank means strong/weak" signal. Pausing is a controller responsibility:
 * never advance this delay while the app is blurred, suspended, or inactive.
 */
export function calculateAiDecisionTiming(
  input: DecisionTimingInput,
): DecisionTiming {
  if (!input.seed.trim() || !input.decisionId.trim()) {
    throw new Error("Decision timing requires non-empty seed and decision id.");
  }

  const closeness = unitInterval(input.cutoffCloseness);
  const uncertainty = unitInterval(input.uncertainty);
  const tempo = clamp(input.tempo, -1, 1);
  const presentationRate = clamp(input.presentationRate, 0.5, 3);
  const surface = input.surface ?? "desktop";
  const random = splitMix32(hashText(`${input.seed}|${input.decisionId}`));

  // This signal is intentionally small relative to the independent noise.
  const boundedDifficultyMs = Math.round(
    Math.min(300, closeness * 165 + uncertainty * 135),
  );
  const broadJitter = Math.round((random() * 0.72 + random() * 0.28) * 1_850);
  const falseTank = random() < 0.14 ? Math.round(random() * 620) : 0;
  const antiTellNoiseMs = broadJitter + falseTank;

  const desktopDelay =
    820 +
    STREET_WEIGHT[input.street] +
    ACTION_WEIGHT[input.action] +
    boundedDifficultyMs +
    Math.round(tempo * 130) +
    antiTellNoiseMs;
  const surfaceDelay = clamp(desktopDelay, 650, 4_300);
  const delayMs = Math.max(180, Math.round(surfaceDelay / presentationRate));

  return {
    delayMs,
    unscaledDelayMs: surfaceDelay,
    surface,
    presentationRate,
    antiTellNoiseMs,
    boundedDifficultyMs,
  };
}

function unitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Decision timing inputs must be finite.");
  }
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    value ^= value >>> 15;
    return (value >>> 0) / 0x1_0000_0000;
  };
}
