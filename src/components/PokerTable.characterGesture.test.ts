import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { seatGestureForPublicState } from "./PokerTable";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const active = {
  status: "active" as const,
  bet: 0,
  showingFaceDownCards: true,
  hasPublicReveal: false,
};

describe("public character gesture selection", () => {
  it("gives active opponents a visible hold/peek gesture", () => {
    expect(seatGestureForPublicState(active)).toBe("hold");
  });

  it("prioritizes public actions over the resting hold pose", () => {
    expect(seatGestureForPublicState({ ...active, recentAction: "check" })).toBe("check");
    expect(seatGestureForPublicState({ ...active, recentAction: "fold" })).toBe("fold");
    expect(seatGestureForPublicState({ ...active, recentAction: "all-in" })).toBe("all-in");
  });

  it("does not restore an old gesture while Skip holds a public terminal fold", () => {
    expect(
      seatGestureForPublicState({ ...active, bet: 400, terminalFolded: true }),
    ).toBeUndefined();
  });

  it("does not depend on hidden cards or policy information", () => {
    const publicState = { ...active, bet: 400 };
    expect(seatGestureForPublicState(publicState)).toBe("bet");
    expect(seatGestureForPublicState({ ...publicState })).toBe("bet");
  });
});

describe("character gesture coverage and invariance", () => {
  const base = {
    status: "active" as const,
    bet: 0,
    showingFaceDownCards: true,
    hasPublicReveal: false,
  };

  it("gives every public moment of the hand its own gesture", () => {
    expect(seatGestureForPublicState({ ...base, justDealt: true })).toBe(
      "receive",
    );
    expect(seatGestureForPublicState(base)).toBe("hold");
    expect(
      seatGestureForPublicState({ ...base, recentAction: "check" }),
    ).toBe("check");
    expect(
      seatGestureForPublicState({ ...base, recentAction: "call" }),
    ).toBe("call");
    expect(seatGestureForPublicState({ ...base, bet: 200 })).toBe("bet");
    // A raise reads as a different physical act from an opening bet.
    expect(
      seatGestureForPublicState({ ...base, bet: 200, recentAction: "raise" }),
    ).toBe("raise");
    expect(
      seatGestureForPublicState({ ...base, recentAction: "all-in" }),
    ).toBe("all-in");
    expect(
      seatGestureForPublicState({ ...base, recentAction: "fold" }),
    ).toBe("fold");
    expect(seatGestureForPublicState({ ...base, wonPot: true })).toBe("win");
    expect(seatGestureForPublicState({ ...base, status: "out" })).toBe("out");
  });

  it("cannot depend on hidden information, by signature", () => {
    // The structural guarantee: the selector accepts one object of public
    // fields. There is no card, rank, equity, or evaluated-hand parameter for
    // hand strength to enter through, so an opponent holding the nuts and one
    // holding 7-2 are indistinguishable.
    const source = readFileSync(
      path.join(sourceRoot, "components", "PokerTable.tsx"),
      "utf8",
    );
    const start = source.indexOf("export function seatGestureForPublicState(");
    const signature = source.slice(start, source.indexOf("}): ", start));
    for (const forbidden of [
      "holeCards",
      "cards",
      "rank",
      "suit",
      "equity",
      "handValue",
      "strength",
    ]) {
      expect(signature).not.toContain(forbidden);
    }
  });
});
