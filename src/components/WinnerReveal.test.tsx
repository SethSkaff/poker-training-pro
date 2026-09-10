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

describe("winner reveal shows only cards the table was entitled to see", () => {
  const render = (props: {
    event: Parameters<typeof WinnerReveal>[0]["event"];
    board?: Card[];
    players?: Parameters<typeof WinnerReveal>[0]["players"];
  }) =>
    renderToStaticMarkup(
      <WinnerReveal
        event={props.event}
        board={props.board ?? cards("Ah Kh Qh 2c 3d")}
        players={props.players ?? []}
        identities={new Map()}
        progress={0.5}
        reducedMotion={false}
      />,
    );

  const faceDown = (html: string) =>
    (html.match(/playing-card--back/g) ?? []).length;

  it("shows two face-down cards and no hand name when nothing was revealed", () => {
    // An uncontested pot ends with the winner's cards still private. The
    // reveal must show the pot moving, not invent a showdown.
    const html = render({
      event: {
        kind: "hand-result",
        id: "r",
        handId: "h",
        awards: [{ potId: "main", playerId: "winner", amount: 450 }],
      },
    });
    expect(faceDown(html)).toBe(2);
    expect(html).toContain("Won uncontested");
    expect(html).not.toContain("is-winning");
    expect(html).toContain("+450");
  });

  it("never falls back to seat cards for a player the showdown did not reveal", () => {
    // The seat still holds the cards in memory; a showdown that did not
    // include this player must not borrow them. This is the one place the
    // reveal could leak a hand nobody paid to see.
    const hidden = cards("7s 7d");
    const html = render({
      event: {
        kind: "showdown",
        id: "result",
        handId: "hand",
        playerIds: ["winner", "other"],
        reveals: [{ playerId: "other", cards: cards("2c 3h") }],
        awards: [{ potId: "main", playerId: "winner", amount: 900 }],
      },
      players: [
        {
          id: "winner",
          name: "Winner",
          seat: 0,
          stack: 1000,
          status: "active",
          streetCommitted: 0,
          totalCommitted: 0,
          cards: hidden,
        },
      ] as unknown as Parameters<typeof WinnerReveal>[0]["players"],
    });
    expect(faceDown(html)).toBe(2);
    for (const card of hidden) {
      expect(html).not.toContain(`playing-card--${card.suit}"`);
    }
    expect(html).not.toContain("7");
  });

  it("highlights a single revealed card without padding the hand back to two", () => {
    const board = cards("Ah Kh Qh Jh 2c");
    const revealed = cards("Th");
    const hand = evaluateBestHand([...board, ...revealed]);
    const html = render({
      event: {
        kind: "showdown",
        id: "result",
        handId: "hand",
        playerIds: ["winner"],
        reveals: [{ playerId: "winner", cards: revealed }],
        awards: [{ potId: "main", playerId: "winner", amount: 600, hand }],
      },
      board,
    });
    // The board contributes four of the winning five; the single revealed
    // card contributes the fifth, and nothing is invented to fill the gap.
    expect(html.match(/winner-card is-winning/g) ?? []).toHaveLength(5);
    expect(faceDown(html)).toBe(0);
    expect(html).toContain(hand.displayName);
  });

  it("marks only the board cards the winning hand actually used", () => {
    const board = cards("Ah Kh Qh 2c 3d");
    const hole = cards("Jh Th");
    const hand = evaluateBestHand([...board, ...hole]);
    const html = render({
      event: {
        kind: "showdown",
        id: "result",
        handId: "hand",
        playerIds: ["winner"],
        reveals: [{ playerId: "winner", cards: hole }],
        awards: [{ potId: "main", playerId: "winner", amount: 600, hand }],
      },
      board,
    });
    // Five highlighted overall, so the two unused board cards stay plain.
    expect(html.match(/winner-card is-winning/g) ?? []).toHaveLength(5);
    expect(html.match(/winner-card"/g) ?? []).toHaveLength(2);
  });
});
