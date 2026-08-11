import { describe, expect, it } from "vitest";
import { createBettingRound, getLegalActions } from "../engine/betting";
import { snapRaiseSliderToAmount } from "./raiseSlider";

describe("raise slider total-to amount", () => {
  it("preserves an off-step all-in endpoint after a prior street commitment", () => {
    const streetCommitted = 75;
    const remainingStack = 1_000;
    const allInTo = streetCommitted + remainingStack;
    const bounds = {
      minimumRaiseTo: 400,
      allInTo,
      chipStep: 100,
    };

    // 1,075 is not on the 400 + n*100 grid. It must still be the exact right
    // endpoint and the poker action remains the correct total raise-to amount.
    expect(snapRaiseSliderToAmount(allInTo, bounds)).toBe(1_075);
    expect(
      (snapRaiseSliderToAmount(allInTo, bounds) - bounds.minimumRaiseTo) /
        (bounds.allInTo - bounds.minimumRaiseTo),
    ).toBe(1);
  });

  it("retains the legal minimum and blind-sized intermediate increments", () => {
    const bounds = {
      minimumRaiseTo: 400,
      allInTo: 1_075,
      chipStep: 100,
    };
    expect(snapRaiseSliderToAmount(350, bounds)).toBe(400);
    expect(snapRaiseSliderToAmount(742, bounds)).toBe(700);
    expect(snapRaiseSliderToAmount(768, bounds)).toBe(800);
  });

  it("handles a prior commitment larger than one chip increment", () => {
    const streetCommitted = 650;
    const remainingStack = 2_225;
    expect(
      snapRaiseSliderToAmount(streetCommitted + remainingStack, {
        minimumRaiseTo: 1_400,
        allInTo: streetCommitted + remainingStack,
        chipStep: 200,
      }),
    ).toBe(2_875);
  });

  it("shares the engine's total raise-to maximum when chips are already committed", () => {
    const state = createBettingRound(
      [
        {
          id: "hero",
          stack: 1_000,
          streetCommitted: 75,
          totalCommitted: 75,
          status: "active",
        },
        {
          id: "villain",
          stack: 900,
          streetCommitted: 200,
          totalCommitted: 200,
          status: "active",
        },
      ],
      ["hero", "villain"],
      { minimumBet: 100, currentBet: 200, lastFullRaise: 100 },
    );
    const legal = getLegalActions(state, "hero");

    expect(legal.allInTo).toBe(1_075);
    expect(legal.raise?.maxTo).toBe(legal.allInTo);
    expect(
      snapRaiseSliderToAmount(legal.allInTo, {
        minimumRaiseTo: legal.raise?.minTo ?? legal.allInTo,
        allInTo: legal.allInTo,
        chipStep: 100,
      }),
    ).toBe(legal.allInTo);
  });
});
