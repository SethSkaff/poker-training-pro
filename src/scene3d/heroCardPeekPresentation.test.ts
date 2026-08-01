import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const scene = readFileSync(path.join(root, "tableScene.ts"), "utf8");
const snapshot = readFileSync(path.join(root, "tableSceneSnapshot.ts"), "utf8");

describe("hero card peek presentation", () => {
  it("uses a two-hand shield and retires the old floating corner flap", () => {
    expect(scene).toContain("function buildHeroPeekHands");
    expect(scene).toContain("Four curled fingers cross the card's far edge");
    expect(scene).toContain("The old folded corner is intentionally retired during the full physical");
    expect(scene).not.toContain("The folded-back corner of a card, as a flat triangle");
    expect(scene).not.toContain("const positions = new Float32Array([...creaseA, ...creaseB, ...tip])");
  });

  it("keeps the real-card reveal private to an active hero peek", () => {
    expect(snapshot).toContain("input.heroPeeked || revealed.has(player.id)");
    expect(snapshot).toContain("input.heroPeeked || revealed.has(player.id) ? input.heroCardCodes ?? [] : []");
    expect(scene).toContain("const squeezing = seat.isHero && peeked && !folded");
  });

  it("paints the hero's card faces while peeking, and retains card backs when no face code is authorised", () => {
    /*
      `publicCardCodes` is intentionally empty for a closed hero hand.  The
      renderer must not add a second `!squeezing` condition here: that was the
      regression which made the active private peek continue to show only two
      card backs.  A code can only enter the snapshot for an active hero peek
      or an engine-authorised public reveal, so it is safe and required to use
      the face material directly.
    */
    expect(scene).toContain("mesh.material = code\n      ? resources.cardFaceMaterial(code)");
    expect(scene).toContain(": resources.deckBackMaterial(deckColourForHand(handId ?? transition?.handId));");
    expect(scene).not.toContain("mesh.material = code && !squeezing");
  });

  it("uses an actual curved exposed half-card instead of rotating a full card", () => {
    expect(scene).toContain("function flexedHeroPeekGeometry(): BufferGeometry");
    expect(scene).toContain("const strips = 8;");
    expect(scene).toContain("Math.sin(progress * Math.PI * 0.5) * 0.062");
    expect(scene).toContain("mesh.geometry = squeezing ? resources.heroPeekGeometry : resources.cardGeometry;");
    expect(scene).toContain("card.rotation.x = 0;");
    expect(scene).toContain("card.rotation.y = squeezing ? (index === 0 ? 0.025 : -0.025) : 0;");
    expect(scene).toContain("view.hand.position.set(local[0], local[1] + 0.030, local[2] - 0.108);");
    expect(scene).toContain("fold.visible = false;");
  });
});
