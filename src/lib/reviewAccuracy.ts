import {GOOD_MOVE_MAX_EV_LOSS_BB, MODEL_BEST_MAX_EV_LOSS_BB} from "../modes/handReview";
import {calculation} from "./reviewCalculation";
/** Continuous display score of the evaluator's uncertainty-adjusted EV regret.
 * Best-tolerance moves get 100%; the existing good-move boundary anchors 95%.
 * This never feeds back into recommendations or quality classification. */
export function reviewMoveAccuracy(regret:number) {
  const loss=Math.max(0,regret-MODEL_BEST_MAX_EV_LOSS_BB);
  const span=GOOD_MOVE_MAX_EV_LOSS_BB-MODEL_BEST_MAX_EV_LOSS_BB;
  return calculation("Accuracy = 0.95 ^ (max(0, EV loss − best tolerance) / (good tolerance − best tolerance))", {regret,best:MODEL_BEST_MAX_EV_LOSS_BB,good:GOOD_MOVE_MAX_EV_LOSS_BB}, "0.95 ^ (max(0, regret − best) / (good − best))", Math.pow(.95,loss/span));
}
