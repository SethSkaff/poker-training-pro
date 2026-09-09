import { describe, expect, it } from "vitest";
import { accountChips, chipValue, cloneChipLedger, startingChipInventory } from "../engine/chips";
import { nextToAct } from "../engine";
import { applyTournamentSessionAction, beginTournamentSessionHand, createPokerTableSnapshot, createTournamentSession } from "../modes/tournamentSession";
import { createBetChoreographyPlan } from "./betChoreography";
import { chipColumnLayoutForInventory, chipDisplayValue, chipRackLayoutBounds, seatOccupancyLayout, seatPoses } from "./tableSceneModel";
import { createTableSceneSnapshot } from "./tableSceneSnapshot";

describe("3D physical chip inventory interface", () => {
  it("checks the physical collected pile separately from the inclusive pot label", () => {
    // Before the first collection all 75 chips are still in the blind circles.
    expect(chipDisplayValue(75, {})).toBe(0);
    expect(chipDisplayValue(300, { 25: 2, 100: 1 })).toBe(150);
    expect(chipDisplayValue(300)).toBe(300);
  });
  it("draws a 43-chip regional rack with exact denominations and inventory-based placement", () => {
    const inventory = startingChipInventory(25_000);
    const layout = chipColumnLayoutForInventory(inventory);
    expect(layout.reduce((sum, c) => sum + c.count, 0)).toBe(43);
    expect(layout.reduce((sum, c) => sum + c.count * c.denomination, 0)).toBe(25_000);
    expect(layout.map((c) => c.denomination)).toEqual([25, 100, 500, 1000, 5000]);
    for (const pose of seatPoses(6)) {
      expect(seatOccupancyLayout(pose, 25_000, inventory).rackBounds).toEqual(chipRackLayoutBounds(25_000, inventory));
    }
    const pennies = chipColumnLayoutForInventory({ 25: 43 });
    expect(pennies.map((c) => c.count)).toEqual([20, 20, 3]);
  });

  it("passes actual inventories from the tournament snapshot to the 3D snapshot", () => {
    const session = beginTournamentSessionHand(createTournamentSession({ eventId: "local-qualifier", hero: { id: "hero", name: "Player", rating: 1000 }, mode: "normal", seed: "3d-ledger" }));
    const table = createPokerTableSnapshot(session);
    const scene = createTableSceneSnapshot({
      players: table.players.map((p) => ({ ...p, canonicalSeat: p.seat })),
      heroId: "hero", pot: table.pot, collectedChipInventory: table.collectedChipInventory,
      chipMovements: table.chipMovements, boardCards: 0, cameraPan: 0, reducedMotion: false,
    });
    for (const seat of scene.seats) {
      expect(seat.chipInventory).toEqual(accountChips(session.chips, `player:${seat.id}`));
      expect(chipValue(seat.betChipInventory!)).toBe(seat.bet);
    }
    expect(scene.collectedChipInventory).toEqual({});
    expect(scene.chipMovements).toEqual(session.chips.movements);
  });

  it("feeds the existing wager renderer the actual transferred bundle without changing its motion", () => {
    const session = beginTournamentSessionHand(createTournamentSession({ eventId: "local-qualifier", hero: { id: "hero", name: "Player", rating: 1000 }, mode: "normal", seed: "3d-wager-ledger" }));
    const actor = nextToAct(session.activeHand!.betting)!;
    const next = applyTournamentSessionAction(session, actor, { type: "raise", to: 575 });
    const wager = next.chips.movements.at(-1)!;
    const rack = { ...accountChips(next.chips, `player:${actor}`) };
    for (const [d, count] of Object.entries(wager.chips)) rack[Number(d)] = (rack[Number(d)] ?? 0) + count;
    const beforeBet = accountChips(session.chips, `bet:${actor}`);
    const plan = createBetChoreographyPlan({ pose: seatPoses(6)[0], rackAmount: chipValue(rack), amount: wager.value,
      rackInventory: rack, existingWagerAmount: chipValue(beforeBet), existingWagerInventory: beforeBet });
    const actual: Record<number, number> = {};
    for (const chip of plan.chips) actual[chip.denomination] = (actual[chip.denomination] ?? 0) + 1;
    expect(actual).toEqual(wager.chips);
    expect(cloneChipLedger(next.chips).accounts).toEqual(next.chips.accounts);
  });
});
