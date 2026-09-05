import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableViewSelect } from "./Dashboard";
import { BlackjackTrainer } from "./BlackjackTrainer";

describe("Blackjack training surface", () => {
  it("places the product selector directly before Poker's existing table choices", () => {
    const markup = renderToStaticMarkup(
      <TableViewSelect
        initialSpatialScene={false}
        initialProductMode="poker"
        onBack={() => undefined}
        onProductModeChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('value="poker"');
    expect(markup).toContain('value="blackjack"');
    expect(markup.indexOf("Blackjack")).toBeLessThan(markup.indexOf("2D Table"));
    expect(markup.indexOf("Training system")).toBeLessThan(markup.indexOf("2D Table"));
  });

  it("exposes all four Blackjack training sections without changing Poker's route", () => {
    const markup = renderToStaticMarkup(
      <BlackjackTrainer onBack={() => undefined} onProductModeChange={() => undefined} />,
    );

    expect(markup).toContain("Quick Count");
    expect(markup).toContain("Tables");
    expect(markup).toContain("Trainer");
    expect(markup).toContain("Guide");
    expect(markup).not.toContain("Blackjack training system</p>");
    expect(markup).not.toContain("Only the final running count is graded.");
    expect(markup).not.toContain("Start at running count 0.");
    expect(markup).not.toContain("no 3D Blackjack view");
  });
});
