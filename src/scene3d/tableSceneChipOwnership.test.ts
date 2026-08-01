import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scene = readFileSync(resolve(process.cwd(), "src/scene3d/tableScene.ts"), "utf8");

describe("chip ownership choreography", () => {
  it("keeps a separate travelling pile between the owner rack and betting circle", () => {
    expect(scene).toContain('chips-moving-from-stack');
    expect(scene).toContain('restingChipStackPosition(pose)');
    expect(scene).toContain('betCirclePosition(pose)');
    expect(scene).toContain('view.travellingChips.visible = true');
  });

  it("grows the pot only as a collection sweep progresses", () => {
    expect(scene).toContain('pot.amount - collectedNow + Math.round(collectedNow * transition!.progress)');
    expect(scene).toContain('transition?.action === "collect"');
  });
});
