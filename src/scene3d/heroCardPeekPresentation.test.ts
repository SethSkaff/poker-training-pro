import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const scene = readFileSync(path.join(root, "tableScene.ts"), "utf8");
const snapshot = readFileSync(path.join(root, "tableSceneSnapshot.ts"), "utf8");

describe("hero card peek presentation", () => {
  it("uses asymmetric side-shield and rear-brace hands without legacy overlap props", () => {
    expect(scene).toContain("function buildHeroPeekHands");
    expect(scene).toContain('leftPalm.name = "hero-left-palm-facing-right";');
    expect(scene).toContain('rightPalm.name = "hero-right-palm-behind-cards";');
    expect(scene).toContain('"hero-right-centre-thumb"');
    expect(scene).toContain('hands.userData.rig = "left-side-shield/right-rear-brace/centre-thumb";');
    expect(scene).not.toContain("buildHeroPeekHandsLegacy");
    expect(scene).not.toContain("cornerFoldGeometry");
    expect(scene).not.toContain('fold.name = "card-fold"');
  });

  it("keeps the real-card reveal private to an active hero peek", () => {
    expect(snapshot).toContain("input.heroPeeked || revealed.has(player.id)");
    expect(snapshot).toContain("input.heroPeeked || revealed.has(player.id) ? input.heroCardCodes ?? [] : []");
    expect(scene).toContain("const squeezing = seat.isHero && peeked && !folded");
  });

  it("keeps the planted half backed and authorises a face only on the grouped bent half", () => {
    expect(scene).toContain("mesh.geometry = squeezing ? resources.heroPeekCardGeometry : resources.cardGeometry;");
    expect(scene).toContain("mesh.material = squeezing\n      ? [deckBack, code ? resources.heroPeekFaceMaterial(code) : resources.cardMaterial]");
    expect(scene).toContain("mesh.userData.privateCodeAuthorised = squeezing && Boolean(code);");
    expect(scene).toContain("geometry.addGroup(0, 6, 0);");
    expect(scene).toContain("geometry.addGroup(6, rows * 6, 1);");
    expect(scene).not.toContain('peekFace.name = "hero-peek-face";');
  });

  it("bends only the upper half with the authored card UV orientation", () => {
    expect(scene).toContain("function heroPeekCardGeometry(): BufferGeometry");
    expect(scene).toContain("const rows = 12;");
    expect(scene).toContain("const hingeRadians = HERO_PEEK_HINGE_DEGREES * Math.PI / 180;");
    expect(scene).toContain("plantedFraction: HERO_PEEK_CARD_PLANTED_FRACTION");
    expect(scene).toContain("exposedFraction: HERO_PEEK_CARD_EXPOSED_FRACTION");
    expect(scene).toContain("const material = track(source.clone());");
    expect(scene).toContain("material.emissiveIntensity = 0.32;");
    expect(scene).toContain("fullCard: false");
    expect(scene).not.toContain("fullCard: true");
    expect(scene).toContain("uvs.push(...heroPeekFaceUvForLocalPoint(x, progress * HERO_PEEK_CARD_EXPOSED_FRACTION));");
    expect(scene).toContain("indices.push(left, left + 1, left + 2, left + 1, left + 3, left + 2);");
    expect(scene).not.toContain("indices.push(left, left + 2, left + 1, left + 1, left + 2, left + 3);");
    expect(scene).toContain("card.rotation.x = 0;");
    expect(scene).toContain("const spread = squeezing ? 0.040 : 0.055;");
  });
});
