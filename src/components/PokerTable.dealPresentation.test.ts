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
    expect(tableSource).toContain("cardsDealt={cardsDealt}");
    expect(tableSource).toContain("disabled={Boolean(action) || !cardsDealt}");
    expect(tableSource).toContain("const isShowingCards = !isHero && !isOut && cardsDealt");
    expect(tableSource).toContain('card={{ rank: "A", suit: "spades" }}');
    expect(tableSource).toContain('card={{ rank: "K", suit: "hearts" }}');
  });

  it("gives opponents and hero a dealer-origin deal keyframe", () => {
    expect(styles).toContain(".poker-table.is-dealing-hole-cards .opponent-cards");
    expect(styles).toContain("@keyframes hero-card-deal");
    expect(styles).toContain(".poker-table.is-dealing-hole-cards .hero-hole-cards");
  });
});
