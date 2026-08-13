import { describe, expect, it } from "vitest";
import { seatPoses } from "./tableSceneModel";
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";
import {
  FOLD_CHOREOGRAPHY_TIMING,
  FOLD_CONTACT_PALM_CLEARANCE,
  FOLD_MAX_CARD_FELT_CLEARANCE,
  FOLD_PLAYER_SLIDE_DISTANCE,
  FOLD_PRIVATE_CARD_HALF_SPREAD,
  foldCardPoses,
  foldChoreographyAtProgress,
  foldChoreographyFrame,
  foldDiscardCardPoses,
  foldPrivateCardPoses,
  foldStagingCardPoses,
  foldStagingCentre,
  type FoldCardPose,
  type FoldVector3,
} from "./foldChoreography";

const distance = (left: FoldVector3, right: FoldVector3) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
);

const angularDistance = (left: number, right: number) => {
  const fullTurn = Math.PI * 2;
  return Math.abs(((right - left + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI);
};

const midpoint = (
  cards: readonly [FoldCardPose, FoldCardPose],
): FoldVector3 => [
  (cards[0].position[0] + cards[1].position[0]) / 2,
  (cards[0].position[1] + cards[1].position[1]) / 2,
  (cards[0].position[2] + cards[1].position[2]) / 2,
];

describe("fold choreography timing and ownership", () => {
  const pose = seatPoses(6)[2];

  it("clamps bad clocks and normalized progress deterministically", () => {
    expect(foldChoreographyFrame(pose, -100)).toEqual(foldChoreographyFrame(pose, 0));
    expect(foldChoreographyFrame(pose, Number.NaN)).toEqual(foldChoreographyFrame(pose, 0));
    expect(foldChoreographyFrame(pose, Number.NEGATIVE_INFINITY))
      .toEqual(foldChoreographyFrame(pose, 0));
    expect(foldChoreographyFrame(pose, Number.POSITIVE_INFINITY))
      .toEqual(foldChoreographyFrame(pose, FOLD_CHOREOGRAPHY_TIMING.totalMs));
    expect(foldChoreographyAtProgress(pose, -1)).toEqual(foldChoreographyFrame(pose, 0));
    expect(foldChoreographyAtProgress(pose, 2))
      .toEqual(foldChoreographyFrame(pose, FOLD_CHOREOGRAPHY_TIMING.totalMs));
  });

  it("holds the staged cards for exactly 500 ms before dealer collection", () => {
    const {
      playerSlideEndsAtMs,
      dealerCollectionStartsAtMs,
      handoffWaitMs,
    } = FOLD_CHOREOGRAPHY_TIMING;
    expect(dealerCollectionStartsAtMs - playerSlideEndsAtMs).toBe(500);
    expect(handoffWaitMs).toBe(500);

    const staged = foldStagingCardPoses(pose);
    const waitStart = foldChoreographyFrame(pose, playerSlideEndsAtMs);
    const waitEnd = foldChoreographyFrame(pose, dealerCollectionStartsAtMs - 0.001);
    const collectionStart = foldChoreographyFrame(pose, dealerCollectionStartsAtMs);

    expect(waitStart).toMatchObject({
      phase: "handoff-wait",
      ownership: "felt-staging",
      motionOwner: "none",
      dealerCollectionProgress: 0,
      contact: {
        felt: true,
        playerRightHand: false,
        dealerRightHand: false,
        cardIndices: [],
      },
    });
    expect(waitStart.cards).toEqual(staged);
    expect(waitEnd.cards).toEqual(staged);
    expect(collectionStart).toMatchObject({
      phase: "dealer-collect",
      ownership: "dealer-right-hand",
      motionOwner: "dealer-right-hand",
      dealerCollectionProgress: 0,
      contact: {
        felt: true,
        playerRightHand: false,
        dealerRightHand: true,
        cardIndices: [0, 1],
      },
    });
    expect(collectionStart.cards).toEqual(staged);
    expect(foldChoreographyFrame(pose, dealerCollectionStartsAtMs + 20).cards)
      .not.toEqual(staged);
  });

  it("transfers ownership only while a physically identified right hand is in contact", () => {
    const reach = foldChoreographyFrame(pose, 100);
    const slide = foldChoreographyFrame(
      pose,
      FOLD_CHOREOGRAPHY_TIMING.playerSlideStartsAtMs + 100,
    );
    const collect = foldChoreographyFrame(
      pose,
      FOLD_CHOREOGRAPHY_TIMING.dealerCollectionStartsAtMs + 100,
    );
    const settled = foldChoreographyFrame(pose, FOLD_CHOREOGRAPHY_TIMING.totalMs);

    expect(reach.playerRightHand).toMatchObject({
      actor: "player",
      hand: "right",
      active: true,
      contactCardIndices: [],
    });
    expect(slide.playerRightHand.contactCardIndices).toEqual([0, 1]);
    expect(slide.dealerRightHand.contactCardIndices).toEqual([]);
    expect(collect.dealerRightHand).toMatchObject({
      actor: "dealer",
      hand: "right",
      active: true,
      contactCardIndices: [0, 1],
    });
    expect(settled).toMatchObject({
      phase: "settled",
      ownership: "discard-pile",
      motionOwner: "none",
    });
  });
});

describe("player right-hand fold", () => {
  it("reaches down over the exact two-card midpoint at every seat", () => {
    for (let heroIndex = 0; heroIndex < 6; heroIndex += 1) {
      for (const pose of seatPoses(6, heroIndex)) {
        const reachStart = foldChoreographyFrame(pose, 0);
        const contact = foldChoreographyFrame(
          pose,
          FOLD_CHOREOGRAPHY_TIMING.playerSlideStartsAtMs,
        );
        const privateCentre = midpoint(foldPrivateCardPoses(pose));

        expect(contact.phase).toBe("player-slide");
        expect(contact.playerRightHand.target[0]).toBeCloseTo(privateCentre[0], 10);
        expect(contact.playerRightHand.target[2]).toBeCloseTo(privateCentre[2], 10);
        expect(contact.playerRightHand.position[0]).toBeCloseTo(privateCentre[0], 10);
        expect(contact.playerRightHand.position[2]).toBeCloseTo(privateCentre[2], 10);
        expect(contact.playerRightHand.position[1] - privateCentre[1])
          .toBeCloseTo(FOLD_CONTACT_PALM_CLEARANCE, 10);
        expect(contact.playerRightHand.contactCardIndices).toEqual([0, 1]);
        expect(reachStart.playerRightHand.position[1])
          .toBeGreaterThan(contact.playerRightHand.position[1]);
      }
    }
  });

  it("slides both cards continuously forward without an upward arm jerk", () => {
    const pose = seatPoses(6)[4];
    const { playerSlideStartsAtMs, playerSlideEndsAtMs } = FOLD_CHOREOGRAPHY_TIMING;
    let previous = foldChoreographyFrame(pose, playerSlideStartsAtMs);
    for (let elapsed = playerSlideStartsAtMs + 5; elapsed <= playerSlideEndsAtMs; elapsed += 5) {
      const frame = foldChoreographyFrame(pose, elapsed);
      for (const index of [0, 1] as const) {
        expect(distance(previous.cards[index].position, frame.cards[index].position))
          .toBeLessThan(0.01);
      }
      const centre = midpoint(frame.cards);
      expect(frame.playerRightHand.position[0]).toBeCloseTo(centre[0], 10);
      expect(frame.playerRightHand.position[2]).toBeCloseTo(centre[2], 10);
      expect(frame.playerRightHand.position[1] - centre[1])
        .toBeCloseTo(FOLD_CONTACT_PALM_CLEARANCE, 10);
      expect(frame.playerRightHand.position[1])
        .toBeLessThanOrEqual(TABLE_HEIGHT + FOLD_CONTACT_PALM_CLEARANCE + 1e-9);
      previous = frame;
    }
  });
});

describe("felt-contact card path", () => {
  it("is continuous at every phase boundary and never floats", () => {
    for (const pose of seatPoses(6)) {
      const boundaries = [
        FOLD_CHOREOGRAPHY_TIMING.playerSlideStartsAtMs,
        FOLD_CHOREOGRAPHY_TIMING.playerSlideEndsAtMs,
        FOLD_CHOREOGRAPHY_TIMING.dealerCollectionStartsAtMs,
        FOLD_CHOREOGRAPHY_TIMING.dealerCollectionEndsAtMs,
        FOLD_CHOREOGRAPHY_TIMING.totalMs,
      ];
      for (const boundary of boundaries) {
        const before = foldCardPoses(pose, boundary - 0.001);
        const at = foldCardPoses(pose, boundary);
        for (const index of [0, 1] as const) {
          expect(distance(before[index].position, at[index].position)).toBeLessThan(0.00001);
          expect(angularDistance(before[index].rotation[1], at[index].rotation[1]))
            .toBeLessThan(0.0001);
        }
      }

      for (let elapsed = 0; elapsed <= FOLD_CHOREOGRAPHY_TIMING.totalMs; elapsed += 10) {
        const frame = foldChoreographyFrame(pose, elapsed);
        for (const card of frame.cards) {
          expect(card.position.every(Number.isFinite)).toBe(true);
          expect(card.feltClearance).toBeGreaterThanOrEqual(0);
          expect(card.feltClearance).toBeLessThanOrEqual(FOLD_MAX_CARD_FELT_CLEARANCE);
          expect(card.rotation[0]).toBe(0);
          expect(card.rotation[2]).toBe(0);
        }
      }
    }
  });

  it("keeps the two-card packet symmetric and pushes inward for all seats", () => {
    const poses = seatPoses(6);
    for (const pose of poses) {
      const start = foldPrivateCardPoses(pose);
      const stage = foldStagingCardPoses(pose);
      const startCentre = midpoint(start);
      const stageCentre = foldStagingCentre(pose);
      const displacement: FoldVector3 = [
        stageCentre[0] - startCentre[0],
        0,
        stageCentre[2] - startCentre[2],
      ];
      const forward: FoldVector3 = [Math.sin(pose.facing), 0, Math.cos(pose.facing)];
      const forwardTravel = displacement[0] * forward[0] + displacement[2] * forward[2];
      const lateralTravel = displacement[0] * Math.cos(pose.facing)
        - displacement[2] * Math.sin(pose.facing);

      expect(distance(start[0].position, start[1].position))
        .toBeCloseTo(FOLD_PRIVATE_CARD_HALF_SPREAD * 2, 10);
      expect(distance(stage[0].position, stage[1].position))
        .toBeCloseTo(FOLD_PRIVATE_CARD_HALF_SPREAD * 2, 10);
      expect(forwardTravel).toBeGreaterThan(0);
      expect(forwardTravel).toBeLessThanOrEqual(FOLD_PLAYER_SLIDE_DISTANCE + 1e-10);
      expect(lateralTravel).toBeCloseTo(0, 10);
      expect(Math.hypot(stageCentre[0], stageCentre[2]))
        .toBeLessThan(Math.hypot(startCentre[0], startCentre[2]));

      const mirror = poses.find((candidate) => (
        Math.abs(candidate.feltPosition[0] + pose.feltPosition[0]) < 1e-10
        && Math.abs(candidate.feltPosition[2] - pose.feltPosition[2]) < 1e-10
      ));
      expect(mirror).toBeDefined();
      const mirroredStage = foldStagingCentre(mirror!);
      const mirroredCards = foldPrivateCardPoses(mirror!);
      expect(mirroredStage[0]).toBeCloseTo(-stageCentre[0], 10);
      expect(mirroredStage[2]).toBeCloseTo(stageCentre[2], 10);
      // A mirrored owner's left/right card indices swap in world space.
      expect(mirroredCards[1].position[0]).toBeCloseTo(-start[0].position[0], 10);
      expect(mirroredCards[1].position[2]).toBeCloseTo(start[0].position[2], 10);
    }
  });
});

describe("dealer collection", () => {
  it("continuously carries both cards from staging to the discard pile", () => {
    for (const pose of seatPoses(6)) {
      const {
        dealerCollectionStartsAtMs: startMs,
        dealerCollectionEndsAtMs: endMs,
      } = FOLD_CHOREOGRAPHY_TIMING;
      const discard = foldDiscardCardPoses();
      let previous = foldChoreographyFrame(pose, startMs);
      let previousRemaining = previous.cards.map((card, index) => (
        distance(card.position, discard[index as 0 | 1].position)
      ));

      for (let elapsed = startMs + 5; elapsed <= endMs; elapsed += 5) {
        const frame = foldChoreographyFrame(pose, elapsed);
        const centre = midpoint(frame.cards);
        for (const index of [0, 1] as const) {
          expect(distance(previous.cards[index].position, frame.cards[index].position))
            .toBeLessThan(0.02);
          const remaining = distance(frame.cards[index].position, discard[index].position);
          expect(remaining).toBeLessThanOrEqual(previousRemaining[index] + 1e-10);
          previousRemaining[index] = remaining;
        }
        if (elapsed < endMs) {
          expect(frame.dealerRightHand.contactCardIndices).toEqual([0, 1]);
          expect(frame.dealerRightHand.position[0]).toBeCloseTo(centre[0], 10);
          expect(frame.dealerRightHand.position[2]).toBeCloseTo(centre[2], 10);
        }
        previous = frame;
      }

      const collected = foldChoreographyFrame(pose, endMs);
      const terminal = foldChoreographyFrame(pose, FOLD_CHOREOGRAPHY_TIMING.totalMs);
      expect(collected.cards).toEqual(discard);
      expect(terminal.cards).toEqual(discard);
      expect(collected.ownership).toBe("discard-pile");
      expect(terminal.ownership).toBe("discard-pile");
      for (const card of terminal.cards) {
        expect(Math.abs(card.position[0] - TABLE_ANCHORS.muck[0]))
          .toBeLessThanOrEqual(0.012 + 1e-10);
        expect(card.position[2]).toBeCloseTo(TABLE_ANCHORS.muck[2], 10);
      }
    }
  });
});
