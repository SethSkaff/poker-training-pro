import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scene = readFileSync(resolve(process.cwd(), "src/scene3d/tableScene.ts"), "utf8");

describe("chip ownership choreography", () => {
  it("moves exact selected rack chips under the owner's left hand", () => {
    expect(scene).toContain('chips-moving-from-stack');
    expect(scene).toContain('restingChipStackPosition(pose, chipCommitment?.stackBefore ?? seat.stack)');
    expect(scene).toContain('if (isCommitting && betFrame) return betFrame.hand.position;');
    expect(scene).toContain('chip.ownership !== "rack"');
    expect(scene).toContain('setTravellingChipFrames(view.travellingChips, physicalChips, pose, resources)');
    expect(scene).toContain('setChipStack(view.stackChips, rackLayoutAmount, resources, excludedRackChipIds)');
    expect(scene).toContain('betCirclePosition(pose)');
    expect(scene).toContain('view.travellingChips.visible = true');
  });

  it("grows the pot only as a collection sweep progresses", () => {
    expect(scene).toContain('pot.amount - collectedNow + Math.round(collectedNow * transition!.progress)');
    expect(scene).toContain('transition?.action === "collect"');
  });
});
