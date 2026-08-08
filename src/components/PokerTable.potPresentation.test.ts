import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { potChipStackCount } from "./PokerTable";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("central pot presentation", () => {
  it.each([
    [0, 0],
    [1, 1],
    [10, 2],
    [100, 3],
    [10_000, 5],
    [1_000_000_000, 8],
  ])("scales chip stacks for a %s-chip pot", (pot, expected) => {
    expect(potChipStackCount(pot)).toBe(expected);
  });

  it("documents the inclusive-pot convention used by the renderer", () => {
    const contract = readFileSync(
      path.join(directory, "..", "..", "docs", "table-presentation-contract.md"),
      "utf8",
    );
    expect(contract).toContain("Inclusive-pot convention");
    expect(contract).toContain("bets-collected");
    expect(contract).toContain("pot-awarded");
  });
});

/*
  E27-002. The reported defect was a panel headed "Live pots" that listed every
  pot and a full eligibility roster, appeared before the hero had acted, and
  stayed on screen for the whole hand -- explaining in standing prose what the
  felt should have been showing in chips.

  These are source assertions rather than rendered ones on purpose: the failure
  was a permanently mounted element, so what must be guaranteed is that no such
  element exists to mount. A render test would only prove it absent for the one
  state that test happened to construct.
*/
describe("pot structure is shown on the felt, not narrated in a panel", () => {
  const source = readFileSync(
    path.join(directory, "PokerTable.tsx"),
    "utf8",
  );
  const styles = readFileSync(
    path.join(directory, "..", "styles.css"),
    "utf8",
  );

  it("has no persistent live-pot overlay", () => {
    expect(source).not.toContain("side-pot-strip--live");
    expect(source).not.toContain("Live pots");
  });

  it("does not print an eligibility roster onto the table", () => {
    // The roster still reaches assistive technology through the pot group's
    // visually-hidden description; it is never laid onto the felt.
    expect(source).not.toContain("· Eligible: ");
  });

  it("renders pots as grouped chip piles", () => {
    expect(source).toContain("pot-groups");
    expect(source).toContain("pot-group__amount");
    expect(source).toContain("potChipStackCount(group.amount)");
  });

  it("labels the piles only once the pot has actually split", () => {
    // With one pot the felt readout already carries the number; repeating it
    // under the chips would print the same figure twice.
    expect(source).toContain("potGroups.length > 1 && (");
  });

  it("keeps the public side-pot explanation available without printing it", () => {
    // `describeLiveSidePot` derives its wording only from committed chips and
    // declared eligibility, so it cannot leak a hand. It belongs in the
    // accessible description, not on the table.
    expect(source).toContain("describeLiveSidePot(pot, scenario.players)");
  });

  it("lays the pile out in flow so a split pot can sit beside the main pot", () => {
    // `.center-pot` is absolutely positioned on its own; inside a group it must
    // not be, or every pile would stack on the same point.
    expect(styles).toMatch(/\.pot-groups \.center-pot \{[^}]*position: static/);
  });

  it("keeps the group container itself anchored to the felt", () => {
    expect(styles).toMatch(/\.pot-groups \{[^}]*position: absolute/);
  });
});
