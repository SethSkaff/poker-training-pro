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

  it("reserves a readable panel behind the projected amount", async () => {
    const sceneSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./tableScene.ts", import.meta.url), "utf8"),
    );
    expect(sceneSource).toContain('context.fillStyle = "#111714"');
    expect(sceneSource).toContain("context.fillRect(4, 11, canvas.width - 8, canvas.height - 22)");
    expect(sceneSource).not.toContain("opacity: 0.86, blending: AdditiveBlending");
  });
});
