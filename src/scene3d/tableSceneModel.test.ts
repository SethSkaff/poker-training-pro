/*
 * Object-motion and seat-local geometry for the scene model.
 *
 * The seating, camera, and plaque-framing contract moved to
 * `tableStations.test.ts` when the hero was seated at a real player station. The
 * open-arc assertions that used to live here described a composition where the
 * hero stood at the dealer's position, and no longer have a subject.
 */
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import {
  actionEase,
  awardChipPosition,
  allInChipPosition,
  betChipPosition,
  betCirclePosition,
  callChipPosition,
  chipInventoryForAmount,
  chipColumnLayoutForAmount,
  chipRackLayoutBounds,
  chipCountForAmount,
  committedAmountPosition,
  collectChipPosition,
  POT_POSITION,
  dealtCardPosition,
  holeCardDealProgress,
  muckedCardPosition,
  raiseChipPosition,
  restingChipStackPosition,
  stackAmountPosition,
  seatBetViewportAnchor,
  seatBetViewportAnchorFromCamera,
  seatStackAmountViewportAnchor,
  seatStackAmountViewportAnchorFromCamera,
  seatPlaqueViewportAnchor,
  cameraPose,
  TABLE_MARKER_GAP,
  TABLE_MARKER_RADIUS,
  tableMarkerPosition,
  seatLocalPoint,
  seatPoses,
  seatWorldPoint,
  TABLE_ANCHORS,
  TABLE_DEPTH,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  turnIndicatorPosition,
  BET_CIRCLE_FORWARD,
  CHIP_STACK_SAFE_RADIUS,
  CARD_ZONE_DEPTH,
  CARD_ZONE_WIDTH,
  CARD_ZONE_LOCAL_MIN_Z,
  CARD_ZONE_LOCAL_MAX_Z,
  CARD_ZONE_LOCAL_CENTER_Z,
  CARD_ZONE_OBJECT_GAP,
  BET_CIRCLE_RADIUS,
  STACK_AMOUNT_OUTWARD_GAP,
  CHIP_STACK_LOCAL_LEFT_SIDE,
  STACK_LABEL_HALF_DEPTH,
  STACK_LABEL_HALF_WIDTH,
  turnIndicatorPositionForPlayer,
  seatOccupancyLayout,
} from "./tableSceneModel";

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("physical chip inventories", () => {
  it("decomposes every visible balance into exact tournament denominations", () => {
    for (const amount of [0, 1, 25, 50, 125, 400, 975, 2_550, 13_425, 84_321]) {
      const inventory = chipInventoryForAmount(amount);
      expect(inventory.reduce((total, chip) => total + chip, 0)).toBe(amount);
    }
  });

  it("does not invent a coloured stack when a bet leaves a real rack", () => {
    const before = 1_000;
    const wager = 150;
    const after = before - wager;
    expect(chipInventoryForAmount(after).reduce((total, chip) => total + chip, 0)
      + chipInventoryForAmount(wager).reduce((total, chip) => total + chip, 0)).toBe(before);
  });
});

describe("seat-local placement lands objects on the felt", () => {
  /**
   * Mirrors three.js `rotation.y = facing` exactly: local -> world is
   * `wx = cos·lx + sin·lz`, `wz = -sin·lx + cos·lz`. If the renderer's inverse
   * disagrees with this, seat objects leave the table.
   */
  const rotateAsThreeJs = (
    pose: ReturnType<typeof seatPoses>[number],
    local: readonly [number, number, number],
  ): readonly [number, number, number] => {
    const cos = Math.cos(pose.facing);
    const sin = Math.sin(pose.facing);
    return [
      pose.position[0] + local[0] * cos + local[2] * sin,
      local[1],
      pose.position[2] - local[0] * sin + local[2] * cos,
    ];
  };

  it("round-trips every seat's felt anchor through the group transform", () => {
    for (const pose of seatPoses(6)) {
      const local = seatLocalPoint(pose, pose.feltPosition);
      expect(distance(rotateAsThreeJs(pose, local), pose.feltPosition)).toBeLessThan(1e-9);
    }
  });

  it("agrees with the forward map it claims to invert", () => {
    for (const pose of seatPoses(6)) {
      const local = seatLocalPoint(pose, pose.feltPosition);
      expect(distance(seatWorldPoint(pose, local), pose.feltPosition)).toBeLessThan(1e-9);
      expect(distance(rotateAsThreeJs(pose, local), seatWorldPoint(pose, local)))
        .toBeLessThan(1e-9);
    }
  });

  /*
   * The regression this guards: using cos(-facing)/sin(-facing) re-applies the
   * forward rotation, which threw the near-side seats' cards, bet, and stack
   * about a metre past the rail and off the table entirely.
   */
  it("keeps every seat's placed objects inside the outer rail", () => {
    const outerHalfWidth = TABLE_WIDTH / 2 + 0.12;
    const outerHalfDepth = TABLE_DEPTH / 2 + 0.12;
    for (const pose of seatPoses(6)) {
      if (pose.seat === 0) continue;
      for (const anchor of [
        pose.feltPosition,
        [pose.feltPosition[0] * 0.86, TABLE_HEIGHT, pose.feltPosition[2] * 0.86] as const,
      ]) {
        const placed = seatWorldPoint(pose, seatLocalPoint(pose, anchor));
        expect(Math.abs(placed[0])).toBeLessThanOrEqual(outerHalfWidth);
        expect(Math.abs(placed[2])).toBeLessThanOrEqual(outerHalfDepth);
      }
    }
  });
});

describe("objects travel between real places", () => {
  const pose = seatPoses(6)[2];

  it("eases in and out rather than snapping", () => {
    expect(actionEase(0)).toBe(0);
    expect(actionEase(1)).toBe(1);
    expect(actionEase(0.5)).toBeCloseTo(0.5, 6);
    // Slow at the ends.
    expect(actionEase(0.1)).toBeLessThan(0.1);
    expect(actionEase(0.9)).toBeGreaterThan(0.9);
  });

  it("clamps progress outside 0..1 so a late frame cannot overshoot", () => {
    expect(actionEase(-5)).toBe(0);
    expect(actionEase(5)).toBe(1);
  });

  /*
    A wager stops on its owner's betting line. It used to run all the way to the
    middle of the felt, and the renderer drew an idle bet at progress 1 -- so
    every live wager on the table sat in one heap at the centre and the six
    printed bet circles the felt carries were never used. Only the dealer's
    sweep reaches the pot.
  */
  it("pushes a bet from the seat out to its own betting line", () => {
    const start = betChipPosition(pose, 0);
    const end = betChipPosition(pose, 1);
    expect(start).toEqual(restingChipStackPosition(pose));
    expect(end).toEqual(betCirclePosition(pose));
    // Still in front of its owner, nowhere near the middle of the table.
    expect(Math.hypot(end[0], end[2])).toBeGreaterThan(0.3);
    // Lifts off the felt on the way and lands back on it.
    expect(betChipPosition(pose, 0.5)[1]).toBeGreaterThan(pose.feltPosition[1]);
    expect(end[1]).toBeCloseTo(pose.feltPosition[1], 6);
  });

  it("sweeps a collected bet from the betting line into the pot", () => {
    const start = collectChipPosition(pose, 0);
    const end = collectChipPosition(pose, 1);
    expect(start).toEqual(betCirclePosition(pose));
    expect(end[0]).toBeCloseTo(POT_POSITION[0], 6);
    expect(end[2]).toBeCloseTo(POT_POSITION[2], 6);
  });

  it("gives calls, bets, raises, and all-ins distinct public chip trajectories", () => {
    const start = restingChipStackPosition(pose);
    const end = betChipPosition(pose, 1);
    for (const position of [callChipPosition(pose, 0), raiseChipPosition(pose, 0), allInChipPosition(pose, 0)]) {
      expect(position[0]).toBeCloseTo(start[0], 6);
      expect(position[2]).toBeCloseTo(start[2], 6);
    }
    for (const position of [callChipPosition(pose, 1), raiseChipPosition(pose, 1), allInChipPosition(pose, 1)]) {
      expect(position).toEqual(end);
    }
    expect(distance(callChipPosition(pose, 0.5), betChipPosition(pose, 0.5))).toBeGreaterThan(0.01);
    expect(distance(raiseChipPosition(pose, 0.5), betChipPosition(pose, 0.5))).toBeGreaterThan(0.04);
    expect(allInChipPosition(pose, 0.5)[1]).toBeGreaterThan(betChipPosition(pose, 0.5)[1]);
  });

  it("deals a card from the dealer to the seat", () => {
    const end = dealtCardPosition(pose, 1);
    expect(end[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(end[2]).toBeCloseTo(pose.feltPosition[2], 6);
    // It arrives somewhere different from where it began.
    expect(distance(dealtCardPosition(pose, 0), end)).toBeGreaterThan(0.2);
  });

  it("deals hole cards in clockwise first-card/second-card passes", () => {
    const firstSeatFirstCard = holeCardDealProgress(0.10, 0, 0, 3);
    const secondSeatFirstCard = holeCardDealProgress(0.10, 1, 0, 3);
    const firstSeatSecondCard = holeCardDealProgress(0.10, 0, 1, 3);
    expect(firstSeatFirstCard).toBeGreaterThan(0);
    expect(secondSeatFirstCard).toBe(0);
    expect(firstSeatSecondCard).toBe(0);
    expect(holeCardDealProgress(1, 2, 1, 3)).toBe(1);
  });

  it("pushes an awarded pot from the center to the winner's rack", () => {
    const start = awardChipPosition(pose, 0);
    const end = awardChipPosition(pose, 1);
    expect(start).toEqual(POT_POSITION);
    const rack = restingChipStackPosition(pose);
    expect(end[0]).toBeCloseTo(rack[0], 10);
    expect(end[2]).toBeCloseTo(rack[2], 10);
    expect(awardChipPosition(pose, 0.5)[1]).toBeGreaterThan(TABLE_HEIGHT);
  });

  it("holds the recipient card at the dealer's hand through the visible pickup", () => {
    expect(dealtCardPosition(pose, 0.15)).toEqual(dealtCardPosition(pose, 0));
    expect(dealtCardPosition(pose, 0)).toEqual(TABLE_ANCHORS.dealerThrow);
    expect(distance(dealtCardPosition(pose, 0.55), dealtCardPosition(pose, 0))).toBeGreaterThan(0.02);
  });

  it("releases the flight from the dealer's hand rather than keeping a shoe-origin arc", () => {
    const held = dealtCardPosition(pose, 0.15);
    const released = dealtCardPosition(pose, 0.23);
    const shoe = TABLE_ANCHORS.dealerShoe;
    // The in-hand beat is parked at the throwing hand while the separate held
    // mesh is still visibly attached to the dealer's arm.
    expect(held).toEqual(TABLE_ANCHORS.dealerThrow);
    // Once it leaves, its source has moved inward with the dealer's hand.
    expect(released[0]).toBeLessThan(shoe[0] - 0.05);
    expect(released[1]).toBeGreaterThan(shoe[1]);
  });

  it("sends a folded card away from the seat toward the muck", () => {
    const start = muckedCardPosition(pose, 0);
    const end = muckedCardPosition(pose, 1);
    expect(start[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(end[0]).toBeCloseTo(TABLE_ANCHORS.muck[0], 6);
    expect(end[2]).toBeCloseTo(TABLE_ANCHORS.muck[2], 6);
    // A fold has to read as the cards leaving, not vanishing.
    expect(distance(start, end)).toBeGreaterThan(0.2);
  });

  it("lands reduced motion on exactly the same end state as full motion", () => {
    // The reduced-motion path jumps straight to progress 1; it must agree with
    // where the animated path finishes, or the two renderings disagree about
    // where the chips are.
    for (const seat of seatPoses(6)) {
      expect(betChipPosition(seat, 1)).toEqual(betChipPosition(seat, 1));
      expect(dealtCardPosition(seat, 1)).toEqual(dealtCardPosition(seat, 1));
      expect(muckedCardPosition(seat, 1)).toEqual(muckedCardPosition(seat, 1));
    }
  });
});

describe("the current-turn indicator", () => {
  /*
   * This cue has moved twice, and the reasons are worth keeping.
   *
   * At the chair at table height it rendered *inside* the acting player's torso --
   * a gold band sliced across the body. At floor level around the chair it is
   * hidden behind the table at the seated gaze. On the felt at that player's own
   * betting lane it is unambiguously theirs and always visible, which is also
   * where a dealer's attention goes.
   */
  it("marks the actor on their own felt lane, on the playing surface", () => {
    for (const pose of seatPoses(6)) {
      const indicator = turnIndicatorPosition(pose);

      /*
        That player's lane, not the chair and not the table centre -- and
        specifically on the bet circle printed in front of them, which is a
        short step from the lane origin *toward the middle of the table*. The
        cue is the felt's own printed circle lighting up rather than a ring
        drawn around the actor's hole cards.
      */
      const lane = Math.hypot(pose.feltPosition[0], pose.feltPosition[2]);
      const cue = Math.hypot(indicator[0], indicator[2]);
      expect(cue).toBeLessThan(lane);
      expect(Math.hypot(
        indicator[0] - pose.feltPosition[0],
        indicator[2] - pose.feltPosition[2],
      )).toBeCloseTo(BET_CIRCLE_FORWARD, 6);
      // Resting on the felt: above the surface, but only just, so it reads as a
      // marking on the cloth rather than an object floating over it.
      expect(indicator[1]).toBeGreaterThan(TABLE_HEIGHT);
      expect(indicator[1]).toBeLessThan(TABLE_HEIGHT + 0.02);
      // Inside the playing surface, so it can never be clipped by the rail.
      expect(Math.abs(indicator[0])).toBeLessThan(TABLE_WIDTH / 2);
      expect(Math.abs(indicator[2])).toBeLessThan(TABLE_DEPTH / 2);
      expect(indicator).toEqual(turnIndicatorPosition(pose));
    }
  });

  it("gives each seat a distinct lane so the cue identifies one player", () => {
    const marks = seatPoses(6).map((pose) => turnIndicatorPosition(pose));
    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) {
        expect(distance(marks[i], marks[j])).toBeGreaterThan(BET_CIRCLE_RADIUS * 2 + 0.01);
      }
    }
  });

  it("follows a surviving actor's stable chair after an earlier seat leaves", () => {
    const poses = seatPoses(6);
    const byPlayer = new Map([
      ["hero", poses[0]],
      ["departing", poses[1]],
      ["surviving-actor", poses[2]],
    ]);

    // Scene snapshots compact their public `seat` numbers after an out player,
    // but the renderer deliberately retains each survivor's physical chair.
    byPlayer.delete("departing");
    expect(turnIndicatorPositionForPlayer("surviving-actor", (id) => byPlayer.get(id)))
      .toEqual(turnIndicatorPosition(poses[2]));
    expect(turnIndicatorPositionForPlayer("missing", (id) => byPlayer.get(id))).toBeUndefined();
  });
});

describe("six-player tournament lanes", () => {
  it("gives each player one straight card rectangle and a separate inward wager circle", () => {
    const poses = seatPoses(6);
    for (const pose of poses) {
      const circle = betCirclePosition(pose);
      const toCentre = Math.hypot(pose.feltPosition[0], pose.feltPosition[2]);
      expect(Math.hypot(circle[0], circle[2]), `seat ${pose.seat} wager direction`)
        .toBeLessThan(toCentre);
      // The circular wager mark starts beyond the card rectangle rather than
      // cutting through it, so the two marks remain legible at every seat.
      expect(BET_CIRCLE_FORWARD - BET_CIRCLE_RADIUS)
        .toBeGreaterThan(CARD_ZONE_DEPTH / 2);
      expect(CARD_ZONE_WIDTH).toBeGreaterThan(0.22);
    }
  });

  it("keeps all six printed player lanes physically separated", () => {
    const poses = seatPoses(6);
    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        const firstCardInSecondFrame = seatLocalPoint(poses[j], poses[i].feltPosition);
        const secondCard = seatLocalPoint(poses[j], poses[j].feltPosition);
        // Exact oriented card rectangles, not a conservative enclosing disc.
        expect(
          Math.abs(firstCardInSecondFrame[0] - secondCard[0]) >= CARD_ZONE_WIDTH
          || Math.abs(firstCardInSecondFrame[2] - secondCard[2]) >= CARD_ZONE_DEPTH,
          `card lanes ${i}/${j}`,
        ).toBe(true);
        expect(distance(betCirclePosition(poses[i]), betCirclePosition(poses[j])), `wagers ${i}/${j}`)
          .toBeGreaterThan(BET_CIRCLE_RADIUS * 2);
      }
    }
  });

  it("keeps each seat's card, wager, and turn cue on the same station bearing", () => {
    for (const pose of seatPoses(6)) {
      const circle = betCirclePosition(pose);
      const cue = turnIndicatorPosition(pose);
      expect(cue[0]).toBeCloseTo(circle[0], 6);
      expect(cue[2]).toBeCloseTo(circle[2], 6);
      // The destination from the motion model is the printed wager mark, not
      // a neighbouring lane or the central pot.
      expect(betChipPosition(pose, 1)).toEqual(circle);
    }
  });
});

describe("chip stacks read as depth without unbounded geometry", () => {
  it("draws nothing for an empty stack", () => {
    expect(chipCountForAmount(0)).toBe(0);
    expect(chipCountForAmount(-10)).toBe(0);
  });

  it("grows with the amount but stays bounded", () => {
    expect(chipCountForAmount(50)).toBeGreaterThan(0);
    expect(chipCountForAmount(15_000)).toBeGreaterThan(chipCountForAmount(500));
    expect(chipCountForAmount(1_000_000_000)).toBe(chipInventoryForAmount(1_000_000_000).length);
  });

  it("never returns a fractional chip", () => {
    for (const amount of [1, 7, 99, 12_345, 987_654]) {
      expect(Number.isInteger(chipCountForAmount(amount))).toBe(true);
    }
  });
});

describe("resting chip stacks stay in their owner's safe play lane", () => {
  const insideSafeFelt = (point: readonly [number, number, number]) => {
    const straightHalfLength = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
    const centreX = Math.min(straightHalfLength, Math.max(-straightHalfLength, point[0]));
    // `point` is already an actual outer rack corner; subtracting the old
    // whole-rack proxy a second time rejects valid geometry near the rail.
    return Math.hypot(point[0] - centreX, point[2]) <= TABLE_DEPTH / 2 - 0.008 + 1e-9;
  };

  it("keeps every full rack footprint clear of the rail at every player seat", () => {
    for (const pose of seatPoses(6)) {
      const layout = seatOccupancyLayout(pose, 15_000);
      const stack = seatLocalPoint(pose, layout.rackOrigin);
      for (const x of [layout.rackBounds.minX, layout.rackBounds.maxX]) {
        for (const z of [layout.rackBounds.minZ, layout.rackBounds.maxZ]) {
          const corner = seatWorldPoint(pose, [stack[0] + x, TABLE_HEIGHT, stack[2] + z]);
          expect(insideSafeFelt(corner), `seat ${pose.seat} rack corner`).toBe(true);
        }
      }
    }
  });

  it("keeps each rack outside every neighbour's protected card rectangle", () => {
    const poses = seatPoses(6);
    for (const pose of poses) {
      const layout = seatOccupancyLayout(pose, 15_000);
      const stack = seatLocalPoint(pose, layout.rackOrigin);
      const rackCorners = [
        [layout.rackBounds.minX, layout.rackBounds.minZ],
        [layout.rackBounds.minX, layout.rackBounds.maxZ],
        [layout.rackBounds.maxX, layout.rackBounds.minZ],
        [layout.rackBounds.maxX, layout.rackBounds.maxZ],
      ].map(([x, z]) => seatWorldPoint(pose, [stack[0] + x, TABLE_HEIGHT, stack[2] + z]));
      for (const other of poses) {
        if (other.seat === pose.seat) continue;
        const otherCard = seatLocalPoint(other, other.feltPosition);
        for (const corner of rackCorners) {
          const local = seatLocalPoint(other, corner);
          expect(
            Math.abs(local[0] - otherCard[0]) >= CARD_ZONE_WIDTH / 2
            || local[2] <= otherCard[2] + CARD_ZONE_LOCAL_MIN_Z
            || local[2] >= otherCard[2] + CARD_ZONE_LOCAL_MAX_Z,
            `rack ${pose.seat} corner in card lane ${other.seat}`,
          ).toBe(true);
        }
      }
    }
  });

  it("leaves the owner's committed chips on their separate betting circle", () => {
    for (const pose of seatPoses(6)) {
      const stack = restingChipStackPosition(pose);
      const bet = betCirclePosition(pose);
      expect(distance(stack, bet), `seat ${pose.seat}`).toBeGreaterThan(0.07);
      expect(bet).toEqual(betChipPosition(pose, 1));
    }
  });
});

describe("protected seat occupancy", () => {
  const rectsOverlap = (
    left: { minX: number; maxX: number; minZ: number; maxZ: number },
    right: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) => left.minX < right.maxX && left.maxX > right.minX
    && left.minZ < right.maxZ && left.maxZ > right.minZ;
  const circleOverlapsRect = (
    circle: { x: number; z: number; radius: number },
    rect: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) => {
    const x = Math.max(rect.minX, Math.min(rect.maxX, circle.x));
    const z = Math.max(rect.minZ, Math.min(rect.maxZ, circle.z));
    return Math.hypot(circle.x - x, circle.z - z) < circle.radius;
  };
  type TablePoint = readonly [number, number];
  const tablePoints = (
    corners: readonly (readonly [number, number, number])[],
  ): readonly TablePoint[] => corners.map(([x, , z]) => [x, z]);
  const polygonAxes = (polygon: readonly TablePoint[]) => polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const edgeX = next[0] - point[0];
    const edgeZ = next[1] - point[1];
    return [-edgeZ, edgeX] as const;
  });
  const polygonsOverlap = (left: readonly TablePoint[], right: readonly TablePoint[]) => {
    for (const [axisX, axisZ] of [...polygonAxes(left), ...polygonAxes(right)]) {
      const leftProjection = left.map(([x, z]) => x * axisX + z * axisZ);
      const rightProjection = right.map(([x, z]) => x * axisX + z * axisZ);
      if (Math.max(...leftProjection) <= Math.min(...rightProjection)
        || Math.max(...rightProjection) <= Math.min(...leftProjection)) {
        return false;
      }
    }
    return true;
  };
  const distanceToSegment = (point: TablePoint, start: TablePoint, end: TablePoint) => {
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const lengthSquared = dx * dx + dz * dz;
    const progress = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared));
    return Math.hypot(point[0] - (start[0] + progress * dx), point[1] - (start[1] + progress * dz));
  };
  const circleOverlapsPolygon = (
    circle: { centre: TablePoint; radius: number },
    polygon: readonly TablePoint[],
  ) => polygon.some((point, index) => distanceToSegment(
    circle.centre,
    point,
    polygon[(index + 1) % polygon.length],
  ) < circle.radius) || (() => {
    const signs = polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return (next[0] - point[0]) * (circle.centre[1] - point[1])
        - (next[1] - point[1]) * (circle.centre[0] - point[0]);
    });
    return signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0);
  })();
  const rackWorldCorners = (
    pose: ReturnType<typeof seatPoses>[number],
    layout: ReturnType<typeof seatOccupancyLayout>,
  ) => {
    const rack = seatLocalPoint(pose, layout.rackOrigin);
    return [
      [layout.rackBounds.minX, layout.rackBounds.minZ],
      [layout.rackBounds.maxX, layout.rackBounds.minZ],
      [layout.rackBounds.maxX, layout.rackBounds.maxZ],
      [layout.rackBounds.minX, layout.rackBounds.maxZ],
    ].map(([x, z]) => seatWorldPoint(pose, [rack[0] + x, TABLE_HEIGHT, rack[2] + z]));
  };
  const labelWorldCorners = (
    pose: ReturnType<typeof seatPoses>[number],
    layout: ReturnType<typeof seatOccupancyLayout>,
  ) => {
    const label = seatLocalPoint(pose, layout.stackLabel);
    return [
      [label[0] - STACK_LABEL_HALF_WIDTH, label[2] - STACK_LABEL_HALF_DEPTH],
      [label[0] + STACK_LABEL_HALF_WIDTH, label[2] - STACK_LABEL_HALF_DEPTH],
      [label[0] + STACK_LABEL_HALF_WIDTH, label[2] + STACK_LABEL_HALF_DEPTH],
      [label[0] - STACK_LABEL_HALF_WIDTH, label[2] + STACK_LABEL_HALF_DEPTH],
    ].map(([x, z]) => seatWorldPoint(pose, [x, TABLE_HEIGHT, z]));
  };
  const cardWorldCorners = (pose: ReturnType<typeof seatPoses>[number]) => {
    const card = seatLocalPoint(pose, pose.feltPosition);
    return [
      [card[0] - CARD_ZONE_WIDTH / 2, card[2] + CARD_ZONE_LOCAL_MIN_Z],
      [card[0] + CARD_ZONE_WIDTH / 2, card[2] + CARD_ZONE_LOCAL_MIN_Z],
      [card[0] + CARD_ZONE_WIDTH / 2, card[2] + CARD_ZONE_LOCAL_MAX_Z],
      [card[0] - CARD_ZONE_WIDTH / 2, card[2] + CARD_ZONE_LOCAL_MAX_Z],
    ].map(([x, z]) => seatWorldPoint(pose, [x, TABLE_HEIGHT, z]));
  };

  it("prefers a collision-free rack rail-side and on the player's left", () => {
    // This representative side seat has enough felt for the preferred semantic
    // slot even for the widest authored rack. Tight end seats are intentionally
    // allowed to choose a collision fallback rather than clip a neighbouring
    // card lane; the six-seat matrix below proves those fallbacks stay safe.
    const pose = seatPoses(6)[3];
    const card = seatLocalPoint(pose, pose.feltPosition);
    const cardCentreZ = card[2] + (CARD_ZONE_LOCAL_MIN_Z + CARD_ZONE_LOCAL_MAX_Z) / 2;
    for (const amount of [25, 150, 14_950, 15_000, 45_000, 90_000]) {
      const layout = seatOccupancyLayout(pose, amount);
      const rack = seatLocalPoint(pose, layout.rackOrigin);
      expect(layout.rackSide, `seat ${pose.seat} amount ${amount}`).toBe(CHIP_STACK_LOCAL_LEFT_SIDE);
      expect(rack[0], `seat ${pose.seat} amount ${amount} left of cards`).toBeGreaterThan(card[0]);
      expect(rack[2], `seat ${pose.seat} amount ${amount} rail-side of cards`).toBeLessThan(cardCentreZ);
    }
  });

  it("uses one rigid rack, cards, marker, wager depth order at all six seats", () => {
    for (const pose of seatPoses(6)) {
      const card = seatLocalPoint(pose, pose.feltPosition);
      const layout = seatOccupancyLayout(pose, 15_000);
      const rack = seatLocalPoint(pose, layout.rackOrigin);
      const wager = seatLocalPoint(pose, layout.wager);
      const marker = seatLocalPoint(pose, tableMarkerPosition(pose, "D", 15_000));

      expect(rack[0], `seat ${pose.seat} rack player-left`).toBeGreaterThan(card[0]);
      expect(rack[2], `seat ${pose.seat} rack closest to rail`).toBeLessThan(
        card[2] + CARD_ZONE_LOCAL_CENTER_Z,
      );
      expect(wager[2], `seat ${pose.seat} bet beyond cards`).toBeGreaterThan(
        card[2] + CARD_ZONE_LOCAL_MAX_Z,
      );
      expect(marker[2], `seat ${pose.seat} marker beyond cards`).toBeGreaterThan(
        card[2] + CARD_ZONE_LOCAL_MAX_Z,
      );
      expect(Math.abs(marker[0] - wager[0]), `seat ${pose.seat} marker beside bet`)
        .toBeCloseTo(BET_CIRCLE_RADIUS + TABLE_MARKER_RADIUS + TABLE_MARKER_GAP, 9);
    }
  });

  it("keeps cards, full racks, markers, wagers, and labels disjoint after final placement", () => {
    for (const amount of [25, 150, 14_950, 15_000, 45_000, 90_000]) {
      const poses = seatPoses(6);
      const layouts = poses.map((pose) => seatOccupancyLayout(pose, amount));
      for (const [poseIndex, pose] of poses.entries()) {
        const layout = layouts[poseIndex];
        const card = seatLocalPoint(pose, pose.feltPosition);
        const rack = seatLocalPoint(pose, layout.rackOrigin);
        const label = seatLocalPoint(pose, layout.stackLabel);
        const wager = seatLocalPoint(pose, layout.wager);
        const cardRect = {
          minX: card[0] - CARD_ZONE_WIDTH / 2,
          maxX: card[0] + CARD_ZONE_WIDTH / 2,
          minZ: card[2] + CARD_ZONE_LOCAL_MIN_Z,
          maxZ: card[2] + CARD_ZONE_LOCAL_MAX_Z,
        };
        const rackRect = {
          minX: rack[0] + layout.rackBounds.minX,
          maxX: rack[0] + layout.rackBounds.maxX,
          minZ: rack[2] + layout.rackBounds.minZ,
          maxZ: rack[2] + layout.rackBounds.maxZ,
        };
        const labelRect = { minX: label[0] - STACK_LABEL_HALF_WIDTH, maxX: label[0] + STACK_LABEL_HALF_WIDTH, minZ: label[2] - STACK_LABEL_HALF_DEPTH, maxZ: label[2] + STACK_LABEL_HALF_DEPTH };
        expect(rectsOverlap(cardRect, rackRect), `seat ${pose.seat} amount ${amount} card/rack`).toBe(false);
        expect(rectsOverlap(cardRect, labelRect), `seat ${pose.seat} amount ${amount} card/label`).toBe(false);
        expect(rectsOverlap(rackRect, labelRect), `seat ${pose.seat} amount ${amount} rack/label`).toBe(false);
        expect(circleOverlapsRect({ x: wager[0], z: wager[2], radius: BET_CIRCLE_RADIUS }, cardRect), `seat ${pose.seat} wager/card`).toBe(false);
        expect(circleOverlapsRect({ x: wager[0], z: wager[2], radius: BET_CIRCLE_RADIUS }, rackRect), `seat ${pose.seat} wager/rack`).toBe(false);
        for (const markerLabel of ["D", "SB", "BB"] as const) {
          const marker = seatLocalPoint(pose, tableMarkerPosition(pose, markerLabel, amount));
          const circle = { x: marker[0], z: marker[2], radius: TABLE_MARKER_RADIUS };
          expect(circleOverlapsRect(circle, cardRect), `seat ${pose.seat} ${markerLabel}/card`).toBe(false);
          expect(circleOverlapsRect(circle, rackRect), `seat ${pose.seat} ${markerLabel}/rack`).toBe(false);
          expect(circleOverlapsRect(circle, labelRect), `seat ${pose.seat} ${markerLabel}/label`).toBe(false);
          expect(Math.hypot(marker[0] - wager[0], marker[2] - wager[2]), `seat ${pose.seat} ${markerLabel}/wager`)
            .toBeGreaterThanOrEqual(TABLE_MARKER_RADIUS + BET_CIRCLE_RADIUS);
        }
        expect(Math.abs(rackRect.minX - cardRect.maxX) >= CARD_ZONE_OBJECT_GAP
          || Math.abs(cardRect.minX - rackRect.maxX) >= CARD_ZONE_OBJECT_GAP).toBe(true);
      }
      for (let first = 0; first < poses.length; first += 1) {
        for (let second = first + 1; second < poses.length; second += 1) {
          const firstRack = tablePoints(rackWorldCorners(poses[first], layouts[first]));
          const firstLabel = tablePoints(labelWorldCorners(poses[first], layouts[first]));
          const secondRack = tablePoints(rackWorldCorners(poses[second], layouts[second]));
          const secondLabel = tablePoints(labelWorldCorners(poses[second], layouts[second]));
          const firstCard = tablePoints(cardWorldCorners(poses[first]));
          const secondCard = tablePoints(cardWorldCorners(poses[second]));
          expect(polygonsOverlap(firstRack, secondCard), `${amount} rack ${first}/card ${second}`).toBe(false);
          expect(polygonsOverlap(firstLabel, secondCard), `${amount} label ${first}/card ${second}`).toBe(false);
          expect(polygonsOverlap(secondRack, firstCard), `${amount} rack ${second}/card ${first}`).toBe(false);
          expect(polygonsOverlap(secondLabel, firstCard), `${amount} label ${second}/card ${first}`).toBe(false);
          expect(polygonsOverlap(firstRack, secondRack), `${amount} rack ${first}/rack ${second}`).toBe(false);
          expect(polygonsOverlap(firstRack, secondLabel), `${amount} rack ${first}/label ${second}`).toBe(false);
          expect(polygonsOverlap(firstLabel, secondRack), `${amount} label ${first}/rack ${second}`).toBe(false);
          expect(polygonsOverlap(firstLabel, secondLabel), `${amount} label ${first}/label ${second}`).toBe(false);
          const secondWager = tablePoints([betCirclePosition(poses[second])])[0];
          const firstWager = tablePoints([betCirclePosition(poses[first])])[0];
          expect(circleOverlapsPolygon({ centre: secondWager, radius: BET_CIRCLE_RADIUS }, firstRack), `${amount} wager ${second}/rack ${first}`).toBe(false);
          expect(circleOverlapsPolygon({ centre: secondWager, radius: BET_CIRCLE_RADIUS }, firstLabel), `${amount} wager ${second}/label ${first}`).toBe(false);
          expect(circleOverlapsPolygon({ centre: firstWager, radius: BET_CIRCLE_RADIUS }, secondRack), `${amount} wager ${first}/rack ${second}`).toBe(false);
          expect(circleOverlapsPolygon({ centre: firstWager, radius: BET_CIRCLE_RADIUS }, secondLabel), `${amount} wager ${first}/label ${second}`).toBe(false);
          for (const markerLabel of ["D", "SB", "BB"] as const) {
            const firstMarker = tablePoints([tableMarkerPosition(poses[first], markerLabel, amount)])[0];
            const secondMarker = tablePoints([tableMarkerPosition(poses[second], markerLabel, amount)])[0];
            expect(circleOverlapsPolygon({ centre: firstMarker, radius: TABLE_MARKER_RADIUS }, secondRack), `${amount} marker ${first}/rack ${second}`).toBe(false);
            expect(circleOverlapsPolygon({ centre: firstMarker, radius: TABLE_MARKER_RADIUS }, secondLabel), `${amount} marker ${first}/label ${second}`).toBe(false);
            expect(circleOverlapsPolygon({ centre: secondMarker, radius: TABLE_MARKER_RADIUS }, firstRack), `${amount} marker ${second}/rack ${first}`).toBe(false);
            expect(circleOverlapsPolygon({ centre: secondMarker, radius: TABLE_MARKER_RADIUS }, firstLabel), `${amount} marker ${second}/label ${first}`).toBe(false);
          }
        }
      }
    }
  });

  it("uses the same protected printed-zone solver for every authored Training stack", () => {
    const trainingAmounts = [...new Set(trainingScenarios.flatMap((scenario) =>
      scenario.players.flatMap((player) => [player.stack, player.bet ?? 0]),
    ))].filter((amount) => amount > 0);
    for (const scenario of trainingScenarios) {
      const hero = scenario.players.find((player) => player.seat === scenario.heroSeat);
      expect(hero, scenario.id).toBeDefined();
      for (const pose of seatPoses(6)) {
        for (const amount of trainingAmounts) {
          const layout = seatOccupancyLayout(pose, amount);
          const card = seatLocalPoint(pose, pose.feltPosition);
          const rack = seatLocalPoint(pose, layout.rackOrigin);
          const cardRect = {
            minX: card[0] - CARD_ZONE_WIDTH / 2,
            maxX: card[0] + CARD_ZONE_WIDTH / 2,
            minZ: card[2] + CARD_ZONE_LOCAL_MIN_Z,
            maxZ: card[2] + CARD_ZONE_LOCAL_MAX_Z,
          };
          const rackRect = {
            minX: rack[0] + layout.rackBounds.minX,
            maxX: rack[0] + layout.rackBounds.maxX,
            minZ: rack[2] + layout.rackBounds.minZ,
            maxZ: rack[2] + layout.rackBounds.maxZ,
          };
          const label = seatLocalPoint(pose, layout.stackLabel);
          const labelRect = {
            minX: label[0] - STACK_LABEL_HALF_WIDTH,
            maxX: label[0] + STACK_LABEL_HALF_WIDTH,
            minZ: label[2] - STACK_LABEL_HALF_DEPTH,
            maxZ: label[2] + STACK_LABEL_HALF_DEPTH,
          };
          expect(rectsOverlap(cardRect, rackRect), `${scenario.id} seat ${pose.seat} stack ${amount}`).toBe(false);
          expect(rectsOverlap(cardRect, labelRect), `${scenario.id} seat ${pose.seat} label ${amount}`).toBe(false);
          expect(rectsOverlap(rackRect, labelRect), `${scenario.id} seat ${pose.seat} rack/label ${amount}`).toBe(false);
        }
      }
    }
  });
});

describe("dealer and blind markers", () => {
  it("sit beside their owner's wager, clear of cards and the chip rack", () => {
    for (const pose of seatPoses(6)) {
      const stack = restingChipStackPosition(pose);
      const marker = tableMarkerPosition(pose);
      const wager = betCirclePosition(pose);
      const gap = distance(marker, stack);
      expect(gap, `seat ${pose.seat}`).toBeGreaterThanOrEqual(0.2);
      expect(distance(marker, wager)).toBeGreaterThanOrEqual(
        TABLE_MARKER_RADIUS + BET_CIRCLE_RADIUS + TABLE_MARKER_GAP,
      );
    }
  });

  it("keeps numeric anchors attached to the represented rack and betting circle", () => {
    for (const pose of seatPoses(6)) {
      const stack = stackAmountPosition(pose);
      const bet = committedAmountPosition(pose);
      const bounds = chipRackLayoutBounds(15_000);
      expect(Math.hypot(stack[0] - restingChipStackPosition(pose)[0], stack[2] - restingChipStackPosition(pose)[2])).toBeCloseTo(Math.abs(bounds.minZ - STACK_AMOUNT_OUTWARD_GAP), 8);
      expect(Math.hypot(bet[0] - betCirclePosition(pose)[0], bet[2] - betCirclePosition(pose)[2])).toBeCloseTo(0.04, 8);
      expect(stack[1]).toBeCloseTo(TABLE_HEIGHT + 0.002, 8);
      expect(bet[1]).toBeCloseTo(TABLE_HEIGHT + 0.006, 8);
    }
  });

  it("keeps every rendered rack column denomination-pure and exact", () => {
    for (const amount of [25, 150, 1_800, 14_950, 84_321]) {
      const columns = chipColumnLayoutForAmount(amount, 8);
      expect(columns.reduce((total, column) => total + column.denomination * column.count, 0)).toBe(amount);
      expect(columns.every((column) => column.count > 0 && column.count <= 8)).toBe(true);
      expect(columns.map((column) => column.denomination)).toEqual(
        [...columns.map((column) => column.denomination)].sort((left, right) => left - right),
      );
      expect(new Set(columns.map((column) => column.column)).size).toBe(columns.length);
    }
  });

  it("renders the 15,000 opening stack as a playable multi-denomination rack", () => {
    expect(chipInventoryForAmount(15_000)).toEqual([
      25, 25, 25, 25,
      100, 100, 100, 100,
      500, 500, 500,
      1_000, 1_000, 1_000,
      5_000, 5_000,
    ]);
    const columns = chipColumnLayoutForAmount(15_000, 8);

    expect(columns).toEqual([
      { denomination: 25, count: 4, column: 0 },
      { denomination: 100, count: 4, column: 1 },
      { denomination: 500, count: 3, column: 2 },
      { denomination: 1_000, count: 3, column: 3 },
      { denomination: 5_000, count: 2, column: 4 },
    ]);
    expect(columns.reduce((total, column) => total + column.denomination * column.count, 0))
      .toBe(15_000);
  });

  it("projects stack and bet numerals for the hero and every rotated seat", () => {
    for (const heroIndex of [0, 1, 2, 3, 4, 5]) {
      for (const pan of [-2, 0, 2]) {
        for (const relativeSeat of [0, 1, 2, 3, 4, 5]) {
          const stack = seatPlaqueViewportAnchor(relativeSeat, pan, 1366, 768, heroIndex);
          const bet = seatBetViewportAnchor(relativeSeat, pan, 1366, 768, heroIndex);
          for (const anchor of [stack, bet]) {
            expect(anchor === undefined || (
              Number.isFinite(anchor.xPercent) && Number.isFinite(anchor.yPercent)
            )).toBe(true);
          }
        }
      }
    }
  });

  it("uses one active camera lens for stack and bet overlays", () => {
    const standard = seatStackAmountViewportAnchor(0, 0, 1366, 768, 0, 0, "standard");
    const close = seatStackAmountViewportAnchor(0, 0, 1366, 768, 0, 0, "close");
    const wide = seatStackAmountViewportAnchor(0, 0, 1366, 768, 0, 0, "wide");
    expect(standard).toBeDefined();
    expect(close).toBeDefined();
    expect(wide).toBeDefined();
    expect(close?.xPercent).not.toBeCloseTo(standard?.xPercent ?? 0, 4);
    expect(wide?.xPercent).not.toBeCloseTo(standard?.xPercent ?? 0, 4);
    for (const cameraView of ["wide", "standard", "close"] as const) {
      for (const pan of [-2, 0, 2]) {
        for (const scale of [0.85, 1, 1.15, 1.3]) {
          const stack = seatStackAmountViewportAnchor(0, pan, 1366 * scale, 768 * scale, 0, 0, cameraView);
          const bet = seatBetViewportAnchor(0, pan, 1366 * scale, 768 * scale, 0, 0, cameraView);
          expect(stack === undefined || Number.isFinite(stack.xPercent)).toBe(true);
          expect(bet === undefined || Number.isFinite(bet.yPercent)).toBe(true);
        }
      }
    }
  });

  it("projects stable table anchors coherently through zoom, pan, and resize", () => {
    const aspect = 1366 / 768;
    const camera = cameraPose(0, 0, aspect, 0);
    const zoomedCamera = cameraPose(0, 0, aspect, 0.75);
    const pannedCamera = cameraPose(1, 0, aspect, 0.75);
    const base = seatStackAmountViewportAnchorFromCamera(0, 1366, 768, 0, camera);
    const zoomed = seatStackAmountViewportAnchorFromCamera(0, 1366, 768, 0, zoomedCamera);
    const panned = seatStackAmountViewportAnchorFromCamera(0, 1366, 768, 0, pannedCamera);
    expect(base).toBeDefined();
    expect(zoomed).toBeDefined();
    expect(panned).toBeDefined();
    expect(Math.hypot((zoomed?.xPercent ?? 0) - 50, (zoomed?.yPercent ?? 0) - 50))
      .toBeGreaterThan(Math.hypot((base?.xPercent ?? 0) - 50, (base?.yPercent ?? 0) - 50));
    expect(Math.abs((panned?.xPercent ?? 0) - (zoomed?.xPercent ?? 0))).toBeGreaterThan(0.1);

    // UI scale / resize with the same aspect ratio changes pixel size, not the
    // table-space percentage. This is the regression that screen-locked labels
    // failed: their pixel coordinates stayed stale instead.
    const resized = seatStackAmountViewportAnchor(0, 0, 2732, 1536, 0, 0.75, "standard");
    expect(resized?.xPercent).toBeCloseTo(zoomed?.xPercent ?? 0, 8);
    expect(resized?.yPercent).toBeCloseTo(zoomed?.yPercent ?? 0, 8);
  });

  it("keeps stack and committed-bet numerals distinct in every camera frame", () => {
    for (const pan of [-2, 0, 2]) {
      const camera = cameraPose(pan, 0, 1366 / 768, 0.5);
      const stack = seatStackAmountViewportAnchorFromCamera(0, 1366, 768, 0, camera);
      const bet = seatBetViewportAnchorFromCamera(0, 1366, 768, 0, camera);
      expect(stack).toBeDefined();
      expect(bet).toBeDefined();
      expect(Math.hypot(
        (stack?.xPercent ?? 0) - (bet?.xPercent ?? 0),
        (stack?.yPercent ?? 0) - (bet?.yPercent ?? 0),
      )).toBeGreaterThan(2);
    }
  });
});
