import {it,expect} from "vitest";
import {createCareerTournamentRunner,advanceTournamentRunnerOneStep} from "./tournamentRunner";
import {beginTournamentSessionHand,applyTournamentSessionAction} from "./tournamentSession";
import {createChipLedger} from "../engine/chips";
import {nextToAct,getLegalActions} from "../engine/betting";
it("reveals every live hand only once action closes, including a covering stack and unequal caps",()=>{
 const runner=createCareerTournamentRunner({eventId:"local-qualifier",hero:{id:"hero",name:"Player",rating:1000},mode:"normal",seed:"closed-runout-regression"});
 runner.session.tournament.players=runner.session.tournament.players.map((p,i)=>({...p,stack:[500,250,350,450,650,1000][i]}));
 runner.session.chips=createChipLedger(runner.session.tournament.players);
 let session=beginTournamentSessionHand(runner.session);
 const coveringId=session.tournament.players.find(p=>p.stack>=950)?.id ?? runner.session.tournament.players[5].id;
 let checkedOpen=false;
 for(let i=0;i<30&&!session.activeHand!.betting.complete;i++){
   if(!checkedOpen&&session.activeHand!.betting.players.some(p=>p.status==="all-in")){
     expect(advanceTournamentRunnerOneStep({...runner,session},{policy:{simulations:50}}).events.some(e=>e.kind==="all-in-reveal")).toBe(false);checkedOpen=true;
   }
   const actor=nextToAct(session.activeHand!.betting)!;
   const legal=getLegalActions(session.activeHand!.betting,actor);
   session=applyTournamentSessionAction(session,actor,{type:actor===coveringId?(legal.call?"call":"check"):"all-in"});
 }
 expect(checkedOpen).toBe(true);expect(session.activeHand!.betting.complete).toBe(true);
 expect(session.activeHand!.betting.players.filter(p=>p.status==="active")).toHaveLength(1);
 const step=advanceTournamentRunnerOneStep({...runner,session});
 const reveal=step.events.find(e=>e.kind==="all-in-reveal");
 expect(reveal?.kind).toBe("all-in-reveal");
 if(reveal?.kind!=="all-in-reveal")throw new Error("Missing closed-action reveal");
 expect(reveal.reveals).toHaveLength(6);expect(reveal.playerIds).toContain(coveringId);
 expect(step.events.findIndex(e=>e.kind==="all-in-reveal")).toBeLessThan(step.events.findIndex(e=>e.kind==="board-card-dealt"));
 expect(step.runner.session.activeHand?.board).toHaveLength(3);
});
