import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(directory, "PokerTable.tsx"), "utf8");
const styles = readFileSync(path.join(directory, "..", "styles.css"), "utf8");

describe("committed wager presentation", () => {
  it("shows an opponent wager only when chips are actually committed", () => {
    /*
      The hero's committed wager now shows at the hero's seat like everyone
      else's (E27-008). It used to be excluded here and duplicated in a floating
      panel instead, which is why the condition was hero-specific. The rule the
      test guards is unchanged: a wager appears only when chips are actually
      committed.
    */
    expect(source).not.toContain("!isHero && player.bet > 0");
    expect(source).toContain("{player.bet > 0 && (");
    expect(source).not.toContain('formatMessage("table.seat.committed")');
    expect(source).toContain('<b>{formatChips(player.bet)}</b>');
  });

  it("keeps the wager lane clear of the balance plate", () => {
    expect(styles).toMatch(/\.seat-bet[\s\S]*font-variant-numeric:\s*tabular-nums/);
    expect(styles).toMatch(/\.seat-bet\s*\{[\s\S]*?z-index:\s*3/);
  });

  it("uses the total all-in-to amount for both the slider value domain and action", () => {
    expect(source).toContain("max={allInAmount}");
    expect(source).toContain('step="any"');
    expect(source).toContain("snapRaiseSliderToAmount(Number(event.target.value)");
    expect(source).toContain("allInTo: allInAmount");
    expect(source).toContain("snapRaiseSliderToAmount(amount, {");
    expect(source).toContain('handleAction(raiseAmount >= allInAmount ? "all-in" : "raise")');
    expect(source).not.toContain("max={maximumRaise}");
  });
});
