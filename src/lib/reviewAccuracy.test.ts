import {describe,it,expect} from "vitest";
import {reviewMoveAccuracy} from "./reviewAccuracy";
import {qualityFor,MODEL_BEST_MAX_EV_LOSS_BB,GOOD_MOVE_MAX_EV_LOSS_BB} from "../modes/handReview";
describe("continuous review accuracy",()=>{
 it("gives tolerance-approved decisions full credit",()=>{
  expect(reviewMoveAccuracy(0).result).toBe(1);
  expect(reviewMoveAccuracy(MODEL_BEST_MAX_EV_LOSS_BB).result).toBe(1);
  expect(reviewMoveAccuracy(GOOD_MOVE_MAX_EV_LOSS_BB).result).toBeCloseTo(.95);
 });
 it("degrades continuously without changing quality bands",()=>{
  const losses=[0,.02,.2,.35,.6,1.2,2,4,8,20];
  const scores=losses.map(r=>reviewMoveAccuracy(r).result);
  for(let i=1;i<scores.length;i++)expect(scores[i]).toBeLessThanOrEqual(scores[i-1]);
  expect(qualityFor(.6)).toBe("inaccuracy");expect(reviewMoveAccuracy(.6).result).toBeGreaterThan(.8);
  expect(qualityFor(8)).toBe("blunder");expect(reviewMoveAccuracy(8).result).toBeLessThan(.3);
 });
 it("records the actual regret and evaluator tolerances for formula substitution",()=>{
  expect(reviewMoveAccuracy(.6).inputs).toEqual({regret:.6,best:.02,good:.35});
 });
});
