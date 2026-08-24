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
  boardStreetPhaseWindows,
  boardStreetRequiresBurn,
  communityCardTarget,
  type BoardStreetChoreographyFrame,
  type BoardStreetPoint3,
} from "./boardStreetChoreography";
import { boardCardX } from "./dealerPresentation";
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";

function distance(left: BoardStreetPoint3, right: BoardStreetPoint3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

const BOUNDARY_EPSILON = 1e-8;
const PATH_SAMPLE_STEPS = 480;
/** Tighter than the previous implicit 20 metres per normalized event. */
const MAX_NORMALIZED_POINT_SPEED = 16;

const WITH_BURN_WINDOWS = [
  { phase: "burn-reach", start: 0, end: 0.09 },
  { phase: "burn-carry", start: 0.09, end: 0.26 },
  { phase: "burn-place", start: 0.26, end: 0.29 },
  { phase: "burn-release", start: 0.29, end: 0.33 },
  { phase: "board-take", start: 0.33, end: 0.42 },
  { phase: "board-carry", start: 0.42, end: 0.64 },
  { phase: "board-flip", start: 0.64, end: 0.86 },
  { phase: "board-place", start: 0.86, end: 0.90 },
  { phase: "board-release", start: 0.90, end: 0.94 },
  { phase: "recover", start: 0.94, end: 1 },
] as const;

const WITHOUT_BURN_WINDOWS = [
  { phase: "board-take", start: 0, end: 0.12 },
  { phase: "board-carry", start: 0.12, end: 0.48 },
  { phase: "board-flip", start: 0.48, end: 0.78 },
  { phase: "board-place", start: 0.78, end: 0.84 },
  { phase: "board-release", start: 0.84, end: 0.90 },
  { phase: "recover", start: 0.90, end: 1 },
] as const;

function phaseProbeProgresses(cardIndex: number): number[] {
  const progress = boardStreetPhaseWindows(cardIndex).flatMap((window) => [
    window.start,
    (window.start + window.end) / 2,
    Math.max(window.start, window.end - BOUNDARY_EPSILON),
  ]);
  return [...new Set([...progress, 1])].sort((left, right) => left - right);
}

function representativeProgresses(cardIndex: number, steps = 96): number[] {
  const uniform = Array.from({ length: steps + 1 }, (_, step) => step / steps);
  return [...new Set([...uniform, ...phaseProbeProgresses(cardIndex)])]
    .sort((left, right) => left - right);
}

function expectPositionsNear(
  left: BoardStreetChoreographyFrame,
  right: BoardStreetChoreographyFrame,
  maximumDistance: number,
  context: string,
): void {
  const positions = [
    ["board card", left.boardCard.position, right.boardCard.position],
    ["burn card", left.burnCard.position, right.burnCard.position],
    ["right hand", left.rightHand.position, right.rightHand.position],
  ] as const;
  for (const [name, leftPosition, rightPosition] of positions) {
    expect(distance(leftPosition, rightPosition), `${context}: ${name}`)
      .toBeLessThanOrEqual(maximumDistance);
  }
}

describe("dealer board-street phase contract", () => {
  it("finishes a complete burn before taking the next card", () => {
    const expected = [...WITH_BURN_WINDOWS.map((window) => window.phase), "settled"];
    const windows = boardStreetPhaseWindows(0);
    expect(windows).toEqual(WITH_BURN_WINDOWS);
    expect(Object.isFrozen(windows)).toBe(true);
    expect(windows.every(Object.isFrozen)).toBe(true);
    expect(boardStreetPhaseSequence(0)).toEqual(expected);
    expect(expected.indexOf("burn-release")).toBeLessThan(expected.indexOf("board-take"));

    for (const window of windows) {
      const progress = (window.start + window.end) / 2;
      const frame = boardStreetChoreographyAtProgress(0, progress);
      expect(frame.phase).toBe(window.phase);
      if (window.phase.startsWith("burn-")) {
        expect(frame.boardCard.ownership).toBe("deck");
        expect(frame.boardCard.visible).toBe(false);
      }
      if (window.phase === "board-take") {
        expect(frame.burnCard).toMatchObject({
          ownership: "discard-pile",
          arrived: true,
          released: true,
        });
      }
    }
    expect(boardStreetChoreographyAtProgress(0, 1).phase).toBe("settled");
  });

  it("continues flop cards one and two without inventing extra burns", () => {
    const expected = [...WITHOUT_BURN_WINDOWS.map((window) => window.phase), "settled"];
    expect(boardStreetPhaseWindows(1)).toEqual(WITHOUT_BURN_WINDOWS);
    expect(boardStreetPhaseSequence(1)).toEqual(expected);
    expect(boardStreetPhaseSequence(2)).toEqual(expected);
    for (const index of [1, 2]) {
      for (const progress of phaseProbeProgresses(index)) {
        const frame = boardStreetChoreographyAtProgress(index, progress);
        expect(frame.burnCard).toMatchObject({
          required: false,
          visible: false,
          ownership: "not-required",
        });
      }
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
    for (const cardIndex of [0, 1, 2, 3, 4]) {
      const windows = boardStreetPhaseWindows(cardIndex);
      expect(windows[0]?.start).toBe(0);

      for (let windowIndex = 1; windowIndex <= windows.length; windowIndex += 1) {
        const previousWindow = windows[windowIndex - 1]!;
        const nextWindow = windows[windowIndex];
        const boundary = previousWindow.end;
        expect(nextWindow?.start ?? 1).toBe(boundary);
        expect(boundary).toBeGreaterThan(previousWindow.start);

        const before = boardStreetChoreographyAtProgress(
          cardIndex,
          boundary - BOUNDARY_EPSILON,
        );
        const exact = boardStreetChoreographyAtProgress(cardIndex, boundary);
        const after = boardStreetChoreographyAtProgress(
          cardIndex,
          boundary + BOUNDARY_EPSILON,
        );
        const nextPhase = nextWindow?.phase ?? "settled";

        expect(before.phase).toBe(previousWindow.phase);
        expect(exact.phase).toBe(nextPhase);
        expect(after.phase).toBe(nextPhase);
        expect(before.phaseProgress).toBeGreaterThan(0.999);
        expect(exact.phaseProgress).toBe(nextWindow ? 0 : 1);
        expect(exact.complete).toBe(nextWindow === undefined);
        expectPositionsNear(
          before,
          exact,
          0.00001,
          `card ${cardIndex} entering ${nextPhase}`,
        );
        expectPositionsNear(
          exact,
          after,
          0.00001,
          `card ${cardIndex} leaving boundary into ${nextPhase}`,
        );
      }

      let previous = boardStreetChoreographyAtProgress(cardIndex, 0);
      for (let step = 1; step <= PATH_SAMPLE_STEPS; step += 1) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, step / PATH_SAMPLE_STEPS);
        expectPositionsNear(
          previous,
          frame,
          MAX_NORMALIZED_POINT_SPEED / PATH_SAMPLE_STEPS,
          `card ${cardIndex} path sample ${step}`,
        );
        previous = frame;
      }
    }
  });

  it("never creates an unsupported airborne card and keeps flip clearance low", () => {
    for (const cardIndex of [0, 1, 2, 3, 4]) {
      for (const progress of representativeProgresses(cardIndex)) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, progress);
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
    for (const cardIndex of [0, 1, 2, 3, 4]) {
      const flip = boardStreetPhaseWindows(cardIndex)
        .find((window) => window.phase === "board-flip")!;
      const first = boardStreetChoreographyAtProgress(cardIndex, flip.start);
      const middle = boardStreetChoreographyAtProgress(
        cardIndex,
        (flip.start + flip.end) / 2,
      );
      const last = boardStreetChoreographyAtProgress(
        cardIndex,
        flip.end - BOUNDARY_EPSILON,
      );

      expect([first.phase, middle.phase, last.phase]).toEqual([
        "board-flip", "board-flip", "board-flip",
      ]);
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
    for (const cardIndex of [0, 1, 2, 3, 4]) {
      const target = communityCardTarget(cardIndex);
      for (const progress of phaseProbeProgresses(cardIndex)) {
        const frame = boardStreetChoreographyAtProgress(cardIndex, progress);
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
