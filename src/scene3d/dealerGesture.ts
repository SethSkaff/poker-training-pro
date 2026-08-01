/**
 * What the dealer is doing with their hands, as pure arithmetic.
 *
 * The players' gestures (`sceneGestures`) answer "what is this seat doing"; this
 * answers "what is the house doing about it". They are separate because the
 * dealer is not a seat: they never act, they respond -- to a deal, to bets that
 * need sweeping, to a pot that needs pushing. One dealer serves every seat, so
 * the question is always "which piece of work is in flight" rather than "what is
 * my own action".
 *
 * Holds no three.js types. The renderer assigns the rotations this returns
 * directly to the dealer's shoulder joint; it does not invent any of them.
 */
import { seatLocalPoint, type SeatPose } from "./tableSceneModel";

/** The one job the dealer is doing this frame. */
export type DealerTask = "idle" | "deal" | "collect" | "push";

/** A piece of work the table has given the dealer. */
export interface DealerWork {
  readonly task: Exclude<DealerTask, "idle">;
  /** 0..1 through the action's presentation beat. */
  readonly progress: number;
  /** Table-space point being served: a seat's felt lane. */
  readonly at: readonly [number, number, number];
}

export interface DealerGesture {
  readonly task: DealerTask;
  /**
   * Shoulder pitch in radians, ready to assign to `arms.rotation.x`.
   *
   * Signed for direct assignment, and the sign is not the intuitive one: the
   * hands hang *below* and *forward of* the shoulder, so a positive rotation
   * about X drops them and pulls them back toward the dealer. Reaching further
   * over the felt is therefore negative. Returning the finished value keeps that
   * trap in one tested place instead of in the renderer.
   */
  readonly shoulderPitch: number;
  /** Shoulder yaw in radians for `arms.rotation.y`; positive turns to +X. */
  readonly shoulderYaw: number;
  /** Torso travel toward the table in metres, for `body.position.z`. */
  readonly lean: number;
}

/**
 * How far the arms swing on each job.
 *
 * A deal is a flick of the wrist and a pitch; a sweep is the dealer's whole
 * upper body coming forward to rake bets in; a push is the deepest reach of the
 * three, because the pot has to travel all the way to a seat.
 */
const DEAL_PITCH = 0.26;
/** The dealer first takes the card at the shoe, then follows through to a seat. */
const DEAL_PICKUP_FRACTION = 0.22;
const DEAL_RELEASE_FRACTION = 0.38;
const SWEEP_PITCH = 0.44;
const PUSH_PITCH = 0.40;

/**
 * The shoulders turn far less than the bearing to a seat.
 *
 * A dealer serving the seat beside them does not rotate to face it; they reach
 * across. Following the bearing 1:1 spun the arms through the torso at the
 * outer stations. This is the fraction of the bearing the shoulders actually
 * take, and the hard clamp past it.
 */
const YAW_FOLLOW = 0.55;
const MAX_YAW = 0.80;

/** Idle is not motionless: a still figure at a card table reads as a prop. */
const BREATH_PITCH = 0.012;
const BREATH_PERIOD_MS = 4200;

/**
 * Pick the one action the dealer is attending to.
 *
 * Priority is chronological rather than arbitrary: a pot being pushed is the end
 * of a hand and outranks a sweep, which outranks a deal. Among equals the least
 * advanced wins, so the dealer follows the work still in flight rather than
 * snapping to whichever seat happens to sort first. Finished beats are dropped
 * entirely -- that is what returns the dealer to idle.
 */
export function dealerWorkFor(
  candidates: readonly DealerWork[],
): DealerWork | undefined {
  const rank: Record<Exclude<DealerTask, "idle">, number> = { push: 0, collect: 1, deal: 2 };
  return candidates
    .filter((candidate) => candidate.progress < 1)
    .sort((left, right) =>
      rank[left.task] - rank[right.task] || left.progress - right.progress)[0];
}

/**
 * The dealer's pose for one frame.
 *
 * `dealerPose` is the dealer's own station, used to turn a table-space target
 * into a bearing in the frame their shoulders actually rotate in. `nowMs` drives
 * the idle breath only.
 */
export function dealerGestureFor(
  work: DealerWork | undefined,
  dealerPose: SeatPose,
  nowMs: number,
): DealerGesture {
  if (!work) {
    const breath = Math.sin((nowMs / BREATH_PERIOD_MS) * Math.PI * 2);
    return { task: "idle", shoulderPitch: breath * BREATH_PITCH, shoulderYaw: 0, lean: 0 };
  }

  const t = Math.min(1, Math.max(0, work.progress));
  const bearing = bearingFrom(dealerPose, work.at);

  switch (work.task) {
    case "deal": {
      /*
        A pitch has a readable cause-and-effect order:

        1. reach down over the shoe and take the top card,
        2. turn and follow through toward the recipient,
        3. recover after the card has left the hand.

        The previous single sine wave began the hand and the card at the same
        instant. That reads as a card flying off a deck while a nearby prop
        happens to wave, rather than a dealer dealing it.
      */
      const pickup = Math.min(1, t / DEAL_PICKUP_FRACTION);
      const release = Math.max(0, Math.min(1, (t - DEAL_RELEASE_FRACTION) / (1 - DEAL_RELEASE_FRACTION)));
      const pickupReach = Math.sin(Math.PI * pickup * 0.5)
        * (t <= 0.33 ? 1 : Math.max(0, 1 - (t - 0.33) / 0.25));
      const followThrough = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - 0.14) / 0.72)));
      const envelope = Math.max(pickupReach * 0.70, followThrough);
      return {
        task: "deal",
        shoulderPitch: -DEAL_PITCH * 1.30 * envelope,
        // Keep both hands square at the shoe until the pickup is complete;
        // the target turn occurs only while the card is leaving the dealer.
        shoulderYaw: bearing * Math.sin(Math.PI * Math.min(1, release * 0.84)),
        lean: 0.016 * envelope,
      };
    }
    case "collect": {
      /*
        Reach out to the bet, then rake it in.

        The hands are furthest out at a third of the way through and travelling
        back for the rest, which is what makes it read as a rake rather than as a
        wave: the extension and the return are deliberately not symmetric. The
        yaw runs the other way, from the seat's bearing back to square, so the
        arms end over the pot.
      */
      const out = t < 0.34 ? t / 0.34 : 1 - (t - 0.34) / 0.66;
      return {
        task: "collect",
        shoulderPitch: -SWEEP_PITCH * out,
        shoulderYaw: bearing * (1 - t),
        lean: 0.030 * out,
      };
    }
    default: {
      // A push is the mirror of a sweep: the hands start square over the pot and
      // carry it out to the winning seat, so the yaw grows instead of decaying.
      const out = Math.sin(Math.PI * t);
      return {
        task: "push",
        shoulderPitch: -PUSH_PITCH * out,
        shoulderYaw: bearing * t,
        lean: 0.026 * out,
      };
    }
  }
}

/** The clamped shoulder yaw that puts the dealer's hands over a table point. */
function bearingFrom(
  dealerPose: SeatPose,
  at: readonly [number, number, number],
): number {
  const local = seatLocalPoint(dealerPose, at);
  const raw = Math.atan2(local[0], Math.max(0.05, local[2]));
  return Math.max(-MAX_YAW, Math.min(MAX_YAW, raw * YAW_FOLLOW));
}
