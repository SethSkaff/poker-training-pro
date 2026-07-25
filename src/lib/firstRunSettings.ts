import type { GameSettings } from "../types/poker";

/**
 * Applies the first-run screen's motion-choice semantics without conflating
 * accepting an OS-derived default with deliberately overriding that default.
 */
export function completeFirstRunSettings(
  initialSettings: GameSettings,
  draft: GameSettings,
  motionChoiceTouched: boolean,
): GameSettings {
  return {
    ...draft,
    reducedMotionExplicit: motionChoiceTouched
      ? true
      : initialSettings.reducedMotionExplicit,
  };
}

/** Skipping setup must leave motion under the live OS default. */
export function skipFirstRunSettings(initialSettings: GameSettings): GameSettings {
  return { ...initialSettings, reducedMotionExplicit: false };
}
