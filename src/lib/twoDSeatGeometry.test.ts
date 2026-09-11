import {describe,it,expect} from "vitest";
import {twoDSeatGeometry,type TableSeatPosition} from "./twoDSeatGeometry";
const seats:TableSeatPosition[]=["hero","lower-left","upper-left","top","upper-right","lower-right"];
describe("seat-local physical geometry",()=>{
 it.each(seats)("puts %s stacks on personal-left and bets centrally inward",seat=>{
  const g=twoDSeatGeometry(seat,1100,430,57,52);
  const sx=g.stack.x-g.card.x,sy=g.stack.y-g.card.y,bx=g.bet.x-g.card.x,by=g.bet.y-g.card.y;
  expect(sx*g.left.x+sy*g.left.y).toBeGreaterThan(40);
  expect(bx*g.inward.y-by*g.inward.x).toBeCloseTo(0);
  expect(bx*g.inward.x+by*g.inward.y).toBeGreaterThan(57);
  expect(Math.hypot(g.runout.x-550,g.runout.y-215)).toBeLessThan(Math.hypot(g.card.x-550,g.card.y-215));
 });
 it("reverses personal-left between bottom and top seats",()=>{
  const bottom=twoDSeatGeometry("hero",1100,430,57),top=twoDSeatGeometry("top",1100,430,57);
  expect(bottom.stack.x).toBeLessThan(bottom.card.x);expect(top.stack.x).toBeGreaterThan(top.card.x);
  expect(bottom.angle).toBeCloseTo(0);expect(Math.abs(top.angle)).toBeCloseTo(180);
 });
 it("keeps complete chip-label rectangles inside the felt",()=>{
  for(const seat of seats){const g=twoDSeatGeometry(seat,1100,430,57,52);for(const x of [-42,42])for(const y of [-20,20])expect(((g.stack.x+x-550)/538)**2+((g.stack.y+y-215)/203)**2).toBeLessThanOrEqual(1.001);}
 });
});
