/**
 * Renderer-neutral board-street choreography.
 *
 * A single public board-card event may contain two physical jobs: burn one
 * card into the discard pile, then take, turn, and place the public card. The
 * module deliberately has no three.js dependency so timing, ownership, and
 * contact remain testable without a WebGL context.
 */
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";

export type BoardStreetPoint3 = readonly [number, number, number];
export type BoardStreetQuaternion = readonly [number, number, number, number];
export type BoardStreetName = "flop" | "turn" | "river";

export const BOARD_STREET_STANDARD_DURATION_MS = 1_050;
export const BOARD_STREET_ALL_IN_DURATION_MS = 1_500;
export const COMMUNITY_CARD_SPACING_METRES = 0.105 * 1.5;
/** Authored 123 mm card length at the board's renderer scale of 1.5. */
export const BOARD_STREET_RENDERED_CARD_LENGTH = 0.123 * 1.5;
export const BOARD_STREET_CARD_CONTACT_CLEARANCE = 0.006;
export const BOARD_STREET_FINAL_CLEARANCE = 0.009;
/** Centre lift needed for a centre-pivoted card at 90 degrees not to cut the felt. */
export const BOARD_STREET_FLIP_CLEARANCE = BOARD_STREET_RENDERED_CARD_LENGTH / 2;
export const BOARD_STREET_MAX_CARD_CLEARANCE =
  BOARD_STREET_FINAL_CLEARANCE + BOARD_STREET_FLIP_CLEARANCE;
export const BOARD_STREET_RIGHT_PALM_CLEARANCE = 0.028;

export type BoardStreetPhase =
  | "burn-reach"
  | "burn-carry"
  | "burn-place"
  | "burn-release"
  | "board-take"
  | "board-carry"
  | "board-flip"
  | "board-place"
  | "board-release"
  | "recover"
  | "settled";

export type BoardStreetCardOwnership =
  | "not-required"
  | "deck"
  | "dealer-right-hand"
  | "discard-pile"
  | "community-board";

export type BoardStreetCardSupport =
  | "none"
  | "deck"
  | "felt"
  | "dealer-right-hand"
  | "discard-pile"
  | "community-board";

export interface BoardStreetCardContact {
  readonly support: BoardStreetCardSupport;
  readonly felt: boolean;
  readonly dealerRightHand: boolean;
}

export interface BoardStreetCardFrame {
  readonly kind: "burn" | "board";
  readonly required: boolean;
  readonly visible: boolean;
  readonly position: BoardStreetPoint3;
  /** Rotation around the card's X axis: PI face-down, zero face-up. */
  readonly rotationX: number;
  /** Quaternion in three.js [x, y, z, w] order. */
  readonly quaternion: BoardStreetQuaternion;
  readonly faceUpFraction: number;
  readonly faceUp: boolean;
  readonly ownership: BoardStreetCardOwnership;
  readonly contact: BoardStreetCardContact;
  readonly moving: boolean;
  readonly arrived: boolean;
  readonly released: boolean;
  readonly feltClearance: number;
}

export interface BoardStreetRightHandFrame {
  readonly actor: "dealer";
  readonly hand: "right";
  readonly position: BoardStreetPoint3;
  readonly target: BoardStreetPoint3;
  readonly palmNormal: readonly [0, -1, 0];
  readonly active: boolean;
  readonly holdingCard: "burn" | "board" | null;
  readonly contactCard: "burn" | "board" | null;
}

export interface BoardStreetChoreographyFrame {
  readonly requestedCardIndex: number;
  readonly cardIndex: number;
  readonly street: BoardStreetName;
  readonly burnRequired: boolean;
  readonly progress: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly phase: BoardStreetPhase;
  readonly phaseProgress: number;
  readonly complete: boolean;
  readonly target: BoardStreetPoint3;
  readonly deck: {
    readonly position: BoardStreetPoint3;
    readonly owner: "dealer-left-hand";
  };
  readonly leftHand: {
    readonly target: BoardStreetPoint3;
    readonly holdingDeck: true;
  };
  readonly rightHand: BoardStreetRightHandFrame;
  readonly burnCard: BoardStreetCardFrame;
  readonly boardCard: BoardStreetCardFrame;
}

interface PhaseWindow {
  readonly phase: Exclude<BoardStreetPhase, "settled">;
  readonly start: number;
  readonly end: number;
}

const WITH_BURN_WINDOWS: readonly PhaseWindow[] = Object.freeze([
  { phase: "burn-reach", start: 0, end: 0.09 },
  { phase: "burn-carry", start: 0.09, end: 0.26 },
  { phase: "burn-place", start: 0.26, end: 0.29 },
  { phase: "burn-release", start: 0.29, end: 0.33 },
  { phase: "board-take", start: 0.33, end: 0.42 },
  { phase: "board-carry", start: 0.42, end: 0.64 },
  { phase: "board-flip", start: 0.64, end: 0.86 },
  { phase: "board-place", start: 0.86, end: 0.90 },
  { phase: "board-release", start: 0.90, end: 0.94 },
  { phase: "recover", start: 0.94, end: 1 },
]);

const WITHOUT_BURN_WINDOWS: readonly PhaseWindow[] = Object.freeze([
  { phase: "board-take", start: 0, end: 0.12 },
  { phase: "board-carry", start: 0.12, end: 0.48 },
  { phase: "board-flip", start: 0.48, end: 0.78 },
  { phase: "board-place", start: 0.78, end: 0.84 },
  { phase: "board-release", start: 0.84, end: 0.90 },
  { phase: "recover", start: 0.90, end: 1 },
]);

const CARD_INDICES = [0, 1, 2, 3, 4] as const;
const BURN_CARD_INDICES: ReadonlySet<number> = new Set([0, 3, 4]);
const CARD_PICKUP: BoardStreetPoint3 = [
  TABLE_ANCHORS.dealerShoe[0],
  TABLE_HEIGHT + BOARD_STREET_CARD_CONTACT_CLEARANCE,
  TABLE_ANCHORS.dealerShoe[2],
];
const DISCARD_TARGET: BoardStreetPoint3 = [
  TABLE_ANCHORS.muck[0],
  TABLE_ANCHORS.muck[1],
  TABLE_ANCHORS.muck[2],
];
const RIGHT_HAND_REST: BoardStreetPoint3 = [
  0.15,
  TABLE_HEIGHT + 0.065,
  TABLE_ANCHORS.dealerShoe[2] - 0.025,
];

/** One burn begins each street: flop card zero, turn card three, river card four. */
export function boardStreetRequiresBurn(cardIndex: number): boolean {
  return BURN_CARD_INDICES.has(clampCardIndex(cardIndex));
}

export function boardStreetForCardIndex(cardIndex: number): BoardStreetName {
  const index = clampCardIndex(cardIndex);
  return index <= 2 ? "flop" : index === 3 ? "turn" : "river";
}

/** Fixed house-dealer perspective: +X is dealer-left and card zero starts there. */
export function communityCardTarget(cardIndex: number): BoardStreetPoint3 {
  const index = clampCardIndex(cardIndex);
  return [
    TABLE_ANCHORS.board[0] + (2 - index) * COMMUNITY_CARD_SPACING_METRES,
    TABLE_HEIGHT + BOARD_STREET_FINAL_CLEARANCE,
    TABLE_ANCHORS.board[2],
  ];
}

export function boardStreetPhaseSequence(
  cardIndex: number,
): readonly BoardStreetPhase[] {
  return [
    ...(boardStreetRequiresBurn(cardIndex) ? WITH_BURN_WINDOWS : WITHOUT_BURN_WINDOWS)
      .map((window) => window.phase),
    "settled",
  ];
}

/** Convenience bridge for the scene's existing normalized transition clock. */
export function boardStreetChoreographyAtProgress(
  cardIndex: number,
  progress: number,
): BoardStreetChoreographyFrame {
  return frameAt(cardIndex, clampUnit(progress), BOARD_STREET_STANDARD_DURATION_MS);
}

/** Millisecond sampler for deterministic capture and all-in runout pacing. */
export function boardStreetChoreographyFrame(
  cardIndex: number,
  elapsedMs: number,
  durationMs = BOARD_STREET_STANDARD_DURATION_MS,
): BoardStreetChoreographyFrame {
  const duration = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : BOARD_STREET_STANDARD_DURATION_MS;
  const elapsed = clampElapsed(elapsedMs, duration);
  return frameAt(cardIndex, elapsed / duration, duration);
}

function frameAt(
  requestedCardIndex: number,
  progress: number,
  durationMs: number,
): BoardStreetChoreographyFrame {
  const cardIndex = clampCardIndex(requestedCardIndex);
  const burnRequired = boardStreetRequiresBurn(cardIndex);
  const windows = burnRequired ? WITH_BURN_WINDOWS : WITHOUT_BURN_WINDOWS;
  const window = progress >= 1
    ? undefined
    : windows.find((candidate) => progress >= candidate.start && progress < candidate.end)
      ?? windows[0];
  const phase: BoardStreetPhase = window?.phase ?? "settled";
  const phaseProgress = window
    ? clampUnit((progress - window.start) / (window.end - window.start))
    : 1;
  const target = communityCardTarget(cardIndex);
  const burnCard = burnCardFrame(burnRequired, phase, phaseProgress);
  const boardCard = publicCardFrame(target, burnRequired, phase, phaseProgress, progress);
  const rightHand = rightHandFrame(
    phase,
    phaseProgress,
    burnRequired,
    burnCard,
    boardCard,
    target,
  );

  return {
    requestedCardIndex,
    cardIndex,
    street: boardStreetForCardIndex(cardIndex),
    burnRequired,
    progress,
    elapsedMs: progress * durationMs,
    durationMs,
    phase,
    phaseProgress,
    complete: phase === "settled",
    target,
    deck: { position: CARD_PICKUP, owner: "dealer-left-hand" },
    leftHand: { target: CARD_PICKUP, holdingDeck: true },
    rightHand,
    burnCard,
    boardCard,
  };
}

function burnCardFrame(
  required: boolean,
  phase: BoardStreetPhase,
  phaseProgress: number,
): BoardStreetCardFrame {
  if (!required) return absentBurnCard();

  const carrying = phase === "burn-carry" || phase === "burn-place";
  const released = phaseAfterBurnRelease(phase);
  const position = phase === "burn-carry"
    ? lerp(CARD_PICKUP, DISCARD_TARGET, smooth(phaseProgress))
    : phase === "burn-reach"
      ? CARD_PICKUP
      : DISCARD_TARGET;
  const ownership: BoardStreetCardOwnership = phase === "burn-reach"
    ? "deck"
    : released
      ? "discard-pile"
      : "dealer-right-hand";
  const contact: BoardStreetCardContact = ownership === "deck"
    ? { support: "deck", felt: false, dealerRightHand: false }
    : ownership === "discard-pile"
      ? { support: "discard-pile", felt: true, dealerRightHand: false }
      : { support: "felt", felt: true, dealerRightHand: true };

  return cardFrame({
    kind: "burn",
    required: true,
    visible: phase !== "burn-reach",
    position,
    rotationX: Math.PI,
    faceUpFraction: 0,
    ownership,
    contact,
    moving: phase === "burn-carry",
    arrived: phase !== "burn-reach" && phase !== "burn-carry",
    released,
  });
}

function publicCardFrame(
  target: BoardStreetPoint3,
  burnRequired: boolean,
  phase: BoardStreetPhase,
  phaseProgress: number,
  progress: number,
): BoardStreetCardFrame {
  const windows = burnRequired ? WITH_BURN_WINDOWS : WITHOUT_BURN_WINDOWS;
  const take = windows.find((window) => window.phase === "board-take")!;
  const flip = windows.find((window) => window.phase === "board-flip")!;
  const transportProgress = smooth(clampUnit((progress - take.end) / (flip.end - take.end)));
  const flipProgress = phase === "board-flip"
    ? smooth(phaseProgress)
    : phaseComesAfter(phase, "board-flip", windows)
      ? 1
      : 0;
  const base = lerp(CARD_PICKUP, target, transportProgress);
  const flipLift = Math.sin(Math.PI * flipProgress) * BOARD_STREET_FLIP_CLEARANCE;
  const position: BoardStreetPoint3 = [base[0], base[1] + flipLift, base[2]];
  const rotationX = Math.PI * (1 - flipProgress);
  const held = phase === "board-carry" || phase === "board-flip" || phase === "board-place";
  const released = phase === "board-release" || phase === "recover" || phase === "settled";
  const ownership: BoardStreetCardOwnership = held
    ? "dealer-right-hand"
    : released
      ? "community-board"
      : "deck";
  const contact: BoardStreetCardContact = ownership === "deck"
    ? { support: "deck", felt: false, dealerRightHand: false }
    : ownership === "community-board"
      ? { support: "community-board", felt: true, dealerRightHand: false }
      : phase === "board-flip"
        ? { support: "dealer-right-hand", felt: false, dealerRightHand: true }
        : { support: "felt", felt: true, dealerRightHand: true };

  return cardFrame({
    kind: "board",
    required: true,
    visible: held || released,
    position,
    rotationX,
    faceUpFraction: flipProgress,
    ownership,
    contact,
    moving: phase === "board-carry" || phase === "board-flip",
    arrived: phase === "board-place" || released,
    released,
  });
}

function rightHandFrame(
  phase: BoardStreetPhase,
  phaseProgress: number,
  burnRequired: boolean,
  burnCard: BoardStreetCardFrame,
  boardCard: BoardStreetCardFrame,
  boardTarget: BoardStreetPoint3,
): BoardStreetRightHandFrame {
  const deckPalm = palmOver(CARD_PICKUP);
  const discardPalm = palmOver(DISCARD_TARGET);
  const boardPalm = palmOver(boardCard.position);
  const targetPalm = palmOver(boardTarget);
  let position = RIGHT_HAND_REST;
  let target = RIGHT_HAND_REST;
  let active = phase !== "settled";
  let holdingCard: "burn" | "board" | null = null;
  let contactCard: "burn" | "board" | null = null;

  switch (phase) {
    case "burn-reach":
      position = lerp(RIGHT_HAND_REST, deckPalm, smooth(phaseProgress));
      target = CARD_PICKUP;
      break;
    case "burn-carry":
    case "burn-place":
      position = palmOver(burnCard.position);
      target = burnCard.position;
      holdingCard = "burn";
      contactCard = "burn";
      break;
    case "burn-release":
      position = discardPalm;
      target = DISCARD_TARGET;
      break;
    case "board-take":
      position = lerp(
        burnRequired ? discardPalm : RIGHT_HAND_REST,
        deckPalm,
        smooth(phaseProgress),
      );
      target = CARD_PICKUP;
      break;
    case "board-carry":
    case "board-flip":
    case "board-place":
      position = boardPalm;
      target = boardCard.position;
      holdingCard = "board";
      contactCard = "board";
      break;
    case "board-release":
      position = targetPalm;
      target = boardTarget;
      break;
    case "recover":
      position = lerp(targetPalm, RIGHT_HAND_REST, smooth(phaseProgress));
      target = RIGHT_HAND_REST;
      break;
    case "settled":
      active = false;
      break;
  }

  return {
    actor: "dealer",
    hand: "right",
    position,
    target,
    palmNormal: [0, -1, 0],
    active,
    holdingCard,
    contactCard,
  };
}

function absentBurnCard(): BoardStreetCardFrame {
  return cardFrame({
    kind: "burn",
    required: false,
    visible: false,
    position: DISCARD_TARGET,
    rotationX: Math.PI,
    faceUpFraction: 0,
    ownership: "not-required",
    contact: { support: "none", felt: false, dealerRightHand: false },
    moving: false,
    arrived: false,
    released: false,
  });
}

function cardFrame(
  values: Omit<BoardStreetCardFrame, "quaternion" | "faceUp" | "feltClearance">,
): BoardStreetCardFrame {
  return {
    ...values,
    quaternion: rotationXQuaternion(values.rotationX),
    faceUp: values.faceUpFraction >= 1 - 1e-10,
    feltClearance: Math.max(0, values.position[1] - TABLE_HEIGHT),
  };
}

function phaseAfterBurnRelease(phase: BoardStreetPhase): boolean {
  return phase === "burn-release"
    || phase === "board-take"
    || phase === "board-carry"
    || phase === "board-flip"
    || phase === "board-place"
    || phase === "board-release"
    || phase === "recover"
    || phase === "settled";
}

function phaseComesAfter(
  phase: BoardStreetPhase,
  reference: BoardStreetPhase,
  windows: readonly PhaseWindow[],
): boolean {
  if (phase === "settled") return true;
  return windows.findIndex((window) => window.phase === phase)
    > windows.findIndex((window) => window.phase === reference);
}

function clampCardIndex(value: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return CARD_INDICES.length - 1;
  return Math.min(CARD_INDICES.length - 1, Math.max(0, Math.trunc(value)));
}

function clampUnit(value: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  return Math.min(1, Math.max(0, value));
}

function clampElapsed(value: number, duration: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return duration;
  return Math.min(duration, Math.max(0, value));
}

function smooth(value: number): number {
  const t = clampUnit(value);
  return t * t * (3 - 2 * t);
}

function lerp(
  from: BoardStreetPoint3,
  to: BoardStreetPoint3,
  progress: number,
): BoardStreetPoint3 {
  const t = clampUnit(progress);
  // Endpoint identity matters for ownership handoff: a released card must use
  // the exact authored destination, not an arithmetically adjacent float.
  if (t === 0) return from;
  if (t === 1) return to;
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function palmOver(target: BoardStreetPoint3): BoardStreetPoint3 {
  return [
    target[0],
    target[1] + BOARD_STREET_RIGHT_PALM_CLEARANCE,
    target[2],
  ];
}

function rotationXQuaternion(rotationX: number): BoardStreetQuaternion {
  const half = rotationX / 2;
  return [Math.sin(half), 0, 0, Math.cos(half)];
}
