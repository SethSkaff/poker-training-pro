import { describe, expect, it } from "vitest";
import {
  accountChips, assertChipLedger, chipValue, cloneChipLedger, collectChipBets,
  createChipLedger, startingChipInventory, transferChipValue,
} from "./chips";

describe("physical denomination ledger", () => {
  it("issues useful early-level racks rather than a single 25k chip", () => {
    expect(startingChipInventory(25_000)).toEqual({ 25: 12, 100: 12, 500: 7, 1000: 10, 5000: 2 });
    for (const amount of [0, 1, 17, 25, 175, 4_975, 15_000, 25_000, 40_000, 60_000]) {
      expect(chipValue(startingChipInventory(amount))).toBe(amount);
    }
    expect(Object.values(startingChipInventory(25_000)).reduce((a, b) => a + b, 0)).toBe(43);
  });

  it("moves exactly the contributed denominations through collection and payout", () => {
    const ledger = createChipLedger([
      { id: "a", stack: 625, chipInventory: { 25: 1, 100: 1, 500: 1 } },
      { id: "b", stack: 1100, chipInventory: { 100: 1, 1000: 1 } },
    ]);
    transferChipValue(ledger, "player:a", "bet:a", 625, "wager");
    transferChipValue(ledger, "player:b", "bet:b", 1100, "wager");
    collectChipBets(ledger);
    transferChipValue(ledger, "collected:a", "pot:main", 625, "pot-allocation");
    transferChipValue(ledger, "collected:b", "pot:main", 1100, "pot-allocation");
    const pot = { 25: 1, 100: 2, 500: 1, 1000: 1 };
    expect(accountChips(ledger, "pot:main")).toEqual(pot);
    transferChipValue(ledger, "pot:main", "player:a", 1725, "payout");
    expect(accountChips(ledger, "player:a")).toEqual(pot);
    expect(accountChips(ledger, "pot:main")).toEqual({});
    expect(ledger.movements.some((m) => m.reason === "change")).toBe(false);
    assertChipLedger(ledger);
  });

  it("makes deterministic, equal-value bank exchanges only when exact chips are unavailable", () => {
    const source = createChipLedger([{ id: "a", stack: 500, chipInventory: { 500: 1 } }]);
    const play = () => {
      const ledger = cloneChipLedger(source);
      transferChipValue(ledger, "player:a", "bet:a", 75, "small-blind");
      return ledger;
    };
    const ledger = play();
    expect(play()).toEqual(ledger);
    expect(accountChips(source, "player:a")).toEqual({ 500: 1 });
    expect(accountChips(ledger, "bet:a")).toEqual({ 25: 3 });
    expect(accountChips(ledger, "player:a")).toEqual({ 25: 1, 100: 4 });
    const exchanges = ledger.movements.filter((m) => m.reason === "change");
    expect(exchanges).toHaveLength(4);
    for (let i = 0; i < exchanges.length; i += 2) {
      expect(exchanges[i].exchangeId).toBe(exchanges[i + 1].exchangeId);
      expect(exchanges[i].value).toBe(exchanges[i + 1].value);
      expect(exchanges[i].to).toBe("house");
      expect(exchanges[i + 1].from).toBe("house");
    }
    assertChipLedger(ledger);
  });

  it("returns unmatched chips and splits a pot with explicit change rather than repacking the winner", () => {
    const ledger = createChipLedger([
      { id: "a", stack: 1000, chipInventory: { 1000: 1 } },
      { id: "b", stack: 500, chipInventory: { 500: 1 } },
    ]);
    transferChipValue(ledger, "player:a", "bet:a", 1000, "wager");
    transferChipValue(ledger, "player:b", "bet:b", 500, "wager");
    collectChipBets(ledger);
    transferChipValue(ledger, "collected:a", "player:a", 500, "refund");
    transferChipValue(ledger, "collected:a", "pot:main", 500, "pot-allocation");
    transferChipValue(ledger, "collected:b", "pot:main", 500, "pot-allocation");
    transferChipValue(ledger, "pot:main", "player:a", 525, "payout");
    transferChipValue(ledger, "pot:main", "player:b", 475, "payout");
    expect(chipValue(accountChips(ledger, "player:a"))).toBe(1025);
    expect(chipValue(accountChips(ledger, "player:b"))).toBe(475);
    expect(accountChips(ledger, "player:a")[500]).toBe(2);
    expect(accountChips(ledger, "pot:main")).toEqual({});
    assertChipLedger(ledger);
  });

  it("can post an ante, then an exact off-rack all-in without impossible chips", () => {
    const ledger = createChipLedger([{ id: "a", stack: 117, chipInventory: { 100: 1, 5: 3, 1: 2 } }]);
    transferChipValue(ledger, "player:a", "collected:a", 7, "ante");
    transferChipValue(ledger, "player:a", "bet:a", 110, "wager");
    expect(accountChips(ledger, "player:a")).toEqual({});
    expect(ledger.movements.filter((m) => m.reason === "change")).toHaveLength(0);
    assertChipLedger(ledger);
  });

  it("rejects invalid quantities, mismatched issuance, overdraws, and unbalanced bank edits", () => {
    expect(() => chipValue({ 25: -1 })).toThrow();
    expect(() => chipValue({ 25: 0.5 })).toThrow();
    expect(() => chipValue({ 17: 1 })).toThrow();
    expect(() => createChipLedger([{ id: "a", stack: 100, chipInventory: { 25: 3 } }])).toThrow();
    const ledger = createChipLedger([{ id: "a", stack: 100 }]);
    expect(() => transferChipValue(ledger, "player:a", "bet:a", 101, "wager")).toThrow();
    expect(() => transferChipValue(ledger, "house", "player:a", 25, "payout")).toThrow();
    ledger.accounts["player:a"] = { 100: 2 };
    expect(() => assertChipLedger(ledger)).toThrow(/conservation/);
  });

  it("retains racks and monotonic event IDs across hand boundaries", () => {
    const ledger = createChipLedger([{ id: "a", stack: 500 }]);
    transferChipValue(ledger, "player:a", "bet:a", 100, "wager");
    const next = cloneChipLedger(ledger, true);
    expect(next.accounts).toEqual(ledger.accounts);
    expect(next.movements).toEqual([]);
    expect(next.nextSequence).toBe(ledger.nextSequence);
  });
});
