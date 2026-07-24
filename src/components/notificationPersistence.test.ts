import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(path.join(componentsRoot, name), "utf8");
}

describe("player-facing notification persistence", () => {
  it("does not auto-dismiss teaching, math feedback, or support/error status", () => {
    for (const component of [
      "SettingsPanel.tsx",
      "AboutSupport.tsx",
      "RecoveryScreen.tsx",
      "SaveDataControls.tsx",
    ]) {
      expect(source(component), component).not.toMatch(/set(?:Timeout|Interval)\s*\(/);
    }
    const table = source("PokerTable.tsx");
    expect(table).not.toMatch(/setTimeout\s*\(/);
    expect(table).toContain("setElapsedMs");
    expect(table).toContain("Got it");
    expect(table).toContain("Next hand");
    expect(table).toContain("Review");
  });

  it("keeps the only loading timer paired with an explicit cancel path", () => {
    const loader = source("SceneLoader.tsx");
    expect(loader).toContain("window.setTimeout");
    expect(loader).toContain("Cancel and go back");
    expect(loader).toContain("This is taking longer than expected.");
  });
});
