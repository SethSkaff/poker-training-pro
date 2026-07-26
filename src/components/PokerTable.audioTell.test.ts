import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicPresentationSound } from "./PokerTable";
import { tournamentResultAudioCue } from "../lib/tournamentResultAudio";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import type { Card, Rank, Suit } from "../types/poker";

/**
 * E22-002 — the no-tell guarantee, enforced rather than asserted in a comment.
 *
 * A cue that varies with hand strength would hand the player information the
 * table does not show, which is both a fairness problem and the exact
 * regression a naive "add a win sound for strong hands" change would cause.
 */

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const suits: Record<string, Suit> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

function cards(...values: string[]): Card[] {
  return values.map((value) => ({
    rank: value[0] as Rank,
    suit: suits[value[1]],
  }));
}

const handId = "tell-hand";

/** The same public event, differing only in the cards attached to it. */
function revealWith(reveals: { playerId: string; cards: Card[] }[]) {
  return {
    id: "reveal",
    kind: "all-in-reveal",
    handId,
    playerIds: reveals.map((entry) => entry.playerId),
    reveals,
  } satisfies TournamentPresentationEvent;
}

function showdownWith(reveals: { playerId: string; cards: Card[] }[]) {
  return {
    id: "showdown",
    kind: "showdown",
    handId,
    playerIds: reveals.map((entry) => entry.playerId),
    reveals,
    awards: [{ potId: "main", playerId: "hero", amount: 1_200 }],
  } satisfies TournamentPresentationEvent;
}

describe("audio has no hidden-information tell", () => {
  it("selects the same cue regardless of which cards are revealed", () => {
    // The nuts and the worst possible holding must sound identical.
    const monster = revealWith([
      { playerId: "hero", cards: cards("As", "Ks") },
      { playerId: "villain", cards: cards("Ah", "Ad") },
    ]);
    const trash = revealWith([
      { playerId: "hero", cards: cards("7c", "2d") },
      { playerId: "villain", cards: cards("8c", "3d") },
    ]);

    expect(publicPresentationSound(monster)).toBe(
      publicPresentationSound(trash),
    );
    expect(publicPresentationSound(showdownWith(monster.reveals))).toBe(
      publicPresentationSound(showdownWith(trash.reveals)),
    );
  });

  it("selects the same cue regardless of the winning hand category", () => {
    const withCategory = (categoryName: string): TournamentPresentationEvent => ({
      id: "awarded",
      kind: "pot-awarded",
      handId,
      playerId: "hero",
      amount: 1_200,
      ...({ categoryName } as Record<string, unknown>),
    });

    expect(publicPresentationSound(withCategory("Royal Flush"))).toBe(
      publicPresentationSound(withCategory("High Card")),
    );
  });

  it("selects the same cue regardless of the amount won", () => {
    const award = (amount: number): TournamentPresentationEvent => ({
      id: `awarded-${amount}`,
      kind: "pot-awarded",
      handId,
      playerId: "hero",
      amount,
    });
    // A louder cue for a bigger pot would be fine -- a *different* cue would
    // start encoding information, so the mapping must not branch on value.
    expect(publicPresentationSound(award(50))).toBe(
      publicPresentationSound(award(500_000)),
    );
  });

  it("keys ceremony audio to public result fields only", () => {
    expect(tournamentResultAudioCue({ finishPlace: 1, qualified: true })).toBe(
      "win",
    );
    expect(tournamentResultAudioCue({ finishPlace: 6, qualified: false })).toBe(
      "eliminated",
    );
    // Its module must not be able to reach card or policy data at all.
    const source = readFileSync(
      path.join(sourceRoot, "lib", "tournamentResultAudio.ts"),
      "utf8",
    );
    expect(source).not.toContain("holeCards");
    expect(source).not.toContain("evaluate");
    expect(source).not.toMatch(/import .*(rational|normal|evaluator)/);
  });

  it("never branches the cue mapping on card or hand-strength data", () => {
    // A structural guard: the selector's body may only inspect the event kind
    // and the public command type. If a future change reaches for a card, a
    // rank, or an evaluated hand, this fails.
    const table = readFileSync(
      path.join(sourceRoot, "components", "PokerTable.tsx"),
      "utf8",
    );
    const start = table.indexOf("export function publicPresentationSound(");
    expect(start).toBeGreaterThan(-1);
    const body = table.slice(start, table.indexOf("\n}", start));

    // Match property *accesses*, not bare substrings: "hole-cards-dealt" is a
    // legitimate public event-kind name that merely contains the word "cards",
    // whereas `event.cards` would be a real leak.
    for (const forbidden of [
      /\.holeCards\b/,
      /\.reveals\b/,
      /\.cards\b/,
      /\.rank\b/,
      /\.suit\b/,
      /\.hand\b/,
      /\.equity\b/,
      /\.category\w*\b/,
      /\.amount\b/,
      /evaluate\w*\(/,
    ]) {
      expect(body).not.toMatch(forbidden);
    }
    // What it *is* allowed to read: the event kind and the public command type.
    expect(body).toContain("event.kind");
    expect(body).toContain("event.command.type");
  });

  it("emits a cue for every public moment that has one, and nothing else", () => {
    // Cue coverage is itself part of the contract: a silent win was the
    // original defect.
    expect(
      publicPresentationSound({
        id: "won",
        kind: "pot-awarded",
        handId,
        playerId: "hero",
        amount: 900,
      }),
    ).toBe("win");
    expect(
      publicPresentationSound({
        id: "out",
        kind: "eliminated",
        handId,
        playerId: "villain",
      }),
    ).toBe("eliminated");
    expect(
      publicPresentationSound({
        id: "shove",
        kind: "action",
        handId,
        playerId: "villain",
        command: { type: "all-in" },
      }),
    ).toBe("all-in");
  });
});

describe("end-of-event payoff", () => {
  const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
  const dashboard = readFileSync(
    path.join(sourceRoot, "components", "Dashboard.tsx"),
    "utf8",
  );

  it("gives the ceremony a visual beat, not just typography", () => {
    expect(dashboard).toContain("ceremony-board__flare");
    expect(dashboard).toContain("data-outcome=");
    expect(css).toContain("@keyframes ceremony-settle");
    expect(css).toContain("@keyframes ceremony-flare");
  });

  it("keeps winning perceptible with motion reduced or off", () => {
    // The win *state* (warm rim, resting glow) must survive; only the movement
    // is dropped. A win that is only expressed as an animation disappears for
    // players who turn animation off.
    expect(css).toContain('.ceremony-board[data-outcome="win"]');
    const offRule = css.slice(
      css.indexOf(':root[data-motion-transition="off"]\n  .ceremony-board[data-outcome="win"]'),
    );
    expect(offRule.slice(0, 200)).toContain("opacity: 0.45");
  });
});
