import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const table = readFileSync(
  path.join(sourceRoot, "components", "PokerTable.tsx"),
  "utf8",
);

describe("table UI restraint and card peek", () => {
  it("does not render the redundant bottom shortcut bar or floating camera menu", () => {
    expect(table).not.toContain('className="table-footer"');
    expect(table).not.toContain('className="camera-controls"');
    expect(table).not.toContain("table.footer.quickRaise");
    expect(table).not.toContain("table.camera.viewLabel");
  });

  it("keeps card taps as a private toggle while preserving drag-fold protection", () => {
    expect(table).toContain('className={`hero-hole-cards ${peeked ? "is-peeked" : ""}');
    expect(table).toContain("setPeeked((value) => !value)");
    expect(table).toContain("const shouldFold = !cancelled && didDrag.current && foldProgress >= 82");
    expect(table).toContain("disabled={Boolean(action) || !cardsDealt || heroFolded}");
    // Opponent cards remain hidden until a legal public showdown reveal.
    expect(table).toContain("hidden={!peeked && !showdownHeroRevealed}");
  });

  it("keeps the existing keyboard peek action available through the shared action map", () => {
    expect(table).toContain('case "game.peek":');
    expect(table).toContain("runGameAction(actionId)");
  });
});
