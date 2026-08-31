import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentDir = path.dirname(fileURLToPath(import.meta.url));
const tableSource = readFileSync(path.join(componentDir, "PokerTable.tsx"), "utf8");
const styles = readFileSync(path.join(componentDir, "..", "styles.css"), "utf8");

describe("hole-card deal presentation", () => {
  it("gates hero interaction on the public deal event and passes deal state to seats", () => {
    expect(tableSource).toContain('presentationEvent?.kind === "hole-cards-dealt"');
    expect(tableSource).toContain("setCardsDealtHandId(presentationEvent.handId)");
    expect(tableSource).toContain("!presentationEvent && tournament.heroDecision");
    expect(tableSource).toContain("dealtCardCount={dealtCardCountForPlayer(player.id)}");
    /*
      Hero interaction stays gated on the public deal event and on a pending
      action, and is now additionally gated on the hand being mucked (E27-001):
      folded cards must not be peekable or draggable for the rest of the hand.
      Asserted as three separate conditions rather than one exact expression, so
      strengthening the gate does not read as breaking it.
    */
    expect(tableSource).toMatch(
      /disabled=\{Boolean\(action\) \|\| heroDealtCardCount === 0 \|\| heroFolded\}/,
    );
    expect(tableSource).toContain("const visiblePrivateCardCount = Math.max(0, Math.min(2, Math.floor(dealtCardCount)))");
    expect(tableSource).toContain("scenario.heroCards.slice(0, heroDealtCardCount)");
    expect(tableSource).toContain("card.assignment.recipientId === playerId && card.viewable");
    expect(tableSource).toContain("hasRevealedCards");
    expect(tableSource).toContain("revealedCards.map((card)");
    expect(tableSource).toContain('card={{ rank: "A", suit: "spades" }}');
  });

  it("gives opponents and hero a dealer-origin deal keyframe", () => {
    expect(styles).toContain(".poker-table.is-dealing-hole-cards .opponent-cards");
    expect(styles).toContain("@keyframes hero-card-deal");
    expect(styles).toContain(".poker-table.is-dealing-hole-cards .hero-hole-cards");
  });

  it("holds the prior hand's deck identity until its cards-collected beat completes", () => {
    expect(tableSource).toContain('if (event?.kind === "cards-collected") return;');
    expect(tableSource).toContain(
      "if (!event && tournament && cardsDealtHandId !== scenario.id) return;",
    );
    expect(tableSource).toContain("const sceneHandId =");
    expect(tableSource).toContain(
      "tournament?.presentationEvent?.handId ??",
    );
  });
});
