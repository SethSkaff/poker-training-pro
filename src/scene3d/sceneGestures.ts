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
  /** Which articulated arm is deliberately moving for this action. */
  readonly movingArm: "left" | "right" | "both" | "none";
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
    // The dealer owns the rake. A player's arm must not pulse while their
    // already-committed chips travel from the wager circle to the pot.
    return gesture(0, 0, "rest", "collect", 0, 0, 0, 0, "none");
  }
  if (folded || action === "fold") {
    return gesture(-0.04, 0.07 * pulse, "muck", "none", 0.40 * pulse, 0.06, 0.62 * pulse);
  }
  switch (action) {
    case "deal":
      return gesture(0.015 * pulse, 0.12 * pulse, "deal", "none", 0.28 * pulse, 0, 0.36 * pulse);
    case "check":
      /*
        Two short table knocks with the player's right hand. The contact pulses
        are deliberately separate so a check reads as a check rather than the
        old continuous two-handed bounce. Shoulder, elbow and wrist all settle
        between taps; the chair and torso root never travel.
      */
      return checkGesture(t);
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
  movingArm: SceneGesture["movingArm"] = "both",
): SceneGesture {
  return {
    bodyLean,
    armReach,
    cardMotion,
    chipMotion,
    shoulderPitch,
    shoulderYaw,
    elbowBend,
    handTap,
    movingArm,
  };
}

function checkGesture(progress: number): SceneGesture {
  // Two 110 ms contacts with a readable 90 ms gap. The final third is a
  // recovery beat, which leaves the hand at the authored resting pose.
  const tap = (time: number, centre: number, width: number): number => {
    const local = (time - centre) / width;
    return Math.abs(local) <= 1 ? Math.sin((local + 1) * Math.PI * 0.5) ** 2 : 0;
  };
  const first = tap(progress, 0.24, 0.075);
  const second = tap(progress, 0.48, 0.075);
  const knock = Math.max(first, second);
  return gesture(
    0.010 * knock,
    0,
    "rest",
    "none",
    0.16 * knock,
    0.038 * knock,
    0.28 * knock,
    0.050 * knock,
    "right",
  );
}

function clamp(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
}
