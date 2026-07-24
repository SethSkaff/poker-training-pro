import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function iosSource(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, "ios", relativePath), "utf8");
}

describe("iOS adaptive table layout contract", () => {
  it("keeps only decoration under system areas and adapts cards, players, and actions", () => {
    const table = iosSource("PokerTrainingPro/Views/PokerTableView.swift");
    const startMenu = iosSource("PokerTrainingPro/Views/StartMenuView.swift");

    expect(table).toContain("ScrollView(.horizontal, showsIndicators: false)");
    expect(table).toContain("ViewThatFits(in: .horizontal)");
    expect(table).toContain("private func playerRow");
    expect(table).toContain("@ScaledMetric(relativeTo: .body)");
    expect(table).toContain('Button("Skip opponent animation")');
    expect(table).toContain("timing.finish()");
    expect(startMenu).toContain("BrandTheme.background.ignoresSafeArea()");
    expect(table.match(/ignoresSafeArea\(\)/g)).toHaveLength(1);
    expect(table).toContain("BrandTheme.background.ignoresSafeArea()");
  });

  it("keeps a mobile skip semantically distinct from cancellation", () => {
    const timing = iosSource("PokerTrainingPro/Views/TableTimingModel.swift");

    expect(timing).toContain("func finish()");
    expect(timing).toContain("remainingSeconds = 0");
    expect(timing).toContain("fire()");
  });
});
