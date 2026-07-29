import type { SeatActionKind } from "./tableSceneModel";

/**
 * Renderer-neutral public action grammar.  Every value comes from the public
 * presentation queue; cards, equities, and engine policy are deliberately
 * absent from this API.
 */
export interface SceneGesture {
  readonly bodyLean: number;
  readonly armReach: number;
  readonly cardMotion: "rest" | "deal" | "muck";
  readonly chipMotion: "none" | "call" | "bet" | "raise" | "all-in" | "collect";
}

export function sceneGestureFor(
  action: SeatActionKind | undefined,
  progress: number,
  acting: boolean,
  folded: boolean,
): SceneGesture {
  const t = clamp(progress);
  const pulse = Math.sin(Math.PI * t);
  // A folded player can still have a public wager to sweep. Cards continue to
  // use the renderer's folded/muck path, but the chips must not teleport to
  // the pot just because their owner has already folded.
  if (action === "collect") {
    return { bodyLean: 0.015 * pulse, armReach: 0.09 * pulse, cardMotion: "rest", chipMotion: "collect" };
  }
  if (folded || action === "fold") {
    return { bodyLean: -0.04, armReach: 0.07 * pulse, cardMotion: "muck", chipMotion: "none" };
  }
  switch (action) {
    case "deal":
      return { bodyLean: 0.015 * pulse, armReach: 0.12 * pulse, cardMotion: "deal", chipMotion: "none" };
    case "check":
      return { bodyLean: 0.02 * pulse, armReach: 0.065 * pulse, cardMotion: "rest", chipMotion: "none" };
    case "call":
      return { bodyLean: 0.025 * pulse, armReach: 0.11 * pulse, cardMotion: "rest", chipMotion: "call" };
    case "bet":
      return { bodyLean: 0.035 * pulse, armReach: 0.15 * pulse, cardMotion: "rest", chipMotion: "bet" };
    case "raise":
      return { bodyLean: 0.05 * pulse, armReach: 0.2 * pulse, cardMotion: "rest", chipMotion: "raise" };
    case "all-in":
      return { bodyLean: 0.065 * pulse, armReach: 0.24 * pulse, cardMotion: "rest", chipMotion: "all-in" };
    case "win":
      return { bodyLean: 0.03 * pulse, armReach: 0.16 * pulse, cardMotion: "rest", chipMotion: "none" };
    default:
      return { bodyLean: acting ? 0.06 : 0, armReach: 0, cardMotion: "rest", chipMotion: "none" };
  }
}

function clamp(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
}
