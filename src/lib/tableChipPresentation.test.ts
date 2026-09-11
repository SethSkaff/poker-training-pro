import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import type { TrainingScenario } from "../types/poker";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import { tableChipPresentation } from "./tableChipPresentation";
import { payoutPresentation } from "./payoutPresentation";

const scenario: TrainingScenario = {
  ...trainingScenarios[0],
  id: "hand-1", street: "flop", pot: 300, collectedChipInventory: {100: 2},
  players: [
    {...trainingScenarios[0].players[0], id: "bottom", stack: 850, bet: 50, totalCommitted: 150, status: "active"},
    {...trainingScenarios[0].players[1], id: "top", stack: 850, bet: 50, totalCommitted: 150, status: "active"},
  ],
};
const awards = [{potId: "main", playerId: "bottom", amount: 300}];
const event = (kind: string, extra = {}) => ({kind, handId: scenario.id, ...extra}) as TournamentPresentationEvent;

describe("physical table chip accounting", () => {
  it("shows only gathered inventory in gameplay and review", () => {
    const view = tableChipPresentation(scenario, undefined, 0, []);
    expect(view.pot).toBe(200);
    expect(view.bet(50)).toBe(50);
    expect(view.pot + scenario.players.reduce((s,p) => s + view.bet(p.bet), 0)).toBe(scenario.pot);
    expect(scenario.pot).toBe(300);
  });
  it("supports training snapshots without a physical inventory", () => {
    expect(tableChipPresentation({...scenario, collectedChipInventory: undefined}, undefined, 0, []).pot).toBe(200);
  });
  it("keeps bets out of the pot while moving, then collects once", () => {
    const moving = tableChipPresentation(scenario, event("bets-collected"), .5, []);
    expect([moving.pot, moving.bet(50), moving.collectionProgress]).toEqual([200,50,.5]);
    const done = tableChipPresentation(scenario, event("bets-collected"), 1, [], moving.memory);
    const board = tableChipPresentation(scenario, event("board-card-dealt"), .2, [], done.memory);
    expect([board.pot, board.bet(50)]).toEqual([300,0]);
    expect(scenario.players[0].bet).toBe(50);
  });
  it("resets collection for the next street's authoritative commitments", () => {
    const done = tableChipPresentation(scenario, event("bets-collected"), 1, []);
    const next = tableChipPresentation({...scenario, street:"turn",pot:400,collectedChipInventory:{100:3}}, undefined, 0, [], done.memory);
    expect([next.pot,next.bet(50)]).toEqual([300,50]);
  });
  it("does not mistake a side-pot announcement for collection", () => {
    expect(tableChipPresentation(scenario,event("side-pot-formed"),1,[]).pot).toBe(200);
  });
  it("holds final payout values through event-less and next-hand opening frames", () => {
    const moving = tableChipPresentation(scenario, event("pot-awarded",{awardIndex:0}), .5, awards);
    expect([moving.pot,moving.credit("bottom")]).toEqual([300,0]);
    const paid = tableChipPresentation(scenario, event("pot-awarded",{awardIndex:0}),1,awards,moving.memory);
    const gap = tableChipPresentation(scenario,undefined,0,awards,paid.memory);
    const opening = tableChipPresentation(scenario,event("button-moved",{handId:"hand-2"}),0,awards,gap.memory);
    expect([opening.pot,opening.credit("bottom"),opening.bet(50)]).toEqual([0,300,0]);
    const next = tableChipPresentation({...scenario,id:"hand-2"},undefined,0,[],opening.memory);
    expect([next.pot,next.credit("bottom"),next.bet(50)]).toEqual([200,0,50]);
  });
  it("keeps split/side awards monotonic without replaying paid chips", () => {
    const split = [{potId:"main",playerId:"bottom",amount:100},{potId:"main",playerId:"top",amount:100},{potId:"side",playerId:"bottom",amount:100}];
    const view = payoutPresentation(split,{kind:"pot-awarded",awardIndex:1},.5,1);
    expect([view.paid,view.toPlayer("bottom"),view.active?.amount]).toEqual([100,100,100]);
    const stale = payoutPresentation(split,{kind:"pot-awarded",awardIndex:0},0,3);
    expect([stale.paid,stale.toPlayer("bottom"),stale.toPlayer("top"),stale.active]).toEqual([300,200,100,undefined]);
  });
  it("keeps each settled side-pot amount exact when an uncalled return exists", () => {
    const allIn = {...scenario,pot:600,players:[
      {...scenario.players[0],id:"bottom",totalCommitted:100,status:"all-in" as const},
      {...scenario.players[1],id:"top",totalCommitted:200,status:"all-in" as const},
      {...scenario.players[1],id:"upper-left",totalCommitted:300,status:"all-in" as const},
    ]};
    const view = tableChipPresentation(allIn,event("showdown"),0,[]);
    expect(view.settledPots?.map(p=>p.amount)).toEqual([300,200]);
    expect([view.pot,view.credit("upper-left")]).toEqual([500,100]);
  });
  it("returns an unmatched wager without inventing a winner award", () => {
    const unmatched = {...scenario,pot:350,players:[{...scenario.players[0],bet:100,totalCommitted:200},{...scenario.players[1],status:"folded" as const}]};
    const result = tableChipPresentation(unmatched,event("hand-result"),0,awards);
    expect([result.pot,result.credit("bottom"),result.bet(100)]).toEqual([300,50,0]);
    const paid = tableChipPresentation(unmatched,event("cards-collected"),1,awards,result.memory);
    expect([paid.pot,paid.credit("bottom")]).toEqual([0,350]);
  });
});
