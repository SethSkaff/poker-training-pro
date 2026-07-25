import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { presentationEventDelayMs } from "./tournamentPresentationClock";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

const boardEvent: TournamentPresentationEvent = {
  id: "motion:hand-1:board-card-dealt:0",
  kind: "board-card-dealt",
  handId: "hand-1",
  street: "flop",
  cardIndex: 0,
  card: { rank: "A", suit: "spades" },
};

describe("tiered motion policy", () => {
  it("limits app and OS reduced motion to the explicit vestibular tier", () => {
    expect(styles).toContain(".motion-vestibular");
    expect(styles).toContain(".reduced-motion .motion-vestibular");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toContain(".reduced-motion *,");
    expect(styles).not.toContain("@media (prefers-reduced-motion: reduce) {\n  *,");
  });

  it("retains a readable state-change interval under every presentation setting", () => {
    for (const settings of [
      { reducedMotion: false, transitionMotion: "full" as const },
      { reducedMotion: false, transitionMotion: "reduced" as const },
      { reducedMotion: false, transitionMotion: "off" as const },
      { reducedMotion: true, transitionMotion: "full" as const },
    ]) {
      expect(presentationEventDelayMs(boardEvent, 4, settings)).toBeGreaterThanOrEqual(120);
    }
  });

  it("shortens but does not remove table-state feedback when table motion is off", () => {
    const tableOff = styles.slice(styles.indexOf(':root[data-motion-table="off"]'));
    expect(tableOff).toContain(".seat-state--winner");
    expect(tableOff).toContain("animation-duration: 120ms !important");
  });
});
