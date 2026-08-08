import { describe, expect, it } from "vitest";
import { cameraInterpolationAlpha } from "./tableScene";

describe("table-scene camera motion", () => {
  it("does not consume a suspended interval as visible camera movement", () => {
    const beforeSuspend = 1_000;
    const resumeAt = 12_000;

    // Without resetting the renderer-local frame clock, this long pause would
    // nearly complete the pan on the first frame after resume.
    expect(cameraInterpolationAlpha(beforeSuspend, resumeAt)).toBeGreaterThan(0.99);
    // suspend/resume reset the clock to `resumeAt`, so the next visible frame
    // retains a gradual, 16 ms camera step.
    expect(cameraInterpolationAlpha(resumeAt, resumeAt + 16)).toBeLessThan(0.12);
  });
});
