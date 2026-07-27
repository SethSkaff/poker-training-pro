import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { describeTrainingContext } from "./trainingScenarioContext";

const byId = (id: string) => {
  const scenario = trainingScenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`missing scenario ${id}`);
  return scenario;
};

describe("every scenario states the position it is asking about", () => {
  it("gives every shipped scenario a complete context", () => {
    for (const scenario of trainingScenarios) {
      const context = describeTrainingContext(scenario);
      expect(context.bigBlind).toBeGreaterThan(0);
      expect(context.stackChips).toBeGreaterThan(0);
      expect(context.stackBigBlinds).not.toBeNull();
      expect(context.players).toBeGreaterThanOrEqual(2);
      expect(context.pot).toBeGreaterThanOrEqual(0);
      expect(context.effectiveStackChips).toBeGreaterThan(0);
      // A decision cannot cost more than the smaller stack can lose.
      expect(context.effectiveStackChips).toBeLessThanOrEqual(
        context.stackChips,
      );
    }
  });

  /*
    The reported case, resolved. The trainer recommended an all-in with ace-five
    suited and the screen gave no way to judge it. It is A-5 suited on the button
    with 11,000 behind at 500/1,000 plus a 125 ante -- eleven big blinds, which
    is push/fold territory and makes the shove ordinary rather than exotic. The
    recommendation was correct; the context was missing.
  */
  it("shows why the ace-five shove is a push/fold spot, not a gamble", () => {
    const context = describeTrainingContext(
      byId("preflop-button-shove-fold-equity"),
    );
    expect(context.stackChips).toBe(11_000);
    expect(context.bigBlind).toBe(1_000);
    expect(context.stackBigBlinds).toBe(11);
    expect(context.ante).toBe(125);
    expect(context.shortStacked).toBe(true);
    expect(context.amountToCall).toBe(1_000);
  });

  it("reports the ante, which changes what is worth contesting", () => {
    // An ante is dead money in the pot; a scenario that hides it makes every
    // marginal shove look worse than it is.
    expect(
      describeTrainingContext(byId("preflop-button-shove-fold-equity")).ante,
    ).toBe(125);
  });
});

describe("stack depth is reported in the unit decisions are made in", () => {
  it("converts chips to big blinds", () => {
    const context = describeTrainingContext(
      byId("preflop-button-shove-fold-equity"),
    );
    expect(context.stackBigBlinds).toBeCloseTo(
      context.stackChips / context.bigBlind,
      1,
    );
  });

  it("caps the effective stack at what the opponent can actually lose", () => {
    // The number that governs is the smaller stack, not the hero's.
    for (const scenario of trainingScenarios) {
      const context = describeTrainingContext(scenario);
      const opponents = scenario.players.filter(
        (player) =>
          player.seat !== scenario.heroSeat &&
          (player.status === "active" || player.status === "all-in"),
      );
      if (opponents.length === 0) continue;
      // Remaining chips plus what is already committed: an all-in opponent has
      // a zero stack and a live claim on everything they pushed in.
      const largest = Math.max(
        ...opponents.map((player) => player.stack + (player.bet ?? 0)),
      );
      expect(context.effectiveStackChips).toBe(
        Math.min(context.stackChips, largest),
      );
    }
  });

  it("marks a short stack as short", () => {
    expect(
      describeTrainingContext(byId("preflop-button-shove-fold-equity"))
        .shortStacked,
    ).toBe(true);
  });
});

describe("pot odds are stated, not left to be worked out", () => {
  it("computes the break-even share when there is something to call", () => {
    const context = describeTrainingContext(
      byId("preflop-button-shove-fold-equity"),
    );
    // 1,000 to call into a 2,625 pot.
    expect(context.potOdds).toBeCloseTo(1_000 / (2_625 + 1_000), 5);
  });

  it("reports no pot odds when there is nothing to call", () => {
    const checkable = trainingScenarios.find(
      (scenario) => scenario.amountToCall === 0,
    );
    if (!checkable) return;
    expect(describeTrainingContext(checkable).potOdds).toBeNull();
  });
});
