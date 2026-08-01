import { describe, expect, it } from "vitest";
import { dealerGestureFor, dealerWorkFor, type DealerWork } from "./dealerGesture";
import { DEALER_HAND_REST, DEALER_SHOULDER_PIVOT } from "./sceneCharacters";
import { dealerStation, playerStations, stationAsPose } from "./tableStations";

const pose = stationAsPose(dealerStation(), -1);
const seats = playerStations();
const at = (index: number) => seats[index].feltPosition;

/** Where a shoulder pitch actually puts the hands, in the dealer's own frame. */
function handAfterPitch(pitch: number): { y: number; z: number } {
  const dy = DEALER_HAND_REST[1] - DEALER_SHOULDER_PIVOT[1];
  const dz = DEALER_HAND_REST[2] - DEALER_SHOULDER_PIVOT[2];
  return {
    y: DEALER_SHOULDER_PIVOT[1] + dy * Math.cos(pitch) - dz * Math.sin(pitch),
    z: DEALER_SHOULDER_PIVOT[2] + dy * Math.sin(pitch) + dz * Math.cos(pitch),
  };
}

describe("dealer work selection", () => {
  it("stands idle when the table has given it nothing", () => {
    expect(dealerWorkFor([])).toBeUndefined();
  });

  it("drops finished beats, which is what returns the dealer to rest", () => {
    expect(dealerWorkFor([{ task: "collect", progress: 1, at: at(0) }])).toBeUndefined();
  });

  it("serves the end of a hand before its beginning", () => {
    const work: DealerWork[] = [
      { task: "deal", progress: 0.5, at: at(0) },
      { task: "push", progress: 0.5, at: at(1) },
      { task: "collect", progress: 0.5, at: at(2) },
    ];
    expect(dealerWorkFor(work)?.task).toBe("push");
  });

  it("follows the least advanced of equals, not whichever sorts first", () => {
    const work: DealerWork[] = [
      { task: "deal", progress: 0.8, at: at(0) },
      { task: "deal", progress: 0.1, at: at(3) },
    ];
    expect(dealerWorkFor(work)?.at).toEqual(at(3));
  });
});

describe("dealer gesture", () => {
  it("breathes when idle, and only just", () => {
    const poses = [0, 1000, 2100, 3200].map((ms) => dealerGestureFor(undefined, pose, ms));
    for (const gesture of poses) {
      expect(gesture.task).toBe("idle");
      expect(gesture.shoulderYaw).toBe(0);
      expect(Math.abs(gesture.shoulderPitch)).toBeLessThan(0.02);
    }
    // Actually moving, or it is a still figure at a card table again.
    expect(new Set(poses.map((gesture) => gesture.shoulderPitch.toFixed(4))).size)
      .toBeGreaterThan(1);
  });

  it("holds the pose square under reduced motion", () => {
    const gesture = dealerGestureFor(undefined, pose, 0);
    expect(gesture.shoulderPitch).toBe(0);
    expect(gesture.lean).toBe(0);
  });

  /*
    The one that matters. The hands hang below and forward of the shoulder, so
    the rotation that reaches further over the felt is *negative* about X. A sign
    flip here would have the dealer pull both arms into their own chest on every
    deal, and nothing else in the suite could see it: the numbers would still be
    bounded, still smooth, still returning to rest.
  */
  it("reaches the hands out over the felt rather than into the dealer's lap", () => {
    for (const task of ["deal", "collect", "push"] as const) {
      const gesture = dealerGestureFor({ task, progress: 0.34, at: at(0) }, pose, 0);
      expect(gesture.shoulderPitch).toBeLessThan(0);
      const moved = handAfterPitch(gesture.shoulderPitch);
      expect(moved.z).toBeGreaterThan(DEALER_HAND_REST[2]);
      expect(moved.y).toBeGreaterThan(DEALER_HAND_REST[1]);
    }
  });

  it("pitches a card out and brings the arm back inside one beat", () => {
    expect(dealerGestureFor({ task: "deal", progress: 0, at: at(2) }, pose, 0).shoulderPitch)
      .toBeCloseTo(0, 5);
    expect(dealerGestureFor({ task: "deal", progress: 1, at: at(2) }, pose, 0).shoulderPitch)
      .toBeCloseTo(0, 5);
    expect(dealerGestureFor({ task: "deal", progress: 0.5, at: at(2) }, pose, 0).shoulderPitch)
      .toBeLessThan(-0.2);
  });

  it("takes the card at the shoe before turning toward the receiving seat", () => {
    const target = at(4);
    const pickup = dealerGestureFor({ task: "deal", progress: 0.18, at: target }, pose, 0);
    const release = dealerGestureFor({ task: "deal", progress: 0.55, at: target }, pose, 0);
    // The reach is already over the deck before the arm begins to turn out.
    expect(pickup.shoulderPitch).toBeLessThan(-0.1);
    expect(Math.abs(pickup.shoulderYaw)).toBeLessThan(0.02);
    expect(Math.abs(release.shoulderYaw)).toBeGreaterThan(Math.abs(pickup.shoulderYaw));
  });

  /*
    A rake, not a wave: furthest out early, travelling back for the rest of the
    beat, and squared up by the end so the hands finish over the pot rather than
    still out at the seat they took the bet from.
  */
  it("rakes a bet in: out early, square over the pot at the end", () => {
    const early = dealerGestureFor({ task: "collect", progress: 0.34, at: at(2) }, pose, 0);
    const late = dealerGestureFor({ task: "collect", progress: 0.85, at: at(2) }, pose, 0);
    expect(early.shoulderPitch).toBeLessThan(late.shoulderPitch);
    expect(Math.abs(late.shoulderYaw)).toBeLessThan(Math.abs(early.shoulderYaw));
    const end = dealerGestureFor({ task: "collect", progress: 1, at: at(2) }, pose, 0);
    expect(end.shoulderYaw).toBeCloseTo(0, 5);
    expect(end.shoulderPitch).toBeCloseTo(0, 5);
  });

  it("pushes a pot the other way, from square out to the winning seat", () => {
    const target = at(2);
    const start = dealerGestureFor({ task: "push", progress: 0, at: target }, pose, 0);
    const end = dealerGestureFor({ task: "push", progress: 1, at: target }, pose, 0);
    expect(start.shoulderYaw).toBeCloseTo(0, 5);
    expect(Math.abs(end.shoulderYaw)).toBeGreaterThan(0.05);
  });

  /*
    Shoulders turn less than the bearing and hard-stop well short of a right
    angle. Following a seat 1:1 swung the arms through the dealer's own torso at
    the outer stations; a real dealer reaches across rather than rotating to face
    the seat they are serving.
  */
  it("never rotates the arms through the dealer's own body", () => {
    for (const station of seats) {
      const gesture = dealerGestureFor(
        { task: "push", progress: 1, at: station.feltPosition },
        pose,
        0,
      );
      expect(Math.abs(gesture.shoulderYaw)).toBeLessThanOrEqual(0.8);
    }
  });

  it("leans the torso toward the table only while there is work", () => {
    expect(dealerGestureFor(undefined, pose, 500).lean).toBe(0);
    const working = dealerGestureFor({ task: "collect", progress: 0.34, at: at(1) }, pose, 0);
    expect(working.lean).toBeGreaterThan(0);
    expect(working.lean).toBeLessThan(0.05);
  });
});
