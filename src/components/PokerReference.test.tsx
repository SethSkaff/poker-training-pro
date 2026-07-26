import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PokerReferenceContent } from "./PokerReference";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
const table = readFileSync(
  path.join(sourceRoot, "components", "PokerTable.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  path.join(sourceRoot, "components", "Dashboard.tsx"),
  "utf8",
);

describe("standalone poker reference", () => {
  const markup = renderToStaticMarkup(<PokerReferenceContent />);

  it("covers hand rankings, betting terms, shortcuts, and worked examples", () => {
    // All ten hand ranks, in order.
    for (const rank of [
      "Royal flush",
      "Straight flush",
      "Four of a kind",
      "Full house",
      "Flush",
      "Straight",
      "Three of a kind",
      "Two pair",
      "Pair",
      "High card",
    ]) {
      expect(markup).toContain(rank);
    }
    expect(markup.indexOf("Royal flush")).toBeLessThan(
      markup.indexOf("High card"),
    );
    // Betting and tournament terms, probability shortcuts, worked examples.
    for (const term of [
      "Pot odds",
      "Minimum raise",
      "Side pot",
      "Bubble",
      "Rule of 2",
      "Worked call",
      "Expected value",
    ]) {
      expect(markup).toContain(term);
    }
  });

  it("is reachable outside a hand as well as from the pause menu", () => {
    // The menu route...
    expect(dashboard).toContain('onSelect("reference")');
    expect(app).toContain('screen === "reference"');
    expect(app).toContain("<PokerReferenceContent />");
    // ...and the in-hand pause page, using the same component.
    expect(table).toContain("<PokerReferenceContent />");
  });

  it("has exactly one source of reference content", () => {
    // The pause menu used to own this markup outright. If a second copy is
    // ever reintroduced the two will drift, so assert the table renders the
    // shared component rather than its own hand-rank list.
    expect(table).not.toContain('<ol className="hand-ranking-list">');
    expect(table).not.toContain("table.formula.potOdds.label");
  });
});
