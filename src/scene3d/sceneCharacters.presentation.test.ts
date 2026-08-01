import { describe, expect, it } from "vitest";
import { Box3, Mesh, MeshStandardMaterial } from "three";
import { describeOpponentCharacter, OUTFITS } from "../lib/opponentAppearance";
import {
  DEALER_CAP_COVERAGE,
  DEALER_FACE_FEATURE_LIMITS,
  buildCharacter,
  buildDealer,
} from "./sceneCharacters";
import { createSceneResourceLedger } from "./sceneResources";

function meshesNamed(root: { traverse(callback: (node: unknown) => void): void }, name: string): Mesh[] {
  const matches: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh && node.name === name) matches.push(node);
  });
  return matches;
}

describe("scene character presentation", () => {
  it("gives every wardrobe option a separate, visible construction detail", () => {
    const identities = Array.from({ length: 800 }, (_, index) => `wardrobe-${index}`);
    for (const outfit of OUTFITS) {
      const id = identities.find((candidate) => describeOpponentCharacter(candidate).outfit.name === outfit.name);
      expect(id, `missing deterministic sample for ${outfit.name}`).toBeTruthy();
      const ledger = createSceneResourceLedger();
      const view = buildCharacter(describeOpponentCharacter(id!), ledger);
      expect(meshesNamed(view.root, "garment-base")).toHaveLength(1);
      expect(meshesNamed(view.root, "garment-trim")).toHaveLength(1);
      const [construction] = meshesNamed(view.root, "garment-construction");
      expect(construction, `${outfit.name} must have a visible layered construction detail`).toBeTruthy();
      const material = construction.material as MeshStandardMaterial;
      expect(material).toBeInstanceOf(MeshStandardMaterial);
      // Casino lighting should read as cloth, not plastic or glowing vinyl.
      expect(material.roughness).toBeGreaterThanOrEqual(0.6);
      expect(material.metalness).toBe(0);
      ledger.dispose();
    }
  });

  it("uses actual short sleeves for polos and tees, exposing a connected forearm", () => {
    const identities = Array.from({ length: 800 }, (_, index) => `sleeves-${index}`);
    for (const name of ["polo", "tee"]) {
      const id = identities.find((candidate) => describeOpponentCharacter(candidate).outfit.name === name);
      const ledger = createSceneResourceLedger();
      const view = buildCharacter(describeOpponentCharacter(id!), ledger);
      expect(meshesNamed(view.root, "exposed-forearm")).toHaveLength(2);
      ledger.dispose();
    }
  });

  it("builds independent shoulder and elbow pivots instead of a rigid arm bar", () => {
    const ledger = createSceneResourceLedger();
    const view = buildCharacter(describeOpponentCharacter("articulated-opponent"), ledger);
    expect(view.leftShoulder.parent).toBe(view.arms);
    expect(view.rightShoulder.parent).toBe(view.arms);
    expect(view.leftElbow.parent).toBe(view.leftShoulder);
    expect(view.rightElbow.parent).toBe(view.rightShoulder);
    expect(view.leftShoulder.position.equals(view.leftElbow.position)).toBe(false);
    ledger.dispose();
  });

  it("uses a continuous textured human shell rather than a missing or flat torso", () => {
    const ledger = createSceneResourceLedger();
    const view = buildCharacter(describeOpponentCharacter("sculpted-card-room-player"), ledger);
    const [garment] = meshesNamed(view.root, "garment-base");
    expect(garment).toBeTruthy();
    expect(garment.geometry.getAttribute("position").count).toBeGreaterThan(30);
    // The surface has UVs even though the present material is procedural. This
    // keeps the model ready for a fabric texture without a geometry rewrite.
    expect(garment.geometry.getAttribute("uv").count).toBeGreaterThan(30);
    ledger.dispose();
  });

  it("gives the dealer readable facial features and a neutral uniform cap", () => {
    const ledger = createSceneResourceLedger();
    const dealer = buildDealer("#d8ab86", ledger);
    const [features] = meshesNamed(dealer.root, "dealer-face-features");
    const [cap] = meshesNamed(dealer.root, "dealer-cap");
    expect(features).toBeTruthy();
    expect(cap).toBeTruthy();
    expect(meshesNamed(dealer.root, "dealer-tie")).toHaveLength(1);

    // A face at this scale needs features that read as features, not a visor-
    // sized pair of eyes and a mouth spanning the skull.
    const featureBox = new Box3().setFromObject(features);
    expect(featureBox.max.x - featureBox.min.x).toBeLessThanOrEqual(DEALER_FACE_FEATURE_LIMITS.maxFeatureBandWidth);
    expect(featureBox.max.y - featureBox.min.y).toBeLessThan(0.12);

    const skin = dealer.body.children.find(
      (child) => child instanceof Mesh
        && (child.material as { color?: { getHex(): number } }).color?.getHex() === 0xd8ab86,
    );
    expect(skin).toBeTruthy();
    const headBox = new Box3().setFromObject(skin!);
    const capBox = new Box3().setFromObject(cap);
    // The cap crown must cover the top of the vertically stretched head. This
    // catches the old green-ring silhouette that left a bald dome above it.
    expect(capBox.max.y).toBeGreaterThanOrEqual(headBox.max.y);
    expect(capBox.max.y - headBox.min.y).toBeGreaterThan(DEALER_CAP_COVERAGE.crownTopFromHeadCentre);
    ledger.dispose();
  });
});
