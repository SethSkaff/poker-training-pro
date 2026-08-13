import type { SeatPose } from "./tableSceneModel";
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";

/** World-space vector used by the renderer-neutral fold choreography. */
export type FoldVector3 = readonly [number, number, number];
export type FoldCardIndex = 0 | 1;

export type FoldPhase =
  | "player-reach"
  | "player-slide"
  | "handoff-wait"
  | "dealer-collect"
  | "dealer-recover"
  | "settled";

export type FoldCardOwnership =
  | "player-cards"
  | "felt-staging"
  | "dealer-right-hand"
  | "discard-pile";

export type FoldMotionOwner =
  | "none"
  | "player-right-hand"
  | "dealer-right-hand";

export interface FoldCardPose {
  readonly index: FoldCardIndex;
  /** Card centre in table/world space. */
  readonly position: FoldVector3;
  /** Euler XYZ rotation; cards stay flat, so only table-plane yaw changes. */
  readonly rotation: FoldVector3;
  /** Height of the card centre above the authored felt plane. */
  readonly feltClearance: number;
}

export interface FoldHandPose {
  readonly actor: "player" | "dealer";
  readonly hand: "right";
  /** Desired palm centre in table/world space. */
  readonly position: FoldVector3;
  /** The physical packet centre the palm is reaching toward. */
  readonly target: FoldVector3;
  readonly palmNormal: FoldVector3;
  readonly active: boolean;
  readonly reachProgress: number;
  readonly contactCardIndices: readonly FoldCardIndex[];
}

export interface FoldContactMetadata {
  /** Cards stay supported by the felt throughout the choreography. */
  readonly felt: true;
  readonly playerRightHand: boolean;
  readonly dealerRightHand: boolean;
  readonly cardIndices: readonly FoldCardIndex[];
}

export interface FoldChoreographyFrame {
  readonly elapsedMs: number;
  readonly phase: FoldPhase;
  readonly phaseProgress: number;
  readonly playerSlideProgress: number;
  readonly dealerCollectionProgress: number;
  readonly ownership: FoldCardOwnership;
  readonly motionOwner: FoldMotionOwner;
  readonly contact: FoldContactMetadata;
  readonly cards: readonly [FoldCardPose, FoldCardPose];
  readonly playerRightHand: FoldHandPose;
  readonly dealerRightHand: FoldHandPose;
}

const PLAYER_REACH_MS = 260;
const PLAYER_SLIDE_MS = 440;
const HANDOFF_WAIT_MS = 500;
const DEALER_COLLECT_MS = 520;
const DEALER_RECOVER_MS = 240;

const PLAYER_SLIDE_STARTS_AT_MS = PLAYER_REACH_MS;
const PLAYER_SLIDE_ENDS_AT_MS = PLAYER_SLIDE_STARTS_AT_MS + PLAYER_SLIDE_MS;
const DEALER_COLLECTION_STARTS_AT_MS = PLAYER_SLIDE_ENDS_AT_MS + HANDOFF_WAIT_MS;
const DEALER_COLLECTION_ENDS_AT_MS = DEALER_COLLECTION_STARTS_AT_MS + DEALER_COLLECT_MS;
const TOTAL_MS = DEALER_COLLECTION_ENDS_AT_MS + DEALER_RECOVER_MS;

/**
 * Absolute timing contract. In particular, no dealer card ownership or card
 * motion begins until exactly 500 ms after the player's push has completed.
 */
export const FOLD_CHOREOGRAPHY_TIMING = Object.freeze({
  playerReachMs: PLAYER_REACH_MS,
  playerSlideMs: PLAYER_SLIDE_MS,
  handoffWaitMs: HANDOFF_WAIT_MS,
  dealerCollectMs: DEALER_COLLECT_MS,
  dealerRecoverMs: DEALER_RECOVER_MS,
  playerSlideStartsAtMs: PLAYER_SLIDE_STARTS_AT_MS,
  playerSlideEndsAtMs: PLAYER_SLIDE_ENDS_AT_MS,
  dealerCollectionStartsAtMs: DEALER_COLLECTION_STARTS_AT_MS,
  dealerCollectionEndsAtMs: DEALER_COLLECTION_ENDS_AT_MS,
  totalMs: TOTAL_MS,
});

/** Matches the two-card spread currently authored in `tableScene`. */
export const FOLD_PRIVATE_CARD_HALF_SPREAD = 0.055;
/** The player's push is along that seat's own inward/forward axis. */
export const FOLD_PLAYER_SLIDE_DISTANCE = 0.24;
/** Palm stays low over the packet while either hand is in contact. */
export const FOLD_CONTACT_PALM_CLEARANCE = 0.028;
/** Includes the discard anchor's 10 mm lift and a 1.8 mm pile offset. */
export const FOLD_MAX_CARD_FELT_CLEARANCE = 0.012;

const NO_CARD_INDICES: readonly FoldCardIndex[] = Object.freeze([]);
const BOTH_CARD_INDICES: readonly FoldCardIndex[] = Object.freeze([0, 1]);
const CARD_LOCAL_OFFSETS = [
  FOLD_PRIVATE_CARD_HALF_SPREAD,
  -FOLD_PRIVATE_CARD_HALF_SPREAD,
] as const;
const DISCARD_YAWS = [-0.06, 0.04] as const;

interface FoldTimelineState {
  readonly elapsedMs: number;
  readonly phase: FoldPhase;
  readonly phaseProgress: number;
  readonly playerSlideProgress: number;
  readonly dealerCollectionProgress: number;
}

/** Exact world-space centres of the two private cards before the fold starts. */
export function foldPrivateCardPoses(
  pose: SeatPose,
): readonly [FoldCardPose, FoldCardPose] {
  return [
    cardPoseAt(
      0,
      offsetFromCentre(pose.feltPosition, pose.facing, CARD_LOCAL_OFFSETS[0], 0),
      pose.facing,
    ),
    cardPoseAt(
      1,
      offsetFromCentre(pose.feltPosition, pose.facing, CARD_LOCAL_OFFSETS[1], 0),
      pose.facing,
    ),
  ];
}

/**
 * Player-side handoff positions. The packet keeps its exact two-card spacing
 * and moves only forward in the owner's local frame.
 */
export function foldStagingCardPoses(
  pose: SeatPose,
): readonly [FoldCardPose, FoldCardPose] {
  const centre = foldStagingCentre(pose);
  return [
    cardPoseAt(
      0,
      offsetFromCentre(centre, pose.facing, CARD_LOCAL_OFFSETS[0], 0),
      pose.facing,
    ),
    cardPoseAt(
      1,
      offsetFromCentre(centre, pose.facing, CARD_LOCAL_OFFSETS[1], 0),
      pose.facing,
    ),
  ];
}

/** Final pair positions inside the dealer-side discard pile. */
export function foldDiscardCardPoses(): readonly [FoldCardPose, FoldCardPose] {
  return [
    cardPoseAt(0, [
      TABLE_ANCHORS.muck[0] - 0.012,
      TABLE_ANCHORS.muck[1],
      TABLE_ANCHORS.muck[2],
    ], DISCARD_YAWS[0]),
    cardPoseAt(1, [
      TABLE_ANCHORS.muck[0],
      TABLE_ANCHORS.muck[1] + 0.0018,
      TABLE_ANCHORS.muck[2],
    ], DISCARD_YAWS[1]),
  ];
}

/** Centre-side staging point, clamped so an unusual pose cannot overshoot. */
export function foldStagingCentre(pose: SeatPose): FoldVector3 {
  const forwardX = Math.sin(pose.facing);
  const forwardZ = Math.cos(pose.facing);
  // Project the vector to table centre onto the seat's authored forward axis.
  // All six production stations have more than 240 mm available; the clamp is
  // for deterministic behaviour if a caller supplies a custom/degenerate pose.
  const projectedToCentre = -(pose.feltPosition[0] * forwardX
    + pose.feltPosition[2] * forwardZ);
  const available = Number.isFinite(projectedToCentre)
    ? Math.max(0, projectedToCentre)
    : 0;
  const distance = Math.min(FOLD_PLAYER_SLIDE_DISTANCE, available);
  return [
    pose.feltPosition[0] + forwardX * distance,
    pose.feltPosition[1],
    pose.feltPosition[2] + forwardZ * distance,
  ];
}

/** Card-only helper for renderers that already own their hand rig. */
export function foldCardPoses(
  pose: SeatPose,
  elapsedMs: number,
): readonly [FoldCardPose, FoldCardPose] {
  const timeline = foldTimeline(elapsedMs);
  return cardPosesForTimeline(pose, timeline);
}

/** Hand-only helper for renderers that own card meshes elsewhere. */
export function foldHandPoses(
  pose: SeatPose,
  elapsedMs: number,
): Pick<FoldChoreographyFrame, "playerRightHand" | "dealerRightHand"> {
  const timeline = foldTimeline(elapsedMs);
  const cards = cardPosesForTimeline(pose, timeline);
  return handPosesForTimeline(pose, timeline, cards);
}

/** One deterministic, renderer-neutral frame of the complete fold. */
export function foldChoreographyFrame(
  pose: SeatPose,
  elapsedMs: number,
): FoldChoreographyFrame {
  const timeline = foldTimeline(elapsedMs);
  const cards = cardPosesForTimeline(pose, timeline);
  const hands = handPosesForTimeline(pose, timeline, cards);
  const metadata = metadataForPhase(timeline.phase);
  return {
    ...timeline,
    ...metadata,
    cards,
    ...hands,
  };
}

/** Convenience bridge for the scene's existing normalized transition clock. */
export function foldChoreographyAtProgress(
  pose: SeatPose,
  progress: number,
): FoldChoreographyFrame {
  return foldChoreographyFrame(pose, clampUnit(progress) * TOTAL_MS);
}

function foldTimeline(elapsedMs: number): FoldTimelineState {
  const elapsed = clampElapsedMs(elapsedMs);
  if (elapsed < PLAYER_SLIDE_STARTS_AT_MS) {
    return timeline(
      elapsed,
      "player-reach",
      elapsed / PLAYER_REACH_MS,
      0,
      0,
    );
  }
  if (elapsed < PLAYER_SLIDE_ENDS_AT_MS) {
    const slide = (elapsed - PLAYER_SLIDE_STARTS_AT_MS) / PLAYER_SLIDE_MS;
    return timeline(elapsed, "player-slide", slide, slide, 0);
  }
  if (elapsed < DEALER_COLLECTION_STARTS_AT_MS) {
    return timeline(
      elapsed,
      "handoff-wait",
      (elapsed - PLAYER_SLIDE_ENDS_AT_MS) / HANDOFF_WAIT_MS,
      1,
      0,
    );
  }
  if (elapsed < DEALER_COLLECTION_ENDS_AT_MS) {
    const collection = (elapsed - DEALER_COLLECTION_STARTS_AT_MS) / DEALER_COLLECT_MS;
    return timeline(elapsed, "dealer-collect", collection, 1, collection);
  }
  if (elapsed < TOTAL_MS) {
    return timeline(
      elapsed,
      "dealer-recover",
      (elapsed - DEALER_COLLECTION_ENDS_AT_MS) / DEALER_RECOVER_MS,
      1,
      1,
    );
  }
  return timeline(elapsed, "settled", 1, 1, 1);
}

function timeline(
  elapsedMs: number,
  phase: FoldPhase,
  phaseProgress: number,
  playerSlideProgress: number,
  dealerCollectionProgress: number,
): FoldTimelineState {
  return {
    elapsedMs,
    phase,
    phaseProgress: clampUnit(phaseProgress),
    playerSlideProgress: clampUnit(playerSlideProgress),
    dealerCollectionProgress: clampUnit(dealerCollectionProgress),
  };
}

function cardPosesForTimeline(
  pose: SeatPose,
  timelineState: FoldTimelineState,
): readonly [FoldCardPose, FoldCardPose] {
  const privateCards = foldPrivateCardPoses(pose);
  const stagingCards = foldStagingCardPoses(pose);
  const discardCards = foldDiscardCardPoses();
  if (timelineState.playerSlideProgress < 1) {
    const t = smooth(timelineState.playerSlideProgress);
    return interpolateCardPairs(privateCards, stagingCards, t);
  }
  if (timelineState.dealerCollectionProgress < 1) {
    const t = smooth(timelineState.dealerCollectionProgress);
    return interpolateCardPairs(stagingCards, discardCards, t);
  }
  return discardCards;
}

function handPosesForTimeline(
  pose: SeatPose,
  timelineState: FoldTimelineState,
  cards: readonly [FoldCardPose, FoldCardPose],
): Pick<FoldChoreographyFrame, "playerRightHand" | "dealerRightHand"> {
  const privateCentre = packetCentre(foldPrivateCardPoses(pose));
  const stagingCentre = packetCentre(foldStagingCardPoses(pose));
  const discardCentre = packetCentre(foldDiscardCardPoses());
  const currentCentre = packetCentre(cards);
  const playerRest = playerRightHandRest(pose, privateCentre);
  const dealerRest = dealerRightHandRest();
  const privateContact = palmOver(privateCentre);
  const stagingContact = palmOver(stagingCentre);
  const discardContact = palmOver(discardCentre);

  let playerPosition = playerRest;
  let playerTarget = privateCentre;
  let playerReachProgress = 0;
  let playerActive = false;
  let playerContact = NO_CARD_INDICES;

  if (timelineState.phase === "player-reach") {
    const reach = smooth(timelineState.phaseProgress);
    playerPosition = lerpVector(playerRest, privateContact, reach);
    playerReachProgress = reach;
    playerActive = true;
  } else if (timelineState.phase === "player-slide") {
    playerPosition = palmOver(currentCentre);
    playerTarget = currentCentre;
    playerReachProgress = 1;
    playerActive = true;
    playerContact = BOTH_CARD_INDICES;
  } else if (timelineState.phase === "handoff-wait") {
    // Release and recover smoothly during the first 200 ms. Cards do not move.
    const recover = smooth(clampUnit(timelineState.phaseProgress / 0.4));
    playerPosition = lerpVector(stagingContact, playerRest, recover);
    playerTarget = stagingCentre;
    playerReachProgress = 1 - recover;
    playerActive = recover < 1;
  }

  let dealerPosition = dealerRest;
  let dealerTarget = stagingCentre;
  let dealerReachProgress = 0;
  let dealerActive = false;
  let dealerContact = NO_CARD_INDICES;

  if (timelineState.phase === "handoff-wait") {
    // The dealer may approach without touching the cards. The palm arrives at
    // the staging point exactly as the mandatory 500 ms card hold completes.
    const approach = smooth(timelineState.phaseProgress);
    dealerPosition = lerpVector(dealerRest, stagingContact, approach);
    dealerReachProgress = approach;
    dealerActive = approach > 0;
  } else if (timelineState.phase === "dealer-collect") {
    dealerPosition = palmOver(currentCentre);
    dealerTarget = currentCentre;
    dealerReachProgress = 1;
    dealerActive = true;
    dealerContact = BOTH_CARD_INDICES;
  } else if (timelineState.phase === "dealer-recover") {
    const recover = smooth(timelineState.phaseProgress);
    dealerPosition = lerpVector(discardContact, dealerRest, recover);
    dealerTarget = discardCentre;
    dealerReachProgress = 1 - recover;
    dealerActive = recover < 1;
  }

  return {
    playerRightHand: handPose(
      "player",
      playerPosition,
      playerTarget,
      playerActive,
      playerReachProgress,
      playerContact,
    ),
    dealerRightHand: handPose(
      "dealer",
      dealerPosition,
      dealerTarget,
      dealerActive,
      dealerReachProgress,
      dealerContact,
    ),
  };
}

function metadataForPhase(
  phase: FoldPhase,
): Pick<FoldChoreographyFrame, "ownership" | "motionOwner" | "contact"> {
  if (phase === "player-slide") {
    return {
      ownership: "player-cards",
      motionOwner: "player-right-hand",
      contact: contact(true, false, BOTH_CARD_INDICES),
    };
  }
  if (phase === "handoff-wait") {
    return {
      ownership: "felt-staging",
      motionOwner: "none",
      contact: contact(false, false, NO_CARD_INDICES),
    };
  }
  if (phase === "dealer-collect") {
    return {
      ownership: "dealer-right-hand",
      motionOwner: "dealer-right-hand",
      contact: contact(false, true, BOTH_CARD_INDICES),
    };
  }
  if (phase === "dealer-recover" || phase === "settled") {
    return {
      ownership: "discard-pile",
      motionOwner: "none",
      contact: contact(false, false, NO_CARD_INDICES),
    };
  }
  return {
    ownership: "player-cards",
    motionOwner: "none",
    contact: contact(false, false, NO_CARD_INDICES),
  };
}

function contact(
  playerRightHand: boolean,
  dealerRightHand: boolean,
  cardIndices: readonly FoldCardIndex[],
): FoldContactMetadata {
  return { felt: true, playerRightHand, dealerRightHand, cardIndices };
}

function handPose(
  actor: FoldHandPose["actor"],
  position: FoldVector3,
  target: FoldVector3,
  active: boolean,
  reachProgress: number,
  contactCardIndices: readonly FoldCardIndex[],
): FoldHandPose {
  return {
    actor,
    hand: "right",
    position,
    target,
    palmNormal: [0, -1, 0],
    active,
    reachProgress: clampUnit(reachProgress),
    contactCardIndices,
  };
}

function cardPoseAt(
  index: FoldCardIndex,
  position: FoldVector3,
  yaw: number,
): FoldCardPose {
  return {
    index,
    position,
    rotation: [0, yaw, 0],
    feltClearance: Math.max(0, position[1] - TABLE_HEIGHT),
  };
}

function interpolateCardPairs(
  from: readonly [FoldCardPose, FoldCardPose],
  to: readonly [FoldCardPose, FoldCardPose],
  progress: number,
): readonly [FoldCardPose, FoldCardPose] {
  return [
    cardPoseAt(
      0,
      lerpVector(from[0].position, to[0].position, progress),
      lerpAngle(from[0].rotation[1], to[0].rotation[1], progress),
    ),
    cardPoseAt(
      1,
      lerpVector(from[1].position, to[1].position, progress),
      lerpAngle(from[1].rotation[1], to[1].rotation[1], progress),
    ),
  ];
}

function offsetFromCentre(
  centre: FoldVector3,
  facing: number,
  lateral: number,
  forward: number,
): FoldVector3 {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return [
    centre[0] + lateral * cos + forward * sin,
    centre[1],
    centre[2] - lateral * sin + forward * cos,
  ];
}

function playerRightHandRest(
  pose: SeatPose,
  privateCentre: FoldVector3,
): FoldVector3 {
  const cos = Math.cos(pose.facing);
  const sin = Math.sin(pose.facing);
  // Local -X is the player's right; local -Z is back toward their rail.
  return [
    privateCentre[0] - cos * 0.14 - sin * 0.16,
    TABLE_HEIGHT + 0.085,
    privateCentre[2] + sin * 0.14 - Math.cos(pose.facing) * 0.16,
  ];
}

function dealerRightHandRest(): FoldVector3 {
  // Dealer faces +Z, so world -X is their right hand.
  return [-0.16, TABLE_HEIGHT + 0.085, TABLE_ANCHORS.muck[2] - 0.025];
}

function palmOver(target: FoldVector3): FoldVector3 {
  return [target[0], target[1] + FOLD_CONTACT_PALM_CLEARANCE, target[2]];
}

function packetCentre(
  cards: readonly [FoldCardPose, FoldCardPose],
): FoldVector3 {
  return [
    (cards[0].position[0] + cards[1].position[0]) / 2,
    (cards[0].position[1] + cards[1].position[1]) / 2,
    (cards[0].position[2] + cards[1].position[2]) / 2,
  ];
}

function lerpVector(
  from: FoldVector3,
  to: FoldVector3,
  progress: number,
): FoldVector3 {
  const t = clampUnit(progress);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function lerpAngle(from: number, to: number, progress: number): number {
  const fullTurn = Math.PI * 2;
  const delta = ((to - from + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  return from + delta * clampUnit(progress);
}

function smooth(progress: number): number {
  const t = clampUnit(progress);
  return t * t * (3 - 2 * t);
}

function clampUnit(value: number): number {
  if (Number.isNaN(value) || value === -Infinity) return 0;
  if (value === Infinity) return 1;
  return Math.min(1, Math.max(0, value));
}

function clampElapsedMs(value: number): number {
  if (Number.isNaN(value) || value === -Infinity) return 0;
  if (value === Infinity) return TOTAL_MS;
  return Math.min(TOTAL_MS, Math.max(0, value));
}
