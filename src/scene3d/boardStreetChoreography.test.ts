import { describe, expect, it } from "vitest";
import {
  BOARD_STREET_ALL_IN_DURATION_MS,
  BOARD_STREET_MAX_CARD_CLEARANCE,
  BOARD_STREET_RENDERED_CARD_LENGTH,
  BOARD_STREET_STANDARD_DURATION_MS,
  boardStreetChoreographyAtProgress,
  boardStreetChoreographyFrame,
  boardStreetForCardIndex,
  boardStreetPhaseSequence,
  boardStreetRequiresBurn,
  communityCardTarget,
  type BoardStreetChoreographyFrame,
  type BoardStreetPhase,
  type BoardStreetPoint3,
} from "./boardStreetChoreography";
import { boardCardX } from "./dealerPresentation";
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";

function distance(left: BoardStreetPoint3, right: BoardStreetPoint3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function observedPhases(cardIndex: number): BoardStreetPhase[] {
  const phases: BoardStreetPhase[] = [];
  for (let step = 0; step <= 10_000; step += 1) {
    const phase = boardStreetChoreographyAtProgress(cardIndex, step / 10_000).phase;
    if (phases.at(-1) !== phase) phases.push(phase);
  }
  return phases;
}

describe("dealer board-street phase contract", () => {
  it("finishes a complete burn before taking the next card", () => {
    const expected = [
      "burn-reach",
      "burn-carry",
      "burn-place",
      "burn-release",
      "board-take",
      "board-carry",
      "board-flip",
      "board-place",
      "board-release",
      "recover",
      "settled",
    ] as const;
    expect(boardStreetPhaseSequence(0)).toEqual(expected);
    expect(observedPhases(0)).toEqual(expected);
    expect(expected.indexOf("burn-release")).toBeLessThan(expected.indexOf("board-take"));

    for (let step = 0; step <= 10_000; step += 1) {
      const frame = boardStreetChoreographyAtProgress(0, step / 10_000);
      if (frame.phase.startsWith("burn-")) {
        expect(frame.boardCard.ownership).toBe("deck");
        expect(frame.boardCard.visible).toBe(false);
      }
      if (frame.phase === "board-take") {
        expect(frame.burnCard).toMatchObject({
          ownership: "discard-pile",
          arrived: true,
          released: true,
        });
      }
    }
  });

  it("continues flop cards one and two without inventing extra burns", () => {
    const expected = [
      "board-take",
      "board-carry",
      "board-flip",
      "board-place",
      "board-release",
      "recover",
      "settled",
    ] as const;
    expect(observedPhases(1)).toEqual(expected);
    expect(observedPhases(2)).toEqual(expected);
    for (const index of [1, 2]) {
      const frame = boardStreetChoreographyAtProgress(index, 0.5);
      expect(frame.burnCard).toMatchObject({
        required: false,
        visible: false,
        ownership: "not-required",
      });
    }
  });

  it("initiates exactly one burn for each street", () => {
    expect([0, 1, 2, 3, 4].filter(boardStreetRequiresBurn)).toEqual([0, 3, 4]);
    expect([0, 1, 2, 3, 4].map(boardStreetForCardIndex)).toEqual([
      "flop", "flop", "flop", "turn", "river",
    ]);
    expect([0, 1, 2].filter(boardStreetRequiresBurn)).toHaveLength(1);
    expect([3].filter(boardStreetRequiresBurn)).toHaveLength(1);
    expect([4].filter(boardStreetRequiresBurn)).toHaveLength(1);
  });
});

describe("supported card travel", () => {
  it("keeps card and right-hand positions continuous at every phase boundary", () => {
    const epsilon = 1e-7;
    for (const cardIndex of [0, 1, 3, 4]) {
      let previous = boardStreetChoreographyAtProgress(cardIndex, 0);
      for (let step = 1; step <= 20_000; step += 1) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, step / 20_000);
        expect(distance(previous.boardCard.position, frame.boardCard.position)).toBeLessThan(0.001);
        expect(distance(previous.burnCard.position, frame.burnCard.position)).toBeLessThan(0.001);
        expect(distance(previous.rightHand.position, frame.rightHand.position)).toBeLessThan(0.001);
        previous = frame;
      }

      for (let step = 1; step < 10_000; step += 1) {
        const progress = step / 10_000;
        const before = boardStreetChoreographyAtProgress(cardIndex, progress - epsilon);
        const after = boardStreetChoreographyAtProgress(cardIndex, progress + epsilon);
        if (before.phase !== after.phase) {
          expect(distance(before.boardCard.position, after.boardCard.position)).toBeLessThan(0.00001);
          expect(distance(before.burnCard.position, after.burnCard.position)).toBeLessThan(0.00001);
          expect(distance(before.rightHand.position, after.rightHand.position)).toBeLessThan(0.00001);
        }
      }
    }
  });

  it("never creates an unsupported airborne card and keeps flip clearance low", () => {
    for (const cardIndex of [0, 1, 2, 3, 4]) {
      for (let step = 0; step <= 2_000; step += 1) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, step / 2_000);
        expect(frame.deck.owner).toBe("dealer-left-hand");
        expect(frame.leftHand.holdingDeck).toBe(true);
        for (const card of [frame.burnCard, frame.boardCard]) {
          expect(card.position.every(Number.isFinite)).toBe(true);
          expect(card.quaternion.every(Number.isFinite)).toBe(true);
          expect(card.feltClearance).toBeGreaterThanOrEqual(0);
          expect(card.feltClearance).toBeLessThanOrEqual(BOARD_STREET_MAX_CARD_CLEARANCE + 1e-10);
          if (card.kind === "board" && card.visible) {
            const requiredCentreClearance = Math.abs(Math.sin(card.rotationX))
              * BOARD_STREET_RENDERED_CARD_LENGTH / 2;
            expect(card.feltClearance).toBeGreaterThanOrEqual(requiredCentreClearance - 1e-10);
          }
          if (card.visible) {
            expect(card.contact.support).not.toBe("none");
            expect(card.contact.felt || card.contact.dealerRightHand).toBe(true);
          }
          if (card.contact.support === "dealer-right-hand") {
            expect(card.contact.dealerRightHand).toBe(true);
            expect(frame.rightHand.contactCard).toBe(card.kind);
          }
        }
        expect([frame.burnCard, frame.boardCard].filter(
          (card) => card.ownership === "dealer-right-hand",
        ).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("visibly flips the public card while its carried position keeps advancing", () => {
    for (const cardIndex of [0, 1, 3, 4]) {
      const flipFrames: BoardStreetChoreographyFrame[] = [];
      for (let step = 0; step <= 10_000; step += 1) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, step / 10_000);
        if (frame.phase === "board-flip") flipFrames.push(frame);
      }
      const first = flipFrames[0]!;
      const middle = flipFrames[Math.floor(flipFrames.length / 2)]!;
      const last = flipFrames.at(-1)!;

      expect(first.boardCard.rotationX).toBeCloseTo(Math.PI, 4);
      expect(middle.boardCard.rotationX).toBeGreaterThan(0);
      expect(middle.boardCard.rotationX).toBeLessThan(Math.PI);
      expect(middle.boardCard.faceUpFraction).toBeGreaterThan(0);
      expect(middle.boardCard.faceUpFraction).toBeLessThan(1);
      expect(last.boardCard.rotationX).toBeCloseTo(0, 4);
      expect(distance(first.boardCard.position, last.boardCard.position)).toBeGreaterThan(0.1);
      expect(middle.boardCard.contact).toEqual({
        support: "dealer-right-hand",
        felt: false,
        dealerRightHand: true,
      });
      expect(middle.rightHand).toMatchObject({
        hand: "right",
        holdingCard: "board",
        contactCard: "board",
      });
    }
  });
});

describe("destination and order", () => {
  it("releases burn and board cards only at their exact destinations", () => {
    for (const cardIndex of [0, 1, 3, 4]) {
      const target = communityCardTarget(cardIndex);
      for (let step = 0; step <= 5_000; step += 1) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, step / 5_000);
        if (frame.boardCard.released || frame.boardCard.ownership === "community-board") {
          expect(frame.boardCard.position).toEqual(target);
          expect(frame.boardCard.arrived).toBe(true);
          expect(frame.boardCard.faceUp).toBe(true);
          expect(frame.rightHand.holdingCard).not.toBe("board");
        }
        if (frame.burnCard.released || frame.burnCard.ownership === "discard-pile") {
          expect(frame.burnCard.position).toEqual(TABLE_ANCHORS.muck);
          expect(frame.burnCard.arrived).toBe(true);
          expect(frame.rightHand.holdingCard).not.toBe("burn");
        }
        if (!frame.boardCard.arrived) expect(frame.boardCard.released).toBe(false);
        if (!frame.burnCard.arrived) expect(frame.burnCard.released).toBe(false);
      }
    }
  });

  it("keeps all five final positions fixed from the house dealer's perspective", () => {
    const targets = [0, 1, 2, 3, 4].map(communityCardTarget);
    expect(targets.map((target) => target[0])).toEqual(
      [...targets.map((target) => target[0])].sort((left, right) => right - left),
    );
    for (const [index, target] of targets.entries()) {
      expect(target[0]).toBeCloseTo(boardCardX(index), 12);
      expect(target[1]).toBe(TABLE_HEIGHT + 0.009);
      expect(target[2]).toBe(TABLE_ANCHORS.board[2]);
      expect(boardStreetChoreographyAtProgress(index, 1).boardCard.position).toEqual(target);
    }
    expect(communityCardTarget(-50)).toEqual(targets[0]);
    expect(communityCardTarget(Number.POSITIVE_INFINITY)).toEqual(targets[4]);
  });

  it("clamps clocks and supports both existing board-event durations", () => {
    expect(boardStreetChoreographyAtProgress(0, Number.NaN))
      .toEqual(boardStreetChoreographyAtProgress(0, 0));
    expect(boardStreetChoreographyAtProgress(0, Number.POSITIVE_INFINITY))
      .toEqual(boardStreetChoreographyAtProgress(0, 1));
    expect(boardStreetChoreographyFrame(0, -1))
      .toEqual(boardStreetChoreographyFrame(0, 0));
    expect(boardStreetChoreographyFrame(0, Number.POSITIVE_INFINITY)).toMatchObject({
      durationMs: BOARD_STREET_STANDARD_DURATION_MS,
      elapsedMs: BOARD_STREET_STANDARD_DURATION_MS,
      phase: "settled",
      complete: true,
    });
    expect(boardStreetChoreographyFrame(
      3,
      BOARD_STREET_ALL_IN_DURATION_MS,
      BOARD_STREET_ALL_IN_DURATION_MS,
    )).toMatchObject({
      durationMs: BOARD_STREET_ALL_IN_DURATION_MS,
      elapsedMs: BOARD_STREET_ALL_IN_DURATION_MS,
      phase: "settled",
      complete: true,
    });
  });
});
