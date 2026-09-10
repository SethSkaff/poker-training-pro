import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluateBestHand } from "../engine/evaluator";
import type { Card, Rank, Suit } from "../types/poker";
import {
  WinnerReveal,
  winnerRecipients,
  winnerRevealFrame,
} from "./WinnerReveal";
import { presentationEventDelayMs } from "../lib/tournamentPresentationClock";
import { payoutPresentation } from "../lib/payoutPresentation";
import { chipStreamFrame } from "./ChipPayoutStream";
const suits: Record<string, Suit> = {
  s: "spades",
  h: "hearts",
  c: "clubs",
  d: "diamonds",
};
const cards = (text: string): Card[] =>
  text.split(" ").map((s) => ({ rank: s[0] as Rank, suit: suits[s[1]] }));
const settings = { reducedMotion: false, transitionMotion: "full" as const };
it.each([
  ["Ah Kh Qh Jh Th", "2c 3d", 0],
  ["Ah Kh Qh Jh 2s", "Th 3d", 1],
  ["Ah Kh Qh 2c 3d", "Jh Th", 2],
])(
  "highlights exactly best five with board %s",
  (boardText, holeText, usedHoles) => {
    const board = cards(boardText as string),
      hole = cards(holeText as string);
    const hand = evaluateBestHand([...board, ...hole]);
    const event = {
      kind: "showdown" as const,
      id: "result",
      handId: "hand",
      playerIds: ["winner"],
      reveals: [{ playerId: "winner", cards: hole }],
      awards: [{ potId: "main", playerId: "winner", amount: 600, hand }],
    };
    const html = renderToStaticMarkup(
      <WinnerReveal
        event={event}
        board={board}
        players={[]}
        identities={new Map()}
        progress={0.5}
        reducedMotion={false}
      />,
    );
    expect(html.match(/winner-card is-winning/g) ?? []).toHaveLength(5);
    expect(
      hand.cards.filter((c) =>
        hole.some((h) => h.rank === c.rank && h.suit === c.suit),
      ),
    ).toHaveLength(usedHoles as number);
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("+600");
  },
);
describe("authoritative split payouts", () => {
  const awards = [
    { potId: "main", playerId: "a", amount: 300 },
    { potId: "main", playerId: "b", amount: 300 },
    { potId: "side-1", playerId: "b", amount: 200 },
  ];
  const event = { kind: "hand-result" as const, id: "r", handId: "h", awards };
  it("groups recipients without confusing total pot with their winnings", () => {
    expect(winnerRecipients(event).map((w) => [w.playerId, w.amount])).toEqual([
      ["a", 300],
      ["b", 500],
    ]);
    expect(
      presentationEventDelayMs(event, 1, settings, { twoDMode: true }),
    ).toBe(7600);
    expect(
      presentationEventDelayMs(event, 2, settings, { twoDMode: true }),
    ).toBe(3800);
  });
  it("preserves shared pot remainder and credits each stream only on arrival", () => {
    const frame = payoutPresentation(
      awards,
      { kind: "pot-awarded", awardIndex: 1 },
      0.5,
    );
    expect(frame.toPlayer("a")).toBe(300);
    expect(frame.toPlayer("b")).toBe(0);
    expect(frame.fromPot("main")).toBe(300);
    expect(frame.active).toEqual(awards[1]);
    expect(
      payoutPresentation(
        awards,
        { kind: "pot-awarded", awardIndex: 1 },
        1,
      ).toPlayer("b"),
    ).toBe(300);
    expect(
      payoutPresentation(awards, { kind: "cards-collected" }, 1).paid,
    ).toBe(800);
    expect(payoutPresentation(awards, undefined, 1).paid).toBe(0);
  });
  it("holds settled content for 3000 ms, enters left, then exits", () => {
    expect(winnerRevealFrame(0, 1).x).toBe(-100);
    expect(winnerRevealFrame(400 / 3800, 1).x).toBe(0);
    expect(winnerRevealFrame(3400 / 3800, 1).x).toBe(0);
    expect(winnerRevealFrame(3700 / 3800, 1).x).toBeLessThan(0);
    expect(winnerRevealFrame(0.75, 2).index).toBe(1);
    expect(
      presentationEventDelayMs(
        event,
        1,
        { ...settings, reducedMotion: true },
        { twoDMode: true },
      ),
    ).toBe(7600);
  });
  it("lifts a stack together before peeling top to bottom", () => {
    expect(chipStreamFrame(0.1, 0, 0).travel).toBe(0);
    expect(chipStreamFrame(0.1, 0, 2).lift).toBe(
      chipStreamFrame(0.1, 0, 0).lift,
    );
    expect(chipStreamFrame(0.5, 0, 0).travel).toBeGreaterThan(
      chipStreamFrame(0.5, 0, 1).travel,
    );
    expect(chipStreamFrame(0.5, 0, 1).travel).toBeGreaterThan(
      chipStreamFrame(0.5, 0, 2).travel,
    );
    expect(chipStreamFrame(1, 7, 2).travel).toBe(1);
  });
});
