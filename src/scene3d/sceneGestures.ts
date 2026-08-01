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
  /** Joint angles applied to each opponent's shoulder/elbow rig. */
  readonly shoulderPitch: number;
  readonly shoulderYaw: number;
  readonly elbowBend: number;
  /** Downward palm travel for the visible rail tap. */
  readonly handTap: number;
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
    return gesture(0.015 * pulse, 0.09 * pulse, "rest", "collect", 0.30 * pulse, 0, 0.38 * pulse);
  }
  if (folded || action === "fold") {
    return gesture(-0.04, 0.07 * pulse, "muck", "none", 0.40 * pulse, 0.06, 0.62 * pulse);
  }
  switch (action) {
    case "deal":
      return gesture(0.015 * pulse, 0.12 * pulse, "deal", "none", 0.28 * pulse, 0, 0.36 * pulse);
    case "check":
      // A check is a sharp down/up knock, not a forward arm slide.
      return gesture(0.02 * pulse, 0, "rest", "none", 0.16 * pulse, 0.05 * pulse, 0.24 * pulse, 0.050 * Math.sin(Math.PI * 2 * t) ** 2);
    case "call":
      return gesture(0.025 * pulse, 0.11 * pulse, "rest", "call", 0.43 * pulse, 0.05, 0.60 * pulse);
    case "bet":
      return gesture(0.035 * pulse, 0.15 * pulse, "rest", "bet", 0.48 * pulse, 0.07, 0.68 * pulse);
    case "raise":
      return gesture(0.05 * pulse, 0.2 * pulse, "rest", "raise", 0.56 * pulse, 0.10, 0.78 * pulse);
    case "all-in":
      return gesture(0.065 * pulse, 0.24 * pulse, "rest", "all-in", 0.68 * pulse, 0.13, 0.92 * pulse);
    case "win":
      return gesture(0.03 * pulse, 0.16 * pulse, "rest", "none", 0.32 * pulse, 0, 0.44 * pulse);
    default:
      return gesture(acting ? 0.06 : 0, 0, "rest", "none", acting ? 0.08 : 0, 0, acting ? 0.10 : 0);
  }
}

function gesture(
  bodyLean: number,
  armReach: number,
  cardMotion: SceneGesture["cardMotion"],
  chipMotion: SceneGesture["chipMotion"],
  shoulderPitch = 0,
  shoulderYaw = 0,
  elbowBend = 0,
  handTap = 0,
): SceneGesture {
  return { bodyLean, armReach, cardMotion, chipMotion, shoulderPitch, shoulderYaw, elbowBend, handTap };
}

function clamp(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
}
