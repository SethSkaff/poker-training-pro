import { describe, expect, it } from "vitest";
import { POT_HOLOGRAM, potHologramLabel } from "./potHologramPresentation";

describe("pot hologram presentation", () => {
  it("uses a thin vertical projection from the centre of the chip pile", () => {
    expect(POT_HOLOGRAM.beamRadius).toBeLessThan(0.003);
    expect(POT_HOLOGRAM.beamStartHeight).toBeGreaterThan(0);
    expect(POT_HOLOGRAM.labelHeight).toBeGreaterThan(POT_HOLOGRAM.beamStartHeight);
  });

  it("keeps the compact public amount labels", () => {
    expect(potHologramLabel("main", 751)).toBe("POT 751");
    expect(potHologramLabel("side", 2_500)).toBe("SIDE 2.5K");
  });
});
