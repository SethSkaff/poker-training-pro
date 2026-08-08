import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("current acting-seat indicator", () => {
  it("is bound to the engine snapshot rather than a roster-specific id", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./PokerTable.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("isActing={scenario.actingPlayerId === player.id}");
    expect(source).toContain('<i className="thinking-ring" />');
    expect(source).not.toMatch(/player\.id\s*===\s*["']maya["']/);
  });

  it("keeps a visible public action-history control for discovering order", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./PokerTable.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain('className="hand-history-popover"');
    expect(source).toContain("tournament.actionHistory.map");
  });
});
