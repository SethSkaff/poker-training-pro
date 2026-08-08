import { describe, expect, it } from "vitest";
import {
  HERO_PEEK_CARD_LENGTH,
  HERO_PEEK_HAND_RIG,
  heroPeekProjectedLayout,
  heroPeekFaceUvForLocalPoint,
  projectedBoundsOverlap,
  type InterfaceScale,
} from "./heroPeekPresentation";

describe("hero peek projected protected windows", () => {
  const scales: InterfaceScale[] = ["compact", "standard", "large", "extra-large"];
  it("maps the player-left edge to the canvas-left index and the far edge to the upright top index", () => {
    expect(heroPeekFaceUvForLocalPoint(-0.044, 0)).toEqual([1, 0.98]);
    expect(heroPeekFaceUvForLocalPoint(0.044, 1)[0]).toBe(0);
    expect(heroPeekFaceUvForLocalPoint(0.044, 1)[1]).toBeCloseTo(0.02);
  });

  it("keeps the left hand outside the left card and the right hand behind the far edge", () => {
    const layout = heroPeekProjectedLayout({
      pan: 0,
      cameraView: "standard",
      viewportWidth: 1366,
      viewportHeight: 768,
      interfaceScale: "standard",
    });
    expect(layout.handBounds[0].xMax).toBeLessThan(layout.cardBounds[0].xMin);
    expect(layout.handDepths[1]).toBeGreaterThan(layout.cardFarEdgeDepth);
    expect(HERO_PEEK_HAND_RIG.right.wrist[2]).toBeGreaterThan(HERO_PEEK_CARD_LENGTH / 2);
  });

  it("keeps both upper-left rank/suit windows clear across camera poses and UI scales", () => {
    for (const pan of [-2, 0, 2]) {
      for (const cameraView of ["wide", "standard", "close"] as const) {
        for (const interfaceScale of scales) {
          const layout = heroPeekProjectedLayout({
            pan,
            cameraView,
            viewportWidth: 1366,
            viewportHeight: 768,
            interfaceScale,
          });
          expect(layout.cardBounds).toHaveLength(2);
          expect(layout.protectedIndexBounds).toHaveLength(2);
          expect(layout.handBounds[0] && layout.protectedIndexBounds.every(
            (index) => !projectedBoundsOverlap(layout.handBounds[0], index),
          ), `${cameraView}/${pan}/${interfaceScale}`).toBe(true);
        }
      }
    }
  });
});
