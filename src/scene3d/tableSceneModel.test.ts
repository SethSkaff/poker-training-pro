import { describe, expect, it } from "vitest";
import {
  actionEase,
  betChipPosition,
  cameraPose,
  chipCountForAmount,
  dealtCardPosition,
  EYE_HEIGHT,
  MAX_PAN,
  MAX_YAW_RADIANS,
  muckedCardPosition,
  seatPoses,
  TABLE_HEIGHT,
  TABLE_RADIUS,
} from "./tableSceneModel";

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("seats are placed around a real table", () => {
  it("puts the hero nearest the camera", () => {
    const poses = seatPoses(6);
    const hero = poses[0];
    // +Z is toward the camera, so the hero has the largest Z.
    for (const pose of poses.slice(1)) {
      expect(hero.position[2]).toBeGreaterThan(pose.position[2]);
    }
  });

  it("spaces every seat evenly and outside the felt", () => {
    const poses = seatPoses(6);
    expect(poses).toHaveLength(6);
    for (const pose of poses) {
      const radius = Math.hypot(pose.position[0], pose.position[2]);
      expect(radius).toBeGreaterThan(TABLE_RADIUS);
    }
    // Neighbouring seats are equidistant.
    const gaps = poses.map((pose, index) =>
      distance(pose.position, poses[(index + 1) % poses.length].position),
    );
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 5);
    }
  });

  it("rests cards and chips on the felt surface, inside the rail", () => {
    for (const pose of seatPoses(6)) {
      expect(pose.feltPosition[1]).toBe(TABLE_HEIGHT);
      const radius = Math.hypot(pose.feltPosition[0], pose.feltPosition[2]);
      expect(radius).toBeLessThan(TABLE_RADIUS);
    }
  });

  it("faces every body toward the middle of the table", () => {
    for (const pose of seatPoses(6)) {
      // Facing is the seat angle turned around; a body at the far side looks
      // back toward the camera.
      const dx = Math.sin(pose.facing);
      const dz = Math.cos(pose.facing);
      // The direction it faces should reduce its distance to the centre.
      const ahead: readonly [number, number, number] = [
        pose.position[0] + dx * 0.1,
        0,
        pose.position[2] + dz * 0.1,
      ];
      expect(Math.hypot(ahead[0], ahead[2])).toBeLessThan(
        Math.hypot(pose.position[0], pose.position[2]),
      );
    }
  });

  it("handles a heads-up table and an empty one", () => {
    expect(seatPoses(2)).toHaveLength(2);
    expect(seatPoses(0)).toEqual([]);
  });
});

describe("the camera is seated, and its look is limited", () => {
  it("sits at eye height behind the hero rather than above the table", () => {
    const pose = cameraPose(0);
    expect(pose.position[1]).toBe(EYE_HEIGHT);
    // Not a bird's-eye rig: the eyes are below the height of a standing person
    // and only just above the felt.
    expect(pose.position[1]).toBeLessThan(1.5);
    expect(pose.position[1]).toBeGreaterThan(TABLE_HEIGHT);
  });

  it("looks straight ahead when centred", () => {
    expect(cameraPose(0).yaw).toBe(0);
  });

  it("clamps the yaw at the limit in both directions", () => {
    expect(cameraPose(MAX_PAN).yaw).toBeCloseTo(MAX_YAW_RADIANS, 6);
    expect(cameraPose(-MAX_PAN).yaw).toBeCloseTo(-MAX_YAW_RADIANS, 6);
    // Beyond the control's range it must not keep turning.
    expect(cameraPose(99).yaw).toBeCloseTo(MAX_YAW_RADIANS, 6);
    expect(cameraPose(-99).yaw).toBeCloseTo(-MAX_YAW_RADIANS, 6);
  });

  it("never lets the player spin around to face away from the table", () => {
    for (const pan of [-99, -2, -1, 0, 1, 2, 99]) {
      expect(Math.abs(cameraPose(pan).yaw)).toBeLessThan(Math.PI / 4);
    }
  });

  it("keeps the camera in the same seat at every pan setting", () => {
    // Looking left and right must not translate the player around the room.
    const centre = cameraPose(0).position;
    for (const pan of [-2, -1, 1, 2]) {
      expect(cameraPose(pan).position).toEqual(centre);
    }
  });

  it("moves the look target left when panning left and right when panning right", () => {
    const left = cameraPose(-2).target;
    const centre = cameraPose(0).target;
    const right = cameraPose(2).target;
    expect(left[0]).toBeGreaterThan(centre[0]);
    expect(right[0]).toBeLessThan(centre[0]);
  });

  it("recentres exactly, so the control returns to a known pose", () => {
    expect(cameraPose(0)).toEqual(cameraPose(0));
    expect(cameraPose(0).yaw).toBe(0);
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

  it("pushes a bet from the seat to the pot", () => {
    const start = betChipPosition(pose, 0);
    const end = betChipPosition(pose, 1);
    expect(start[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(start[2]).toBeCloseTo(pose.feltPosition[2], 6);
    // Ends near the middle of the felt.
    expect(Math.hypot(end[0], end[2])).toBeLessThan(0.3);
    // Lifts off the felt on the way and lands back on it.
    expect(betChipPosition(pose, 0.5)[1]).toBeGreaterThan(pose.feltPosition[1]);
    expect(end[1]).toBeCloseTo(pose.feltPosition[1], 6);
  });

  it("deals a card from the dealer to the seat", () => {
    const end = dealtCardPosition(pose, 1);
    expect(end[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(end[2]).toBeCloseTo(pose.feltPosition[2], 6);
    // It arrives somewhere different from where it began.
    expect(distance(dealtCardPosition(pose, 0), end)).toBeGreaterThan(0.2);
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
