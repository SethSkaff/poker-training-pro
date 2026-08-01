/*
 * Object-motion and seat-local geometry for the scene model.
 *
 * The seating, camera, and plaque-framing contract moved to
 * `tableStations.test.ts` when the hero was seated at a real player station. The
 * open-arc assertions that used to live here described a composition where the
 * hero stood at the dealer's position, and no longer have a subject.
 */
import { describe, expect, it } from "vitest";
import {
  actionEase,
  allInChipPosition,
  betChipPosition,
  betCirclePosition,
  callChipPosition,
  chipCountForAmount,
  collectChipPosition,
  POT_POSITION,
  dealtCardPosition,
  muckedCardPosition,
  raiseChipPosition,
  restingChipStackPosition,
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
  BET_CIRCLE_RADIUS,
  turnIndicatorPositionForPlayer,
} from "./tableSceneModel";

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
    expect(start[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(start[2]).toBeCloseTo(pose.feltPosition[2], 6);
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
    const start = pose.feltPosition;
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
        expect(distance(marks[i], marks[j])).toBeGreaterThan(0.2);
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
    // A conservative enclosing radius covers both the straight card rectangle
    // and its separate wager circle. If these discs do not touch, neither can
    // the actual smaller printed outlines.
    const laneRadius = Math.max(
      Math.hypot(CARD_ZONE_WIDTH / 2, CARD_ZONE_DEPTH / 2),
      BET_CIRCLE_FORWARD + BET_CIRCLE_RADIUS,
    );
    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        expect(distance(poses[i].feltPosition, poses[j].feltPosition), `lanes ${i}/${j}`)
          .toBeGreaterThan(laneRadius * 2 + 0.015);
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
    expect(chipCountForAmount(1_000_000_000)).toBeLessThanOrEqual(18);
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
    return Math.hypot(point[0] - centreX, point[2]) <= TABLE_DEPTH / 2 - CHIP_STACK_SAFE_RADIUS + 1e-9;
  };

  it("keeps every full stack footprint clear of the rail at every player seat", () => {
    for (const pose of seatPoses(6)) {
      const stack = restingChipStackPosition(pose);
      expect(insideSafeFelt(stack), `seat ${pose.seat}`).toBe(true);
      expect(stack[1]).toBe(TABLE_HEIGHT);
    }
  });

  it("keeps each stack paired with its own card lane rather than a neighbour's", () => {
    const poses = seatPoses(6);
    for (const pose of poses) {
      const stack = restingChipStackPosition(pose);
      const ownDistance = distance(stack, pose.feltPosition);
      for (const other of poses) {
        if (other.seat === pose.seat) continue;
        expect(ownDistance, `stack ${pose.seat} and lane ${other.seat}`)
          .toBeLessThan(distance(stack, other.feltPosition));
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

describe("dealer and blind markers", () => {
  it("sit in the clear foreground strip in front of each owner's stack", () => {
    for (const pose of seatPoses(6)) {
      const stack = restingChipStackPosition(pose);
      const marker = tableMarkerPosition(pose);
      // Pucks remain in the same seat lane but leave enough air not to read as
      // sitting on the chip stack.
      expect(distance(marker, stack), `seat ${pose.seat}`).toBeGreaterThan(0.06);
      expect(Math.hypot(marker[0], marker[2])).toBeGreaterThan(Math.hypot(stack[0], stack[2]));
    }
  });
});
