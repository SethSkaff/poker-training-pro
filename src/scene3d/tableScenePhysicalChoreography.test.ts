import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scene = readFileSync(resolve(process.cwd(), "src/scene3d/tableScene.ts"), "utf8");

describe("physical choreography renderer integration", () => {
  it("samples one small-blind-first deal and renders its actual card meshes", () => {
    expect(scene).toContain("const holeDealFrame: HoleCardDealFrame");
    expect(scene).toContain("{ firstRecipientId: state.smallBlindPlayerId }");
    expect(scene).toContain("const target = foldCardPose?.position ?? dealCardFrame?.position");
    expect(scene).toContain('liveDeck.userData.cardOwnership = "dealer-left-hand"');
    expect(scene).not.toContain("holeCardDealProgress(");
    expect(scene).not.toContain("dealtCardPosition(");
  });

  it("uses the player and dealer right hands for the continuous fold handoff", () => {
    expect(scene).toContain("foldChoreographyAtProgress(entry.pose, renderTransition.progress)");
    expect(scene).toContain("if (foldFrame?.playerRightHand.active) return foldFrame.playerRightHand.position");
    expect(scene).toContain("activeFoldFrame.dealerRightHand.position");
    expect(scene).toContain("setHeroActionHand(view.actionHands.right, foldTarget)");
    expect(scene).not.toContain("muckedCardPosition(");
  });

  it("moves exact selected chips with the owner-side left hand", () => {
    expect(scene).toContain("createBetChoreographyPlan({");
    expect(scene).toContain("betFrame.hand.position");
    expect(scene).toContain("setHeroActionHand(view.actionHands.left, betTarget)");
    expect(scene).toContain('(gesture.movingArm === "left" && side === 1)');
    expect(scene).toContain('(gesture.movingArm === "right" && side === -1)');
    expect(scene).toContain("setTravellingChipFrames(view.travellingChips, physicalChips, pose, resources)");
    expect(scene).toContain("excludedRackChipIds");
  });

  it("renders burn, supported flip, exact placement, and no player-facing guide zones", () => {
    expect(scene).toContain("boardStreetChoreographyAtProgress(");
    expect(scene).toContain("burnCard.position.set(...burnFrame.position)");
    expect(scene).toContain("communityCardTarget(index)");
    expect(scene).toContain("cardFrame.faceUpFraction >= 0.5");
    expect(scene).not.toContain('tableMeshGeometry("table/play-zone")');
    expect(scene).not.toContain('playZones.name = "table-play-zones"');
    expect(scene).toContain('setChipStack(view.betChips, settledBet, resources, new Set(), "wager")');
    expect(scene).not.toContain("boardDealPose(");
    expect(scene).not.toContain("burnCardPose(");
  });
});
