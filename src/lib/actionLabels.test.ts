import { describe, expect, it } from "vitest";
import { describeCallAction } from "./actionLabels";

describe("the primary call control describes what actually leaves the stack", () => {
  it("checks when there is nothing to call", () => {
    expect(describeCallAction({ amountToCall: 0, heroStack: 5_000 })).toEqual({
      kind: "check",
      committed: 0,
      facing: 0,
      shortOfCall: false,
    });
  });

  it("calls when the hero comfortably covers the bet", () => {
    const description = describeCallAction({
      amountToCall: 400,
      heroStack: 5_000,
    });
    expect(description.kind).toBe("call");
    expect(description.committed).toBe(400);
    expect(description.shortOfCall).toBe(false);
  });

  /*
    The regression this file exists for. The engine legally offers a call; the
    button said "Call 4,000" while the hero had 1,200, implying they could cover
    a bet they cannot and hiding the side pot they are about to create.
  */
  it("is all-in when the hero cannot cover the bet, and reports both numbers", () => {
    const description = describeCallAction({
      amountToCall: 4_000,
      heroStack: 1_200,
    });
    expect(description.kind).toBe("all-in");
    // What the hero actually commits, not what they are facing.
    expect(description.committed).toBe(1_200);
    expect(description.facing).toBe(4_000);
    // A short call caps the main pot and forms a side pot.
    expect(description.shortOfCall).toBe(true);
  });

  it("is all-in when the stack exactly covers the call", () => {
    // The easiest case to misread: the numbers match, so "Call 1,200" looks
    // right, but it still commits the hero's last chip.
    const description = describeCallAction({
      amountToCall: 1_200,
      heroStack: 1_200,
    });
    expect(description.kind).toBe("all-in");
    expect(description.committed).toBe(1_200);
    expect(description.shortOfCall).toBe(false);
  });

  it("stays a call one chip short of the hero's whole stack", () => {
    const description = describeCallAction({
      amountToCall: 1_199,
      heroStack: 1_200,
    });
    expect(description.kind).toBe("call");
    expect(description.shortOfCall).toBe(false);
  });

  it("never reports committing more than the hero holds", () => {
    for (const [amountToCall, heroStack] of [
      [10, 1],
      [1, 10],
      [7_777, 25],
      [25, 25],
    ]) {
      const description = describeCallAction({ amountToCall, heroStack });
      expect(description.committed).toBeLessThanOrEqual(heroStack);
      expect(description.committed).toBeLessThanOrEqual(amountToCall);
    }
  });

  it("treats a busted stack as a check rather than an all-in for nothing", () => {
    // A zero stack facing a bet cannot commit anything; labelling that "All in"
    // would be theatre.
    const description = describeCallAction({ amountToCall: 500, heroStack: 0 });
    expect(description.kind).toBe("call");
    expect(description.committed).toBe(0);
  });

  it("clamps negative inputs rather than propagating them into a label", () => {
    expect(describeCallAction({ amountToCall: -5, heroStack: 100 }).kind).toBe(
      "check",
    );
    expect(
      describeCallAction({ amountToCall: 100, heroStack: -5 }).committed,
    ).toBe(0);
  });
});
