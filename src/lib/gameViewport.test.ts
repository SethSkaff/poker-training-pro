import { describe, expect, it } from "vitest";
import { clientToGamePoint, fitGameViewport, GAME_HEIGHT, GAME_WIDTH } from "./gameViewport";

describe("desktop 2D game camera", () => {
  it.each([
    [1280, 720, 2 / 3, 0, 0],
    [1920, 1080, 1, 0, 0],
    [2560, 1440, 4 / 3, 0, 0],
    [3840, 2160, 2, 0, 0],
    [3440, 1440, 4 / 3, 440, 0],
    [1000, 1200, 1000 / 1920, 0, 318.75],
    [600, 900, 600 / 1920, 0, 281.25],
  ])("fits %ix%i without changing geometry", (width, height, scale, left, top) => {
    const fit = fitGameViewport(width, height);
    expect(fit.scale).toBeCloseTo(scale);
    expect(fit.left).toBeCloseTo(left);
    expect(fit.top).toBeCloseTo(top);
    expect(fit.left * 2 + GAME_WIDTH * fit.scale).toBeCloseTo(width);
    expect(fit.top * 2 + GAME_HEIGHT * fit.scale).toBeCloseTo(height);

    const bounds = { left, top, width: GAME_WIDTH * scale };
    for (const point of [{ x: 0, y: 0 }, { x: 957, y: 862 }, { x: 1920, y: 1080 }]) {
      const actual = clientToGamePoint(left + point.x * scale, top + point.y * scale, bounds);
      expect(actual.x).toBeCloseTo(point.x);
      expect(actual.y).toBeCloseTo(point.y);
    }
    const start = clientToGamePoint(left + 960 * scale, top + 880 * scale, bounds);
    const end = clientToGamePoint(left + 960 * scale, top + 755 * scale, bounds);
    expect(start.y - end.y).toBeCloseTo(125);
  });

  it("handles an unmeasurable viewport without non-finite transforms", () => {
    expect(fitGameViewport(0, 0)).toEqual({ scale: 0, left: 0, top: 0 });
  });
});
