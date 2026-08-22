import { describe, expect, it } from "vitest";
import {
  BET_CHOREOGRAPHY_TIMING,
  OWNER_WAGER_LOCAL_FORWARD,
  betChoreographyFrame,
  createBetChoreographyPlan,
  ownerWagerPosition,
  previousWagerPosition,
  privateCardInwardEdgePosition,
  type BetPoint3,
} from "./betChoreography";
import {
  BET_CIRCLE_RADIUS,
  BET_CIRCLE_FORWARD,
  CARD_ZONE_LOCAL_MAX_Z,
  CHIP_PHYSICAL_RADIUS,
  PREVIOUS_BET_CIRCLE_FORWARD,
  TABLE_HEIGHT,
  betCirclePosition,
  chipRackColumnPosition,
  restingChipStackPosition,
  seatLocalPoint,
  seatPoses,
  seatWorldPoint,
} from "./tableSceneModel";

const distance = (left: BetPoint3, right: BetPoint3) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

function expectPointClose(actual: BetPoint3, expected: BetPoint3, digits = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe("owner-side wager geometry", () => {
  it("halves the old anchor-to-inward-card-edge gap in every station frame", () => {
    expect(OWNER_WAGER_LOCAL_FORWARD).toBe(
      (PREVIOUS_BET_CIRCLE_FORWARD + CARD_ZONE_LOCAL_MAX_Z) / 2,
    );
    expect(BET_CIRCLE_FORWARD).toBe(OWNER_WAGER_LOCAL_FORWARD);

    for (const pose of seatPoses(6)) {
      const card = seatLocalPoint(pose, pose.feltPosition);
      const previous = previousWagerPosition(pose);
      const edge = privateCardInwardEdgePosition(pose);
      const wager = ownerWagerPosition(pose);
      const previousLocal = seatLocalPoint(pose, previous);
      const edgeLocal = seatLocalPoint(pose, edge);
      const wagerLocal = seatLocalPoint(pose, wager);

      expect(edgeLocal[0], `seat ${pose.seat} edge bearing`).toBeCloseTo(card[0], 12);
      expect(edgeLocal[2], `seat ${pose.seat} edge depth`)
        .toBeCloseTo(card[2] + CARD_ZONE_LOCAL_MAX_Z, 12);
      expect(previousLocal[2], `seat ${pose.seat} old depth`)
        .toBeCloseTo(card[2] + PREVIOUS_BET_CIRCLE_FORWARD, 12);
      expect(wagerLocal[0], `seat ${pose.seat} new bearing`)
        .toBeCloseTo((previousLocal[0] + edgeLocal[0]) / 2, 12);
      expect(wagerLocal[2], `seat ${pose.seat} midpoint depth`)
        .toBeCloseTo((previousLocal[2] + edgeLocal[2]) / 2, 12);
      expect(distance(edge, wager), `seat ${pose.seat} edge half-gap`)
        .toBeCloseTo(distance(edge, previous) / 2, 12);
      expect(distance(previous, wager), `seat ${pose.seat} anchor half-gap`)
        .toBeCloseTo(distance(edge, previous) / 2, 12);
      expect(wagerLocal[2], `seat ${pose.seat} moves owner-ward`)
        .toBeLessThan(previousLocal[2]);
      expect(wager[1]).toBe(TABLE_HEIGHT);
      expect(wager).toEqual(betCirclePosition(pose));
    }
  });

  it("keeps every physical destination chip inside the invisible zone for all seats", () => {
    for (const rackAmount of [25, 150, 14_950, 15_000, 45_000, 90_000]) {
      for (const pose of seatPoses(6)) {
        const plan = createBetChoreographyPlan({
          pose,
          rackAmount,
          amount: rackAmount,
        });
        const wagerLocal = seatLocalPoint(pose, plan.wagerPosition);
        const destinationHeights = plan.chips.map((chip) => chip.destinationHeight);

        expect(new Set(plan.chips.map((chip) => chip.destinationColumn)), `${rackAmount} seat ${pose.seat} columns`)
          .toEqual(new Set([0]));
        expect(destinationHeights, `${rackAmount} seat ${pose.seat} vertical slots`)
          .toEqual(destinationHeights.map((_, index) => index));
        for (const chip of plan.chips) {
          const destination = seatLocalPoint(pose, chip.destinationPosition);
          expect(
            Math.hypot(destination[0] - wagerLocal[0], destination[2] - wagerLocal[2])
              + CHIP_PHYSICAL_RADIUS,
            `${rackAmount} seat ${pose.seat} chip ${chip.id}`,
          ).toBeLessThanOrEqual(BET_CIRCLE_RADIUS);
        }
      }
    }
  });

  it("stacks a raise above the chips already settled at the same wager anchor", () => {
    for (const pose of seatPoses(6)) {
      const plan = createBetChoreographyPlan({
        pose,
        rackAmount: 15_000,
        amount: 500,
        existingWagerAmount: 150,
      });
      const wagerLocal = seatLocalPoint(pose, plan.wagerPosition);

      expect(plan.existingWagerChipCount, `seat ${pose.seat} existing pile`).toBe(3);
      expect(plan.chips.map((chip) => chip.destinationHeight), `seat ${pose.seat} raised slots`)
        .toEqual([3]);
      for (const chip of plan.chips) {
        const destination = seatLocalPoint(pose, chip.destinationPosition);
        expect(destination[0], `seat ${pose.seat} raised chip x`).toBeCloseTo(wagerLocal[0], 12);
        expect(destination[2], `seat ${pose.seat} raised chip z`).toBeCloseTo(wagerLocal[2], 12);
        expect(
          Math.hypot(destination[0] - wagerLocal[0], destination[2] - wagerLocal[2])
            + CHIP_PHYSICAL_RADIUS,
        ).toBeLessThanOrEqual(BET_CIRCLE_RADIUS);
      }
    }
  });
});

describe("exact physical wager selection", () => {
  it("takes only real top chips from exact denomination-pure opening-rack columns", () => {
    const pose = seatPoses(6)[3]!;
    const plan = createBetChoreographyPlan({ pose, rackAmount: 15_000, amount: 5_650 });
    const byColumn = [...plan.sourceColumns].sort((left, right) => left.column - right.column);

    expect(plan.hand).toBe("left");
    expect(plan.chips.reduce((total, chip) => total + chip.denomination, 0)).toBe(5_650);
    expect(byColumn.map(({ column, denomination, availableCount, selectedCount }) => ({
      column,
      denomination,
      availableCount,
      selectedCount,
    }))).toEqual([
      { column: 0, denomination: 25, availableCount: 4, selectedCount: 2 },
      { column: 1, denomination: 100, availableCount: 4, selectedCount: 1 },
      { column: 2, denomination: 500, availableCount: 3, selectedCount: 1 },
      { column: 4, denomination: 5_000, availableCount: 2, selectedCount: 1 },
    ]);
    expect(byColumn.map(({ column, firstSelectedHeight }) => [column, firstSelectedHeight]))
      .toEqual([[0, 2], [1, 3], [2, 2], [4, 1]]);
    expect(plan.sourceColumns.map((source) => source.column)).toEqual([4, 2, 0, 1]);

    const rackLocal = seatLocalPoint(pose, restingChipStackPosition(pose, 15_000));
    for (const source of plan.sourceColumns) {
      const offset = chipRackColumnPosition(source.column, 5);
      const expectedBase = seatWorldPoint(pose, [
        rackLocal[0] + offset[0],
        TABLE_HEIGHT,
        rackLocal[2] + offset[1],
      ]);
      expectPointClose(source.columnBasePosition, expectedBase);
      expect(new Set(
        plan.chips
          .filter((chip) => chip.sourceColumn === source.column)
          .map((chip) => chip.denomination),
      )).toEqual(new Set([source.denomination]));
    }
  });

  it("uses deterministic actual columns when one denomination spans columns", () => {
    const pose = seatPoses(6)[0]!;
    const first = createBetChoreographyPlan({ pose, rackAmount: 1_000_000, amount: 900_000 });
    const second = createBetChoreographyPlan({ pose, rackAmount: 1_000_000, amount: 900_000 });
    const physicalOrder = [...first.sourceColumns]
      .sort((left, right) => left.column - right.column)
      .map(({ column, availableCount, selectedCount }) => ({ column, availableCount, selectedCount }));

    expect(physicalOrder).toEqual([
      { column: 0, availableCount: 8, selectedCount: 8 },
      { column: 1, availableCount: 2, selectedCount: 1 },
    ]);
    // The short column is picked up first, so the carried eight-chip column
    // never has to descend through the felt to reach it.
    expect(first.sourceColumns.map((source) => source.column)).toEqual([1, 0]);
    expect(second.sourceColumns).toEqual(first.sourceColumns);
    expect(second.chips).toEqual(first.chips);
  });

  it("refuses to invent change when the currently rendered rack cannot pay exactly", () => {
    const pose = seatPoses(6)[0]!;
    expect(() => createBetChoreographyPlan({ pose, rackAmount: 14_900, amount: 150 }))
      .toThrow(/cannot make wager 150 exactly/);
    expect(() => createBetChoreographyPlan({ pose, rackAmount: 100, amount: 125 }))
      .toThrow(/exceeds rack amount/);
  });
});

describe("left-hand wager choreography", () => {
  const pose = seatPoses(6)[2]!;
  const plan = createBetChoreographyPlan({
    pose,
    rackAmount: 15_000,
    amount: 5_650,
    handRestPosition: seatWorldPoint(pose, [-0.14, TABLE_HEIGHT + 0.085, 0.30]),
  });

  it("puts the left hand over every selected source column during its grasp", () => {
    for (const source of plan.sourceColumns) {
      const frame = betChoreographyFrame(
        plan,
        (source.graspStart + source.pickupEnd) / 2,
      );
      expect(frame.phase).toBe("grasp");
      expect(frame.activeSourceColumn).toBe(source.column);
      expect(frame.hand.side).toBe("left");
      expect(frame.hand.contact).toBe("source-chips");
      expectPointClose(frame.hand.position, source.gripPosition);
      const active = frame.chips.filter((chip) => chip.sourceColumn === source.column);
      expect(active).toHaveLength(source.selectedCount);
      expect(active.every((chip) => chip.ownership === "rack")).toBe(true);
      expect(active.every((chip) => chip.contact === "rack-and-left-hand")).toBe(true);
      expect(active.every((chip) => chip.carrierAnchor === frame.hand.position)).toBe(true);
    }
  });

  it("keeps every carried chip attached to the left-hand anchor", () => {
    for (const progress of [0.47, 0.55, 0.68, 0.79, 0.84, 0.90]) {
      const frame = betChoreographyFrame(plan, progress);
      expect(["carry", "place"]).toContain(frame.phase);
      expect(frame.hand.side).toBe("left");
      expect(frame.hand.contact).toBe("carried-chips");
      expect(frame.hand.gripping).toBe(true);
      expect(frame.chips.every((chip) => chip.ownership === "left-hand")).toBe(true);
      for (const chip of frame.chips) {
        expect(chip.carrierAnchor).toBe(frame.hand.position);
        expectPointClose(chip.carrierAnchor!, frame.hand.position);
      }
    }
  });

  it("has continuous hand and chip endpoints across every ownership/phase boundary", () => {
    const boundaries = [
      ...plan.sourceColumns.map((source) => source.pickupEnd),
      BET_CHOREOGRAPHY_TIMING.transferEnd,
      BET_CHOREOGRAPHY_TIMING.placeEnd,
      BET_CHOREOGRAPHY_TIMING.releaseEnd,
    ];
    const epsilon = 1e-8;
    for (const boundary of boundaries) {
      const before = betChoreographyFrame(plan, boundary - epsilon);
      const after = betChoreographyFrame(plan, boundary);
      expect(distance(before.hand.position, after.hand.position), `hand at ${boundary}`)
        .toBeLessThan(1e-6);
      for (const chip of before.chips) {
        const next = after.chips.find((candidate) => candidate.id === chip.id)!;
        expect(distance(chip.position, next.position), `${chip.id} at ${boundary}`)
          .toBeLessThan(1e-6);
      }
    }
  });

  it("places on felt and transfers ownership only at the final wager positions", () => {
    const placing = betChoreographyFrame(plan, BET_CHOREOGRAPHY_TIMING.placeEnd - 1e-8);
    expect(placing.phase).toBe("place");
    expect(placing.released).toBe(false);
    expect(placing.chips.every((chip) => chip.ownership === "left-hand")).toBe(true);

    const release = betChoreographyFrame(plan, BET_CHOREOGRAPHY_TIMING.placeEnd);
    expect(release.phase).toBe("release");
    expect(release.released).toBe(true);
    expect(release.hand.contact).toBe("none");
    expect(release.hand.gripping).toBe(false);
    for (const chip of release.chips) {
      expect(chip.ownership).toBe("wager");
      expect(chip.carrierAnchor).toBeUndefined();
      expectPointClose(chip.position, chip.destinationPosition);
      expect(chip.position[1]).toBeGreaterThanOrEqual(TABLE_HEIGHT);
      expect(chip.contact).toBe(chip.destinationHeight === 0 ? "felt" : "chip-below");
    }
    for (const destinationColumn of new Set(release.chips.map((chip) => chip.destinationColumn))) {
      const base = release.chips.find(
        (chip) => chip.destinationColumn === destinationColumn && chip.destinationHeight === 0,
      );
      expect(base?.position[1]).toBe(TABLE_HEIGHT);
      expect(base?.contact).toBe("felt");
    }
  });

  it("never leaves a chip unsupported or below the felt", () => {
    for (let step = 0; step <= 200; step += 1) {
      const frame = betChoreographyFrame(plan, step / 200);
      for (const chip of frame.chips) {
        expect(chip.position[1], `${chip.id} y at ${frame.progress}`)
          .toBeGreaterThanOrEqual(TABLE_HEIGHT - 1e-12);
        if (chip.ownership === "left-hand") {
          expect(chip.contact).toBe("left-hand");
          expect(chip.carrierAnchor).toBe(frame.hand.position);
        } else if (chip.ownership === "rack") {
          expect(["rack", "rack-and-left-hand"]).toContain(chip.contact);
          expectPointClose(chip.position, chip.sourcePosition);
        } else {
          expect(["felt", "chip-below"]).toContain(chip.contact);
          expectPointClose(chip.position, chip.destinationPosition);
        }
      }
    }
  });
});
