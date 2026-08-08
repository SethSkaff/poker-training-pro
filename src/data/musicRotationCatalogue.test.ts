import { describe, expect, it } from "vitest";
import { fiveHourRotation, fiveHourRotationDurationSec, musicCatalogueCandidates } from "./musicRotationCatalogue";

describe("five-hour music rotation catalogue", () => {
  it("contains only attributed CC BY candidates and covers at least five hours", () => {
    expect(musicCatalogueCandidates).toHaveLength(16);
    expect(musicCatalogueCandidates.every((track) => track.license === "CC BY 4.0" && track.sourceUrl.startsWith("https://") && track.credit.length > 0)).toBe(true);
    expect(fiveHourRotationDurationSec).toBeGreaterThanOrEqual(5 * 60 * 60);
  });

  it("changes the start of each pass to prevent an immediate repeat", () => {
    for (let index = 1; index < fiveHourRotation.length; index += 1) {
      const previous = fiveHourRotation[index - 1];
      const current = fiveHourRotation[index];
      expect(previous[previous.length - 1]).not.toBe(current[0]);
    }
  });
});
