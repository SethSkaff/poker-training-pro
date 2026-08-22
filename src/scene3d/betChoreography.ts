/**
 * Renderer-neutral choreography for moving a wager out of a player's rack.
 *
 * The scene model owns the table/station geometry. This module adds the missing
 * physical transaction: choose chips that really exist in denomination-pure
 * rack columns, visit those columns with the player's left hand, keep every
 * carried chip attached to that hand, and release only after the chips reach
 * felt at the owner's wager mark.
 *
 * Positions are table-space metres. `hand.position` is an end-effector/contact
 * target for the procedural arm rig; it is not an inverse-kinematic or finger
 * simulation.
 */
import {
  BET_CIRCLE_FORWARD,
  CARD_ZONE_LOCAL_MAX_Z,
  CHIP_VERTICAL_PITCH,
  CHIPS_PER_COLUMN,
  PREVIOUS_BET_CIRCLE_FORWARD,
  TABLE_HEIGHT,
  betCirclePosition,
  chipColumnLayoutForAmount,
  chipInventoryForAmount,
  chipRackColumnPosition,
  restingChipStackPosition,
  seatLocalPoint,
  seatRailAnchor,
  seatWorldPoint,
  wagerChipStackOffset,
  type SeatPose,
} from "./tableSceneModel";

export type BetPoint3 = readonly [number, number, number];

/** Matches the vertical instance pitch in `tableScene.setChipStack`. */
export const BET_CHIP_VERTICAL_PITCH = CHIP_VERTICAL_PITCH;
/** The contact surface sits halfway above a chip centre. */
export const BET_CHIP_HALF_HEIGHT = BET_CHIP_VERTICAL_PITCH / 2;
/** A low, visible clearance while the hand crosses the felt. */
export const BET_HAND_HOVER_CLEARANCE = 0.035;

/**
 * One normalized action timeline. Gathering is divided evenly across however
 * many physical source columns the exact wager needs.
 */
export const BET_CHOREOGRAPHY_TIMING = Object.freeze({
  gatherEnd: 0.46,
  transferEnd: 0.80,
  placeEnd: 0.92,
  releaseEnd: 0.96,
  reachFractionOfPickup: 0.72,
});

export type BetChoreographyPhase =
  | "reach"
  | "grasp"
  | "carry"
  | "place"
  | "release"
  | "recover"
  | "settled";

export type BetChipOwnership = "rack" | "left-hand" | "wager";
export type BetChipContact =
  | "rack"
  | "rack-and-left-hand"
  | "left-hand"
  | "felt"
  | "chip-below";

export type LeftHandContact = "none" | "source-chips" | "carried-chips";

export interface WagerSourceColumn {
  /** Index from the actual low-to-high denomination rack layout. */
  readonly column: number;
  readonly denomination: number;
  readonly availableCount: number;
  /** Top chips removed from this denomination-pure column. */
  readonly selectedCount: number;
  readonly firstSelectedHeight: number;
  readonly rackOffset: readonly [number, number];
  /** Centre of the physical rack column's lowest chip. */
  readonly columnBasePosition: BetPoint3;
  /** Centre of the lowest selected chip (selection always comes off the top). */
  readonly selectedBasePosition: BetPoint3;
  /** Top-surface contact point used by the left-hand target. */
  readonly gripPosition: BetPoint3;
  /** Physical visit order; shorter columns are visited first to avoid clipping felt. */
  readonly pickupIndex: number;
  readonly pickupStart: number;
  readonly graspStart: number;
  readonly pickupEnd: number;
}

export interface SelectedWagerChip {
  readonly id: string;
  readonly denomination: number;
  readonly sourceColumn: number;
  readonly sourceHeight: number;
  readonly sourcePosition: BetPoint3;
  readonly destinationColumn: number;
  readonly destinationHeight: number;
  readonly destinationPosition: BetPoint3;
}

export interface BetChoreographyPlan {
  readonly pose: SeatPose;
  readonly rackAmount: number;
  /** Increment removed from the rack, not the seat's already-committed total. */
  readonly amount: number;
  /** Chips already settled at this wager anchor before the increment begins. */
  readonly existingWagerChipCount: number;
  readonly hand: "left";
  readonly handRestPosition: BetPoint3;
  /** Existing renderer anchor, retained so integration can audit the move. */
  readonly previousWagerPosition: BetPoint3;
  /** Far edge of the owner's protected private-card zone, in the +Z/inward direction. */
  readonly privateCardInwardEdgePosition: BetPoint3;
  /** New owner-side wager anchor, exactly halfway across the old card-to-bet gap. */
  readonly wagerPosition: BetPoint3;
  readonly destinationGripPosition: BetPoint3;
  readonly destinationHoverPosition: BetPoint3;
  readonly sourceColumns: readonly WagerSourceColumn[];
  readonly chips: readonly SelectedWagerChip[];
}

export interface BetHandFrame {
  readonly side: "left";
  readonly position: BetPoint3;
  readonly contact: LeftHandContact;
  readonly gripping: boolean;
}

export interface BetChipFrame extends SelectedWagerChip {
  readonly position: BetPoint3;
  readonly ownership: BetChipOwnership;
  readonly contact: BetChipContact;
  /** Equal to the hand target whenever ownership is `left-hand`. */
  readonly carrierAnchor?: BetPoint3;
}

export interface BetChoreographyFrame {
  readonly phase: BetChoreographyPhase;
  readonly phaseProgress: number;
  readonly progress: number;
  readonly activeSourceColumn?: number;
  readonly hand: BetHandFrame;
  readonly chips: readonly BetChipFrame[];
  readonly released: boolean;
}

export interface BetChoreographyRequest {
  readonly pose: SeatPose;
  readonly rackAmount: number;
  /** Exact chip value to leave the rack during this action. */
  readonly amount: number;
  /** Public amount already committed on this street before this increment. */
  readonly existingWagerAmount?: number;
  /** Supply the rig's measured rest target when available. */
  readonly handRestPosition?: BetPoint3;
}

type MutableSelectedChip = Omit<SelectedWagerChip, "destinationColumn" | "destinationHeight" | "destinationPosition">;

/** The +Z edge of the owner's authored private-card rectangle. */
export function privateCardInwardEdgePosition(pose: SeatPose): BetPoint3 {
  const card = seatLocalPoint(pose, pose.feltPosition);
  return seatWorldPoint(pose, [
    card[0],
    TABLE_HEIGHT,
    card[2] + CARD_ZONE_LOCAL_MAX_Z,
  ]);
}

/**
 * New printed wager centre.
 *
 * In the station frame, +Z points inward. `betCirclePosition` already owns the
 * shared midpoint, so renderer, labels, and choreography cannot diverge.
 */
export function ownerWagerPosition(pose: SeatPose): BetPoint3 {
  return betCirclePosition(pose);
}

/** Former printed-circle centre retained only for midpoint/audit metadata. */
export function previousWagerPosition(pose: SeatPose): BetPoint3 {
  return [
    pose.feltPosition[0] + Math.sin(pose.facing) * PREVIOUS_BET_CIRCLE_FORWARD,
    TABLE_HEIGHT,
    pose.feltPosition[2] + Math.cos(pose.facing) * PREVIOUS_BET_CIRCLE_FORWARD,
  ];
}

/**
 * A shared neutral left-hand target for the procedural roster. Renderers with
 * a measured palm world position should pass that into the plan instead.
 */
export function defaultLeftHandRestPosition(pose: SeatPose): BetPoint3 {
  const rail = seatLocalPoint(pose, seatRailAnchor(pose));
  return seatWorldPoint(pose, [
    rail[0] + 0.13,
    TABLE_HEIGHT + 0.085,
    rail[2] + 0.05,
  ]);
}

/**
 * Build an immutable selection/geometry plan once per wager transition.
 *
 * The bounded exact selector prefers higher denominations, then earlier rack
 * columns. It never fabricates a chip or silently overpays: if the rendered
 * inventory cannot make the requested increment exactly, this throws and the
 * caller must re-rack/make change before animating.
 */
export function createBetChoreographyPlan(
  request: BetChoreographyRequest,
): BetChoreographyPlan {
  const rackAmount = requireAmount("rackAmount", request.rackAmount, true);
  const amount = requireAmount("amount", request.amount, false);
  const existingWagerAmount = requireAmount(
    "existingWagerAmount",
    request.existingWagerAmount ?? 0,
    true,
  );
  const existingWagerChipCount = chipInventoryForAmount(existingWagerAmount).length;
  if (amount > rackAmount) {
    throw new RangeError(`Wager ${amount} exceeds rack amount ${rackAmount}`);
  }

  const layout = chipColumnLayoutForAmount(rackAmount, CHIPS_PER_COLUMN);
  const denominationCounts = exactDenominationSelection(layout, amount);
  const rackOrigin = restingChipStackPosition(request.pose, rackAmount);
  const rackOriginLocal = seatLocalPoint(request.pose, rackOrigin);

  const selectedColumns = layout.flatMap((column) => {
    const remaining = denominationCounts.get(column.denomination) ?? 0;
    if (remaining <= 0) return [];
    const selectedCount = Math.min(column.count, remaining);
    denominationCounts.set(column.denomination, remaining - selectedCount);
    if (selectedCount <= 0) return [];
    const rackOffset = chipRackColumnPosition(column.column, layout.length);
    const localX = rackOriginLocal[0] + rackOffset[0];
    const localZ = rackOriginLocal[2] + rackOffset[1];
    const firstSelectedHeight = column.count - selectedCount;
    const columnBasePosition = seatWorldPoint(request.pose, [localX, TABLE_HEIGHT, localZ]);
    const selectedBasePosition = seatWorldPoint(request.pose, [
      localX,
      TABLE_HEIGHT + firstSelectedHeight * BET_CHIP_VERTICAL_PITCH,
      localZ,
    ]);
    const gripPosition = seatWorldPoint(request.pose, [
      localX,
      TABLE_HEIGHT + (column.count - 1) * BET_CHIP_VERTICAL_PITCH + BET_CHIP_HALF_HEIGHT,
      localZ,
    ]);
    return [{
      column: column.column,
      denomination: column.denomination,
      availableCount: column.count,
      selectedCount,
      firstSelectedHeight,
      rackOffset,
      columnBasePosition,
      selectedBasePosition,
      gripPosition,
    }];
  });

  // A hand carrying a taller pickup must not descend far enough for its lowest
  // chip to pass through the felt. Visiting shorter physical columns first
  // makes every subsequent grip point at least as high as the previous one.
  selectedColumns.sort((left, right) =>
    left.gripPosition[1] - right.gripPosition[1]
      || left.column - right.column
  );

  const pickupDuration = BET_CHOREOGRAPHY_TIMING.gatherEnd / selectedColumns.length;
  const sourceColumns: readonly WagerSourceColumn[] = selectedColumns.map((source, pickupIndex) => {
    const pickupStart = pickupIndex * pickupDuration;
    const pickupEnd = (pickupIndex + 1) * pickupDuration;
    return {
      ...source,
      pickupIndex,
      pickupStart,
      graspStart: pickupStart + pickupDuration * BET_CHOREOGRAPHY_TIMING.reachFractionOfPickup,
      pickupEnd,
    };
  });

  const sourceByColumn = new Map(sourceColumns.map((source) => [source.column, source]));
  const selected: MutableSelectedChip[] = [];
  for (const source of sourceColumns) {
    for (let height = source.firstSelectedHeight; height < source.availableCount; height += 1) {
      selected.push({
        id: `${source.column}:${height}`,
        denomination: source.denomination,
        sourceColumn: source.column,
        sourceHeight: height,
        sourcePosition: withY(
          source.columnBasePosition,
          TABLE_HEIGHT + height * BET_CHIP_VERTICAL_PITCH,
        ),
      });
    }
  }

  const destinationAssignments = destinationSlots(selected, existingWagerChipCount);
  const wagerPosition = ownerWagerPosition(request.pose);
  const wagerLocal = seatLocalPoint(request.pose, wagerPosition);
  const chips: readonly SelectedWagerChip[] = destinationAssignments.map((assignment) => {
    const offset = wagerChipStackOffset(assignment.destinationHeight);
    return {
      ...assignment,
      destinationPosition: seatWorldPoint(request.pose, [
        wagerLocal[0] + offset[0],
        TABLE_HEIGHT + offset[1],
        wagerLocal[2] + offset[2],
      ]),
    };
  });

  // The selected source map is also an integrity assertion: every chip token
  // must still point to a real selected denomination-pure column.
  for (const chip of chips) {
    const source = sourceByColumn.get(chip.sourceColumn);
    if (!source || source.denomination !== chip.denomination) {
      throw new Error(`Invalid source column for selected chip ${chip.id}`);
    }
  }

  const topDestinationY = Math.max(...chips.map((chip) => chip.destinationPosition[1]));
  const destinationGripPosition: BetPoint3 = [
    wagerPosition[0],
    topDestinationY + BET_CHIP_HALF_HEIGHT,
    wagerPosition[2],
  ];
  const lastGrip = sourceColumns[sourceColumns.length - 1]!.gripPosition;
  const destinationHoverPosition: BetPoint3 = [
    destinationGripPosition[0],
    Math.max(
      lastGrip[1],
      destinationGripPosition[1] + BET_HAND_HOVER_CLEARANCE,
    ),
    destinationGripPosition[2],
  ];

  return {
    pose: request.pose,
    rackAmount,
    amount,
    existingWagerChipCount,
    hand: "left",
    handRestPosition: request.handRestPosition ?? defaultLeftHandRestPosition(request.pose),
    previousWagerPosition: previousWagerPosition(request.pose),
    privateCardInwardEdgePosition: privateCardInwardEdgePosition(request.pose),
    wagerPosition,
    destinationGripPosition,
    destinationHoverPosition,
    sourceColumns,
    chips,
  };
}

/** Resolve one deterministic renderer frame from a precomputed plan. */
export function betChoreographyFrame(
  plan: BetChoreographyPlan,
  progress: number,
): BetChoreographyFrame {
  const t = clamp01(progress);
  const gathering = t < BET_CHOREOGRAPHY_TIMING.gatherEnd;
  let phase: BetChoreographyPhase;
  let phaseProgress: number;
  let activePickupIndex: number | undefined;
  let handPosition: BetPoint3;

  if (gathering) {
    const pickupDuration = BET_CHOREOGRAPHY_TIMING.gatherEnd / plan.sourceColumns.length;
    activePickupIndex = Math.min(
      plan.sourceColumns.length - 1,
      Math.floor(t / pickupDuration),
    );
    const source = plan.sourceColumns[activePickupIndex]!;
    const local = (t - source.pickupStart) / (source.pickupEnd - source.pickupStart);
    const previous = activePickupIndex === 0
      ? plan.handRestPosition
      : plan.sourceColumns[activePickupIndex - 1]!.gripPosition;
    if (local < BET_CHOREOGRAPHY_TIMING.reachFractionOfPickup) {
      phase = "reach";
      phaseProgress = clamp01(local / BET_CHOREOGRAPHY_TIMING.reachFractionOfPickup);
      handPosition = lerpPoint(previous, source.gripPosition, ease(phaseProgress));
    } else {
      phase = "grasp";
      phaseProgress = clamp01(
        (local - BET_CHOREOGRAPHY_TIMING.reachFractionOfPickup)
          / (1 - BET_CHOREOGRAPHY_TIMING.reachFractionOfPickup),
      );
      handPosition = source.gripPosition;
    }
  } else if (t < BET_CHOREOGRAPHY_TIMING.transferEnd) {
    phase = "carry";
    phaseProgress = segment(
      t,
      BET_CHOREOGRAPHY_TIMING.gatherEnd,
      BET_CHOREOGRAPHY_TIMING.transferEnd,
    );
    const start = plan.sourceColumns[plan.sourceColumns.length - 1]!.gripPosition;
    handPosition = lerpPoint(start, plan.destinationHoverPosition, ease(phaseProgress));
    handPosition = withY(
      handPosition,
      handPosition[1] + Math.sin(Math.PI * phaseProgress) * BET_HAND_HOVER_CLEARANCE,
    );
  } else if (t < BET_CHOREOGRAPHY_TIMING.placeEnd) {
    phase = "place";
    phaseProgress = segment(
      t,
      BET_CHOREOGRAPHY_TIMING.transferEnd,
      BET_CHOREOGRAPHY_TIMING.placeEnd,
    );
    handPosition = lerpPoint(
      plan.destinationHoverPosition,
      plan.destinationGripPosition,
      ease(phaseProgress),
    );
  } else if (t < BET_CHOREOGRAPHY_TIMING.releaseEnd) {
    phase = "release";
    phaseProgress = segment(
      t,
      BET_CHOREOGRAPHY_TIMING.placeEnd,
      BET_CHOREOGRAPHY_TIMING.releaseEnd,
    );
    handPosition = lerpPoint(
      plan.destinationGripPosition,
      withY(plan.destinationGripPosition, plan.destinationGripPosition[1] + 0.018),
      ease(phaseProgress),
    );
  } else if (t < 1) {
    phase = "recover";
    phaseProgress = segment(t, BET_CHOREOGRAPHY_TIMING.releaseEnd, 1);
    const released = withY(
      plan.destinationGripPosition,
      plan.destinationGripPosition[1] + 0.018,
    );
    handPosition = lerpPoint(released, plan.handRestPosition, ease(phaseProgress));
  } else {
    phase = "settled";
    phaseProgress = 1;
    handPosition = plan.handRestPosition;
  }

  const released = t >= BET_CHOREOGRAPHY_TIMING.placeEnd;
  const pickedBefore = gathering ? activePickupIndex ?? 0 : plan.sourceColumns.length;
  const handContact: LeftHandContact = released
    ? "none"
    : phase === "grasp"
      ? "source-chips"
      : pickedBefore > 0 || !gathering
        ? "carried-chips"
        : "none";

  const chips = plan.chips.map((chip): BetChipFrame => {
    const source = plan.sourceColumns.find((candidate) => candidate.column === chip.sourceColumn)!;
    if (released) {
      return {
        ...chip,
        position: chip.destinationPosition,
        ownership: "wager",
        contact: chip.destinationHeight === 0 ? "felt" : "chip-below",
      };
    }

    if (gathering) {
      const alreadyPicked = source.pickupIndex < (activePickupIndex ?? 0);
      const active = source.pickupIndex === activePickupIndex;
      if (!alreadyPicked) {
        return {
          ...chip,
          position: chip.sourcePosition,
          ownership: "rack",
          contact: active && phase === "grasp" ? "rack-and-left-hand" : "rack",
          ...(active && phase === "grasp" ? { carrierAnchor: handPosition } : {}),
        };
      }
      return carriedChipFrame(chip, source, handPosition);
    }

    if (phase === "place") {
      const heldAtHover = heldChipPosition(chip, source, plan.destinationHoverPosition);
      return {
        ...chip,
        position: lerpPoint(heldAtHover, chip.destinationPosition, ease(phaseProgress)),
        ownership: "left-hand",
        contact: "left-hand",
        carrierAnchor: handPosition,
      };
    }

    return carriedChipFrame(chip, source, handPosition);
  });

  return {
    phase,
    phaseProgress,
    progress: t,
    ...(activePickupIndex === undefined
      ? {}
      : { activeSourceColumn: plan.sourceColumns[activePickupIndex]!.column }),
    hand: {
      side: "left",
      position: handPosition,
      contact: handContact,
      gripping: !released && (phase === "grasp" || pickedBefore > 0 || !gathering),
    },
    chips,
    released,
  };
}

function exactDenominationSelection(
  layout: ReturnType<typeof chipColumnLayoutForAmount>,
  amount: number,
): Map<number, number> {
  const available = new Map<number, number>();
  for (const column of layout) {
    available.set(column.denomination, (available.get(column.denomination) ?? 0) + column.count);
  }
  const denominations = [...available.keys()].sort((left, right) => right - left);
  const suffixValue = new Array<number>(denominations.length + 1).fill(0);
  for (let index = denominations.length - 1; index >= 0; index -= 1) {
    const denomination = denominations[index]!;
    suffixValue[index] = suffixValue[index + 1]! + denomination * available.get(denomination)!;
  }
  const memo = new Map<string, readonly number[] | null>();

  const search = (index: number, remaining: number): readonly number[] | undefined => {
    if (remaining === 0) return new Array(denominations.length - index).fill(0);
    if (index >= denominations.length || remaining < 0 || remaining > suffixValue[index]!) {
      return undefined;
    }
    const key = `${index}:${remaining}`;
    if (memo.has(key)) return memo.get(key) ?? undefined;
    const denomination = denominations[index]!;
    const count = available.get(denomination)!;
    const maximum = Math.min(count, Math.floor(remaining / denomination));
    const lowerValue = suffixValue[index + 1]!;
    const minimum = Math.max(0, Math.ceil((remaining - lowerValue) / denomination));
    for (let take = maximum; take >= minimum; take -= 1) {
      const tail = search(index + 1, remaining - take * denomination);
      if (tail) {
        const result = [take, ...tail] as const;
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return undefined;
  };

  const counts = search(0, amount);
  if (!counts) {
    throw new RangeError(
      `Rendered rack inventory cannot make wager ${amount} exactly; re-rack or make change before animating`,
    );
  }
  return new Map(denominations.map((denomination, index) => [denomination, counts[index] ?? 0]));
}

function destinationSlots(
  chips: readonly MutableSelectedChip[],
  baseHeight = 0,
): readonly Omit<SelectedWagerChip, "destinationPosition">[] {
  const ordered = [...chips].sort((left, right) =>
    left.denomination - right.denomination
      || left.sourceColumn - right.sourceColumn
      || left.sourceHeight - right.sourceHeight
  );
  // Racks remain denomination-pure and may spread across several columns. A
  // wager has a different spatial contract: every physical token must stay
  // inside the invisible 40 mm zone. Preserve deterministic low-to-high order
  // while stacking those exact selected chips into one compact vertical pile.
  return ordered.map((chip, destinationHeight) => ({
    ...chip,
    destinationColumn: 0,
    destinationHeight: baseHeight + destinationHeight,
  }));
}

function carriedChipFrame(
  chip: SelectedWagerChip,
  source: WagerSourceColumn,
  handPosition: BetPoint3,
): BetChipFrame {
  return {
    ...chip,
    position: heldChipPosition(chip, source, handPosition),
    ownership: "left-hand",
    contact: "left-hand",
    carrierAnchor: handPosition,
  };
}

function heldChipPosition(
  chip: SelectedWagerChip,
  source: WagerSourceColumn,
  handPosition: BetPoint3,
): BetPoint3 {
  return [
    handPosition[0],
    handPosition[1] + chip.sourcePosition[1] - source.gripPosition[1],
    handPosition[2],
  ];
}

function requireAmount(label: string, value: number, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  }
  return value;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function segment(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

function ease(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function lerpPoint(from: BetPoint3, to: BetPoint3, progress: number): BetPoint3 {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
    from[2] + (to[2] - from[2]) * progress,
  ];
}

function withY(point: BetPoint3, y: number): BetPoint3 {
  return [point[0], y, point[2]];
}

// Compile-time documentation: this should remain the midpoint of the existing
// authored constants unless the private-card zone itself changes.
export const OWNER_WAGER_LOCAL_FORWARD = BET_CIRCLE_FORWARD;
