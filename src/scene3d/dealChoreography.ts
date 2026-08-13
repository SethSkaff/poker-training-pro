/**
 * Pure timing and table-space geometry for the initial two-card deal.
 *
 * The renderer owns meshes and the character rig. This module owns the physical
 * contract between them: the left hand keeps the deck, the right hand escorts a
 * single card along the felt, and a recipient may inspect a card only after that
 * card reaches its lane.
 */

export type DealPoint3 = readonly [number, number, number];

export const HOLE_CARD_DEAL_DURATION_MS = 2_000;
export const HOLE_CARD_HALF_SPREAD_METRES = 0.055;

const TAKE_END = 0.12;
const SLIDE_END = 0.70;
const PLACE_END = 0.78;
const RELEASE_END = 0.84;

export interface HoleCardDealRecipient {
  readonly id: string;
  /** Increasing values advance clockwise around the rendered player ring. */
  readonly clockwiseIndex: number;
  /** Centre of this player's two-card lane, in table space. */
  readonly cardAnchor: DealPoint3;
  /** Rotation about Y that points from this player toward the table centre. */
  readonly facingRadians: number;
}

export interface HoleCardDealGeometry {
  /** Felt/card contact height. Every dealt-card position is pinned to it. */
  readonly surfaceY: number;
  /** The low deck position retained by the dealer's left hand. */
  readonly deckAnchor: DealPoint3;
  /** Where the dealer's right hand waits between individual cards. */
  readonly rightHandRest: DealPoint3;
  readonly cardHalfSpreadMetres?: number;
}

export interface HoleCardDealOptions {
  /** Usually the small blind: the first active player clockwise after the button. */
  readonly firstRecipientId?: string;
  readonly durationMs?: number;
}

export interface HoleCardDealAssignment {
  readonly sequenceIndex: number;
  /** Human-readable circuit number. Card index remains zero-based. */
  readonly circuit: 1 | 2;
  readonly cardIndex: 0 | 1;
  readonly recipientId: string;
  readonly recipientClockwiseIndex: number;
  readonly recipientOrder: number;
  readonly target: DealPoint3;
  readonly startMs: number;
  readonly arrivalMs: number;
  readonly releaseMs: number;
  readonly endMs: number;
}

export interface HoleCardDealPlan {
  readonly durationMs: number;
  readonly slotDurationMs: number;
  readonly surfaceY: number;
  readonly deckAnchor: DealPoint3;
  readonly rightHandRest: DealPoint3;
  readonly recipientIdsClockwise: readonly string[];
  readonly assignments: readonly HoleCardDealAssignment[];
}

export type HoleCardDealPhase =
  | "take"
  | "slide"
  | "place"
  | "release"
  | "return"
  | "complete";

export type HoleCardOwnership = "deck" | "dealer-right-hand" | "recipient";

export interface HoleCardDealCardFrame {
  readonly assignment: HoleCardDealAssignment;
  readonly phase: "queued" | HoleCardDealPhase | "settled";
  readonly position: DealPoint3;
  readonly ownership: HoleCardOwnership;
  /** Cards are never assigned an airborne state: their centres stay on the felt plane. */
  readonly contact: "felt";
  readonly visible: boolean;
  readonly moving: boolean;
  readonly arrived: boolean;
  readonly released: boolean;
  /** Physical availability only; the renderer must still enforce private-card authorization. */
  readonly viewable: boolean;
  readonly progress: number;
}

export interface HoleCardDealFrame {
  readonly progress: number;
  readonly elapsedMs: number;
  readonly phase: HoleCardDealPhase;
  readonly complete: boolean;
  readonly activeAssignment?: HoleCardDealAssignment;
  readonly deck: {
    readonly position: DealPoint3;
    readonly owner: "dealer-left-hand";
    readonly cardsRemaining: number;
  };
  readonly leftHand: {
    readonly target: DealPoint3;
    readonly holdingDeck: true;
  };
  readonly rightHand: {
    readonly target: DealPoint3;
    readonly holdingCard: boolean;
    readonly cardSequenceIndex?: number;
  };
  readonly cards: readonly HoleCardDealCardFrame[];
}

type NormalizedRecipient = HoleCardDealRecipient & {
  readonly clockwiseIndex: number;
  readonly facingRadians: number;
};

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finitePoint(point: DealPoint3, fallback: DealPoint3): DealPoint3 {
  return [
    finite(point[0], fallback[0]),
    finite(point[1], fallback[1]),
    finite(point[2], fallback[2]),
  ];
}

function onSurface(point: DealPoint3, surfaceY: number, fallback: DealPoint3): DealPoint3 {
  const safe = finitePoint(point, fallback);
  return [safe[0], surfaceY, safe[2]];
}

function clampUnit(value: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const t = clampUnit(value);
  return t * t * (3 - 2 * t);
}

function interpolate(from: DealPoint3, to: DealPoint3, progress: number): DealPoint3 {
  const t = smoothstep(progress);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function normalizedRecipients(
  recipients: readonly HoleCardDealRecipient[],
  firstRecipientId?: string,
): readonly NormalizedRecipient[] {
  const ordered = recipients
    .map((recipient): NormalizedRecipient => ({
      ...recipient,
      clockwiseIndex: Number.isFinite(recipient.clockwiseIndex)
        ? Math.trunc(recipient.clockwiseIndex)
        : Number.MAX_SAFE_INTEGER,
      facingRadians: finite(recipient.facingRadians, 0),
    }))
    .sort((left, right) =>
      left.clockwiseIndex - right.clockwiseIndex || left.id.localeCompare(right.id)
    );

  // A malformed event must not deal the same identity twice. Sorting before
  // de-duplication makes the selected entry independent of caller array order.
  const unique = ordered.filter(
    (recipient, index) => ordered.findIndex((candidate) => candidate.id === recipient.id) === index,
  );
  const first = firstRecipientId === undefined
    ? 0
    : unique.findIndex((recipient) => recipient.id === firstRecipientId);
  if (first <= 0) return unique;
  return [...unique.slice(first), ...unique.slice(0, first)];
}

function cardTarget(
  recipient: NormalizedRecipient,
  cardIndex: 0 | 1,
  surfaceY: number,
  halfSpread: number,
  fallback: DealPoint3,
): DealPoint3 {
  const anchor = onSurface(recipient.cardAnchor, surfaceY, fallback);
  // Seat-local +X is the player's left in this composition. Rotating that
  // offset into table space preserves the same card order at all six seats.
  const signedOffset = cardIndex === 0 ? halfSpread : -halfSpread;
  return [
    anchor[0] + Math.cos(recipient.facingRadians) * signedOffset,
    surfaceY,
    anchor[2] - Math.sin(recipient.facingRadians) * signedOffset,
  ];
}

/**
 * Build two non-overlapping clockwise circuits, beginning with the named first
 * recipient. Input order is deliberately irrelevant.
 */
export function createHoleCardDealPlan(
  recipients: readonly HoleCardDealRecipient[],
  geometry: HoleCardDealGeometry,
  options: HoleCardDealOptions = {},
): HoleCardDealPlan {
  const surfaceY = finite(geometry.surfaceY, 0);
  const fallback: DealPoint3 = [0, surfaceY, 0];
  const deckAnchor = onSurface(geometry.deckAnchor, surfaceY, fallback);
  const rightHandRest = onSurface(geometry.rightHandRest, surfaceY, deckAnchor);
  const halfSpread = Math.min(
    0.25,
    Math.max(0, finite(geometry.cardHalfSpreadMetres ?? HOLE_CARD_HALF_SPREAD_METRES, HOLE_CARD_HALF_SPREAD_METRES)),
  );
  const durationMs = Math.max(
    1,
    finite(options.durationMs ?? HOLE_CARD_DEAL_DURATION_MS, HOLE_CARD_DEAL_DURATION_MS),
  );
  const clockwise = normalizedRecipients(recipients, options.firstRecipientId);
  const assignmentCount = clockwise.length * 2;
  const slotDurationMs = assignmentCount === 0 ? 0 : durationMs / assignmentCount;
  const assignments: HoleCardDealAssignment[] = [];

  for (const cardIndex of [0, 1] as const) {
    for (const [recipientOrder, recipient] of clockwise.entries()) {
      const sequenceIndex = assignments.length;
      const startMs = sequenceIndex * slotDurationMs;
      assignments.push({
        sequenceIndex,
        circuit: cardIndex === 0 ? 1 : 2,
        cardIndex,
        recipientId: recipient.id,
        recipientClockwiseIndex: recipient.clockwiseIndex,
        recipientOrder,
        target: cardTarget(recipient, cardIndex, surfaceY, halfSpread, deckAnchor),
        startMs,
        arrivalMs: startMs + slotDurationMs * SLIDE_END,
        releaseMs: startMs + slotDurationMs * PLACE_END,
        endMs: startMs + slotDurationMs,
      });
    }
  }

  return {
    durationMs,
    slotDurationMs,
    surfaceY,
    deckAnchor,
    rightHandRest,
    recipientIdsClockwise: clockwise.map((recipient) => recipient.id),
    assignments,
  };
}

function localSlotProgress(assignment: HoleCardDealAssignment, elapsedMs: number): number {
  const duration = assignment.endMs - assignment.startMs;
  return duration <= 0 ? 1 : clampUnit((elapsedMs - assignment.startMs) / duration);
}

function phaseAt(local: number): HoleCardDealPhase {
  if (local < TAKE_END) return "take";
  if (local < SLIDE_END) return "slide";
  if (local < PLACE_END) return "place";
  if (local < RELEASE_END) return "release";
  return "return";
}

function slidePosition(
  plan: HoleCardDealPlan,
  assignment: HoleCardDealAssignment,
  local: number,
): DealPoint3 {
  if (local <= TAKE_END) return plan.deckAnchor;
  if (local >= SLIDE_END) return assignment.target;
  return interpolate(plan.deckAnchor, assignment.target, (local - TAKE_END) / (SLIDE_END - TAKE_END));
}

function cardFrame(
  plan: HoleCardDealPlan,
  assignment: HoleCardDealAssignment,
  elapsedMs: number,
): HoleCardDealCardFrame {
  if (elapsedMs < assignment.startMs) {
    return {
      assignment,
      phase: "queued",
      position: plan.deckAnchor,
      ownership: "deck",
      contact: "felt",
      visible: false,
      moving: false,
      arrived: false,
      released: false,
      viewable: false,
      progress: 0,
    };
  }
  if (elapsedMs >= assignment.endMs) {
    return {
      assignment,
      phase: "settled",
      position: assignment.target,
      ownership: "recipient",
      contact: "felt",
      visible: true,
      moving: false,
      arrived: true,
      released: true,
      viewable: true,
      progress: 1,
    };
  }

  const local = localSlotProgress(assignment, elapsedMs);
  const phase = phaseAt(local);
  const arrived = local >= SLIDE_END;
  const released = local >= PLACE_END;
  const ownership: HoleCardOwnership = local < TAKE_END
    ? "deck"
    : released
      ? "recipient"
      : "dealer-right-hand";
  return {
    assignment,
    phase,
    position: slidePosition(plan, assignment, local),
    ownership,
    contact: "felt",
    visible: local >= TAKE_END,
    moving: phase === "slide",
    arrived,
    released,
    viewable: arrived,
    progress: local,
  };
}

function activeAssignmentAt(
  plan: HoleCardDealPlan,
  elapsedMs: number,
): HoleCardDealAssignment | undefined {
  if (plan.assignments.length === 0 || elapsedMs >= plan.durationMs) return undefined;
  const index = Math.min(
    plan.assignments.length - 1,
    Math.max(0, Math.floor(elapsedMs / plan.slotDurationMs)),
  );
  return plan.assignments[index];
}

function rightHandTarget(
  plan: HoleCardDealPlan,
  assignment: HoleCardDealAssignment,
  local: number,
  phase: HoleCardDealPhase,
): DealPoint3 {
  if (phase === "take") {
    return interpolate(plan.rightHandRest, plan.deckAnchor, local / TAKE_END);
  }
  if (phase === "slide") return slidePosition(plan, assignment, local);
  if (phase === "place" || phase === "release") return assignment.target;
  return interpolate(
    assignment.target,
    plan.rightHandRest,
    (local - RELEASE_END) / (1 - RELEASE_END),
  );
}

/** Sample a plan using the renderer's normalized transition progress. */
export function sampleHoleCardDeal(
  plan: HoleCardDealPlan,
  progress: number,
): HoleCardDealFrame {
  const clampedProgress = clampUnit(progress);
  return sampleHoleCardDealAtMs(plan, clampedProgress * plan.durationMs);
}

/** Sample a plan on an elapsed-millisecond clock (useful for deterministic capture/tests). */
export function sampleHoleCardDealAtMs(
  plan: HoleCardDealPlan,
  elapsedMs: number,
): HoleCardDealFrame {
  const safeElapsed = Number.isNaN(elapsedMs) || elapsedMs === Number.NEGATIVE_INFINITY
    ? 0
    : elapsedMs === Number.POSITIVE_INFINITY
      ? plan.durationMs
      : Math.min(plan.durationMs, Math.max(0, elapsedMs));
  const progress = plan.durationMs <= 0 ? 1 : safeElapsed / plan.durationMs;
  const activeAssignment = activeAssignmentAt(plan, safeElapsed);
  const cards = plan.assignments.map((assignment) => cardFrame(plan, assignment, safeElapsed));
  const complete = activeAssignment === undefined;
  const phase = activeAssignment === undefined
    ? "complete"
    : phaseAt(localSlotProgress(activeAssignment, safeElapsed));
  const local = activeAssignment === undefined
    ? 1
    : localSlotProgress(activeAssignment, safeElapsed);
  const holdingCard = activeAssignment !== undefined
    && (phase === "slide" || phase === "place");
  const target = activeAssignment === undefined
    ? plan.rightHandRest
    : rightHandTarget(plan, activeAssignment, local, phase);

  return {
    progress,
    elapsedMs: safeElapsed,
    phase,
    complete,
    ...(activeAssignment ? { activeAssignment } : {}),
    deck: {
      position: plan.deckAnchor,
      owner: "dealer-left-hand",
      cardsRemaining: cards.filter((card) => card.ownership === "deck").length,
    },
    leftHand: { target: plan.deckAnchor, holdingDeck: true },
    rightHand: {
      target,
      holdingCard,
      ...(holdingCard && activeAssignment
        ? { cardSequenceIndex: activeAssignment.sequenceIndex }
        : {}),
    },
    cards,
  };
}
