import { describe, expect, it } from "vitest";
import {
  BLACKJACK_RULES,
  cardFromRank,
  getAvailableActions,
  getHiLoTag,
  getInsuranceAction,
  getOptimalAction,
  getPlayingTrueCount,
  type BlackjackAction,
} from "./engine";

const card = (rank: Parameters<typeof cardFromRank>[0], suit: Parameters<typeof cardFromRank>[1] = "♠") => cardFromRank(rank, suit);
const hand = (...ranks: Parameters<typeof cardFromRank>[0][]) => ({ cards: ranks.map((rank, index) => card(rank, index % 2 ? "♥" : "♠")) });
const action = (player: ReturnType<typeof hand>, dealer: Parameters<typeof cardFromRank>[0], trueCount: number, available: readonly BlackjackAction[] = ["hit", "stand", "double", "split", "surrender"]) =>
  getOptimalAction(player, card(dealer, "♦"), trueCount, BLACKJACK_RULES, available);

describe("Blackjack Hi-Lo and strategy engine", () => {
  it("assigns canonical Hi-Lo tags", () => {
    expect(getHiLoTag(card("5"))).toBe(1);
    expect(getHiLoTag(card("8"))).toBe(0);
    expect(getHiLoTag(card("K"))).toBe(-1);
  });

  it("floors true counts mathematically, including negative values", () => {
    expect(getPlayingTrueCount(3, 2)).toBe(1);
    expect(getPlayingTrueCount(-3, 2)).toBe(-2);
  });

  it.each([
    ["12 vs 2, TC +2", action(hand("10", "2"), "2", 2).action, "hit"],
    ["12 vs 2, TC +3", action(hand("10", "2"), "2", 3).action, "stand"],
    ["13 vs 3, TC -3", action(hand("10", "3"), "3", -3).action, "hit"],
    ["13 vs 3, TC -2", action(hand("10", "3"), "3", -2).action, "stand"],
    ["11 vs A, TC 0", action(hand("6", "5"), "A", 0).action, "hit"],
    ["11 vs A, TC +1", action(hand("6", "5"), "A", 1).action, "double"],
    ["10 vs 10, TC +3", action(hand("6", "4"), "10", 3).action, "hit"],
    ["10 vs 10, TC +4", action(hand("6", "4"), "10", 4).action, "double"],
    ["10,10 vs 5, TC +4", action(hand("10", "10"), "5", 4).action, "stand"],
    ["10,10 vs 5, TC +5", action(hand("10", "10"), "5", 5).action, "split"],
    ["15 vs 10, TC -1 with surrender", action(hand("10", "5"), "10", -1).action, "hit"],
    ["15 vs 10, TC 0 with surrender", action(hand("10", "5"), "10", 0).action, "surrender"],
    ["15 vs 10, TC +4 without surrender", action(hand("10", "5"), "10", 4, ["hit", "stand", "double"]).action, "stand"],
    ["12 vs 5, TC -3", action(hand("10", "2"), "5", -3).action, "hit"],
    ["12 vs 5, TC -2", action(hand("10", "2"), "5", -2).action, "stand"],
    ["12 vs 4, TC -1", action(hand("10", "2"), "4", -1).action, "hit"],
    ["12 vs 4, TC 0", action(hand("10", "2"), "4", 0).action, "stand"],
  ])("grades %s", (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("uses the +3 insurance index", () => {
    expect(getInsuranceAction(2)).toBe("decline");
    expect(getInsuranceAction(3)).toBe("insurance");
  });

  it.each([3, 4, 5, 6])("stands on three-card soft 18 vs %s when doubling is unavailable", (dealer) => {
    const player = hand("A", "3", "4");
    const upcard = card(String(dealer) as Parameters<typeof cardFromRank>[0]);
    const available = getAvailableActions(player, upcard);
    expect(available).toEqual(["hit", "stand"]);
    expect(getOptimalAction(player, upcard, -3, BLACKJACK_RULES, available).action).toBe("stand");
    expect(action(hand("A", "7"), upcard.rank, 0).action).toBe("double");
  });

  it("keeps pair surrender precedence and exposes deviation metadata", () => {
    const decision = action(hand("8", "8"), "10", 6);
    expect(decision.action).toBe("split");
    expect(decision.deviationApplied).toBe(false);

    const countDecision = action(hand("10", "2"), "2", 3);
    expect(countDecision.deviationApplied).toBe(true);
    expect(countDecision.index).toBe(3);
  });
});
