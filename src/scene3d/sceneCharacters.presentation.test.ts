import { describe, expect, it } from "vitest";
import { Mesh } from "three";
import { describeOpponentCharacter, OUTFITS } from "../lib/opponentAppearance";
import { buildCharacter, buildDealer } from "./sceneCharacters";
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

  it("gives the dealer readable facial features and a neutral uniform cap", () => {
    const ledger = createSceneResourceLedger();
    const dealer = buildDealer("#d8ab86", ledger);
    expect(meshesNamed(dealer.root, "dealer-face-features")).toHaveLength(1);
    const visor = dealer.body.children.find((child) => child instanceof Mesh && child.material instanceof Object && (child.material as { color?: { getHex(): number } }).color?.getHex() === 0x26324a);
    expect(visor).toBeTruthy();
    ledger.dispose();
  });
});
