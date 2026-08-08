import { describe, expect, it } from "vitest";
import {
  HERO_PEEK_CARD_EXPOSED_FRACTION,
  HERO_PEEK_CARD_LENGTH,
  HERO_PEEK_CARD_PLANTED_FRACTION,
  HERO_PEEK_HAND_RIG,
  HERO_PEEK_HAND_ROOT_OFFSET,
  HERO_PEEK_HINGE_DEGREES,
  HERO_PEEK_TABLE_CLEARANCE,
  heroPeekProjectedLayout,
  heroPeekFaceUvForLocalPoint,
  type InterfaceScale,
} from "./heroPeekPresentation";
import { tableMeshGeometry } from "./tableGeometryLibrary";

describe("hero peek projected protected windows", () => {
  const scales: InterfaceScale[] = ["compact", "standard", "large", "extra-large"];
  it("uses the authored board-card UV direction on the exposed upper half", () => {
    // The exposed surface is the underside. U is intentionally flipped once
    // relative to the board so the rank is not mirrored from the hero camera.
    expect(heroPeekFaceUvForLocalPoint(-0.044, 0)).toEqual([0, 0.02]);
    expect(heroPeekFaceUvForLocalPoint(0.044, 0)).toEqual([1, 0.02]);
    expect(heroPeekFaceUvForLocalPoint(0.044, 0.5)).toEqual([1, 0.50]);
    expect(heroPeekFaceUvForLocalPoint(0.044, 1)).toEqual([1, 0.98]);
    expect(heroPeekFaceUvForLocalPoint(0.044, 1)[1])
      .toBeGreaterThan(heroPeekFaceUvForLocalPoint(0.044, 0)[1]);
  });

  it("matches all four actual board-card corner directions instead of mirroring them", () => {
    const geometry = tableMeshGeometry("card");
    const positions = geometry.getAttribute("position");
    const uvs = geometry.getAttribute("uv");
    const nearestCorner = (targetX: number, targetZ: number) => Array
      .from({ length: positions.count }, (_, index) => index)
      .filter((index) => positions.getY(index) > 0)
      .sort((left, right) => (
        (positions.getX(left) - targetX) ** 2 + (positions.getZ(left) - targetZ) ** 2
      ) - (
        (positions.getX(right) - targetX) ** 2 + (positions.getZ(right) - targetZ) ** 2
      ))[0]!;
    const cases = [
      [0.040, -0.061, 0, 0],
      [-0.040, -0.061, 1, 0],
      [0.040, 0.061, 0, 1],
      [-0.040, 0.061, 1, 1],
    ] as const;
    for (const [x, z, expectedU, expectedV] of cases) {
      const index = nearestCorner(x, z);
      expect(expectedU === 0 ? uvs.getX(index) : 1 - uvs.getX(index)).toBeLessThan(0.1);
      expect(expectedV === 0 ? uvs.getY(index) : 1 - uvs.getY(index)).toBeLessThan(0.1);
    }
    expect(heroPeekFaceUvForLocalPoint(0.044, 0)).toEqual([1, 0.02]);
    geometry.dispose();
  });

  it("keeps the left hand outside the packet and the right hand behind it", () => {
    const layout = heroPeekProjectedLayout({
      pan: 0,
      cameraView: "standard",
      viewportWidth: 1366,
      viewportHeight: 768,
      interfaceScale: "standard",
    });
    const leftCardOuterEdge = 0.040 + 0.088 / 2;
    expect(HERO_PEEK_HAND_RIG.left.wrist[0]).toBeGreaterThan(leftCardOuterEdge);
    expect(HERO_PEEK_HAND_RIG.left.wrist[0]).toBeLessThan(leftCardOuterEdge + 0.02);
    expect(HERO_PEEK_HAND_RIG.right.wrist[0]).toBeLessThan(0);
    expect(HERO_PEEK_HAND_RIG.left.elbow[1]).toBeGreaterThanOrEqual(HERO_PEEK_TABLE_CLEARANCE);
    expect(HERO_PEEK_HAND_RIG.right.elbow[1]).toBeGreaterThanOrEqual(HERO_PEEK_TABLE_CLEARANCE);
    expect(HERO_PEEK_HAND_ROOT_OFFSET.y).toBeGreaterThan(0);
    expect(layout.handBounds).toHaveLength(2);
    expect(layout.handDepths[1]).toBeGreaterThan(layout.cardFarEdgeDepth);
    expect(HERO_PEEK_HAND_RIG.right.wrist[2]).toBeGreaterThan(HERO_PEEK_CARD_LENGTH / 2);
  });

  it("keeps the side shield clear in the seated view while the rear brace stays depth-occluded", () => {
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
          // The physical local-X clearance above is the invariant. At oblique
          // pans an outside hand can project over a corner even while the
          // raised card remains in front of it in depth; that is verified by
          // the packaged raster audit rather than a 2D rectangle intersection.
          expect(layout.handBounds).toHaveLength(2);
          expect(layout.protectedIndexBounds).toHaveLength(2);
          expect(layout.handDepths[1], `${cameraView}/${pan}/${interfaceScale}`)
            .toBeGreaterThan(layout.cardFarEdgeDepth);
        }
      }
    }
  });

  it("keeps most of the card planted while lifting the readable half to the hand", () => {
    expect(HERO_PEEK_CARD_PLANTED_FRACTION).toBeCloseTo(0.35);
    expect(HERO_PEEK_CARD_EXPOSED_FRACTION).toBeCloseTo(0.65);
    expect(HERO_PEEK_HINGE_DEGREES).toBeGreaterThanOrEqual(65);
    expect(HERO_PEEK_CARD_EXPOSED_FRACTION).toBeGreaterThan(HERO_PEEK_CARD_PLANTED_FRACTION);
  });
});
