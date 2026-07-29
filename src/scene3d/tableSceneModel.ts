/**
 * The geometry-independent model of the 3D table scene (E09-001 / E27-014).
 *
 * Everything here is pure arithmetic: seat placement around the felt, the
 * camera's seated pose and its clamped yaw, and where a card or chip should be
 * at a given moment of an action. It holds no three.js types and touches no
 * GPU, so the spatial rules can be tested without a renderer -- which matters,
 * because a headless test environment has no WebGL context and the packaged
 * audits cannot assert "the chips went to the right place" from a screenshot.
 *
 * The renderer consumes these numbers. It does not invent any.
 */

/** Radius of the felt, in scene units. One unit is roughly a metre. */
export const TABLE_RADIUS = 1.35;
/** Height of the felt surface above the floor. */
export const TABLE_HEIGHT = 0.78;
/** The active-turn halo sits around a chair on the floor, below every card. */
export const TURN_INDICATOR_HEIGHT = 0.018;
/** Where a seated player's eyes sit above the floor. */
export const EYE_HEIGHT = 1.24;

/**
 * How far the camera may look left or right, in radians.
 *
 * The brief asks for *limited* looking from a seated position: enough to take in
 * the neighbours and the room's near field, not a free orbit. 28 degrees each
 * way keeps the felt and every opponent in frame at the extremes.
 */
export const MAX_YAW_RADIANS = (28 * Math.PI) / 180;

/** The pan control's discrete range, matching the existing table controls. */
export const MIN_PAN = -2;
export const MAX_PAN = 2;

/** The public Settings preference that must affect the real WebGL camera. */
export type SceneCameraView = "close" | "standard" | "wide";
/** Mirrors the public motion setting without importing application state. */
export type SceneCameraMotion = "full" | "reduced" | "off";

export interface SeatPose {
  /** Seat index, 0 = hero. */
  readonly seat: number;
  /** Angle around the table, radians, measured from the hero's position. */
  readonly angle: number;
  /** Where the seated body sits. */
  readonly position: readonly [number, number, number];
  /** Where this seat's cards and bet chips rest on the felt. */
  readonly feltPosition: readonly [number, number, number];
  /** Rotation about Y so the body faces the table centre. */
  readonly facing: number;
}

/**
 * Place `count` seats evenly around the felt with the hero nearest the camera.
 *
 * The hero sits at the near edge (angle 0 maps to +Z) and the rest run
 * anticlockwise, so seat order on screen matches seat order in the DOM layer.
 * Both layers are driven from the same ordering, which is what lets the
 * accessible seat list and the visible bodies agree.
 */
export function seatPoses(count: number): readonly SeatPose[] {
  if (count <= 0) return [];
  const poses: SeatPose[] = [];
  for (let seat = 0; seat < count; seat += 1) {
    const angle = (seat / count) * Math.PI * 2;
    // +Z is toward the camera, so the hero at angle 0 is nearest.
    const x = Math.sin(angle) * TABLE_RADIUS;
    const z = Math.cos(angle) * TABLE_RADIUS;
    // Keep physical chairs just beyond the rail. The prior 0.42m clearance
    // pushed the lateral low-poly bodies beyond the seated camera envelope at
    // compact desktop widths; cards/chips retain their independent felt pose.
    const seatDistance = TABLE_RADIUS + 0.20;
    poses.push({
      seat,
      angle,
      position: [
        Math.sin(angle) * seatDistance,
        0,
        Math.cos(angle) * seatDistance,
      ],
      // Cards and chips rest just inside the rail, in front of the body.
      feltPosition: [x * 0.74, TABLE_HEIGHT, z * 0.74],
      // Bodies face the middle of the table.
      facing: angle + Math.PI,
    });
  }
  return poses;
}

/**
 * Stable world position for the active-turn halo.
 *
 * It deliberately surrounds the occupied chair rather than the felt position:
 * cards stay unobstructed on the table, and the indicator remains below a
 * character's face. The renderer only changes visibility and seat assignment;
 * it never animates this object.
 */
export function turnIndicatorPosition(pose: SeatPose): readonly [number, number, number] {
  return [pose.position[0], TURN_INDICATOR_HEIGHT, pose.position[2]];
}

/** Resolve the active-turn halo by stable player identity, never an array slot. */
export function turnIndicatorPositionForPlayer(
  playerId: string | undefined,
  poseForPlayer: (playerId: string) => SeatPose | undefined,
): readonly [number, number, number] | undefined {
  const pose = playerId === undefined ? undefined : poseForPlayer(playerId);
  return pose ? turnIndicatorPosition(pose) : undefined;
}

/**
 * The seated camera pose for a given pan setting.
 *
 * The camera sits at the hero's eyes and yaws; it does not orbit the table.
 * That distinction is the whole point of a seated view -- the player is a
 * person in a chair, not a spectator on a rig.
 */
export function cameraPose(pan: number, view: SceneCameraView = "standard"): {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly target: readonly [number, number, number];
  /** Perspective field of view, degrees. */
  readonly fov: number;
} {
  const clampedPan = Math.min(MAX_PAN, Math.max(MIN_PAN, pan));
  const yaw = (clampedPan / MAX_PAN) * MAX_YAW_RADIANS;
  const preset = cameraViewPreset(view);
  const position = [0, EYE_HEIGHT, preset.distance] as const;

  // Look at a point on the felt, rotated by the yaw about the camera.
  const lookDistance = preset.distance;
  const target = [
    position[0] - Math.sin(yaw) * lookDistance,
    TABLE_HEIGHT - 0.06,
    position[2] - Math.cos(yaw) * lookDistance,
  ] as const;

  return { position, yaw, target, fov: preset.fov };
}

/** Comfortable seated-camera presets; neither becomes a spectator orbit. */
export function cameraViewPreset(view: SceneCameraView): {
  readonly distance: number;
  readonly fov: number;
} {
  switch (view) {
    case "close": return { distance: TABLE_RADIUS + 0.47, fov: 52 };
    case "wide": return { distance: TABLE_RADIUS + 0.97, fov: 64 };
    default: return { distance: TABLE_RADIUS + 0.72, fov: 58 };
  }
}

/** Actions the scene can show a body performing. */
export type SeatActionKind =
  | "idle"
  | "deal"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "fold"
  | "all-in"
  | "collect"
  | "win";

/**
 * Interpolate a value along an action, given how far through it is.
 *
 * `progress` is 0..1. Smoothstep rather than linear so a body starts and stops
 * rather than snapping -- and, importantly, so the reduced-motion path can pass
 * progress 1 directly and land on exactly the same end state.
 */
export function actionEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/**
 * Where a bet's chips are at `progress` through the push, from the seat's felt
 * spot toward the pot at the centre.
 */
export function betChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  // The pot sits at the middle of the felt, slightly toward the hero so it is
  // not hidden behind the community cards.
  const potX = 0;
  const potZ = 0.18;
  const lift = Math.sin(Math.PI * t) * 0.06;
  return [x + (potX - x) * t, y + lift, z + (potZ - z) * t];
}

/**
 * A call is an economical direct placement: the required chips travel from a
 * seat to the pot on a lower arc than an opening bet.  It still shares the
 * same terminal position, so reduced motion and the next authoritative
 * snapshot agree exactly.
 */
export function callChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.035);
}

/**
 * A raise first gathers chips nearer the player's betting line, then pushes
 * the larger pile into the pot.  This deliberately has a different midpoint
 * from both a call and an opening bet while preserving the same end state.
 */
export function raiseChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  if (t === 1) return [0, y, 0.18];
  const gather: readonly [number, number, number] = [x * 0.82, y, z * 0.82];
  const pot: readonly [number, number, number] = [0, y, 0.18];
  const segment = t < 0.34 ? t / 0.34 : (t - 0.34) / 0.66;
  const from = t < 0.34 ? pose.feltPosition : gather;
  const to = t < 0.34 ? gather : pot;
  const lift = Math.sin(Math.PI * t) * 0.085;
  return [
    from[0] + (to[0] - from[0]) * segment,
    y + lift,
    from[2] + (to[2] - from[2]) * segment,
  ];
}

/** An all-in uses the ordinary destination, but visibly clears a deeper pile. */
export function allInChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.11);
}

function chipPositionAlongPush(
  pose: SeatPose,
  progress: number,
  maxLift: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  if (t === 1) return [0, y, 0.18];
  const lift = Math.sin(Math.PI * t) * maxLift;
  return [x * (1 - t), y + lift, z + (0.18 - z) * t];
}

/**
 * Where a dealt card is at `progress`, travelling from the dealer's hands to a
 * seat's felt spot.
 */
export function dealtCardPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const from: readonly [number, number, number] = [0, TABLE_HEIGHT + 0.02, -0.5];
  const [tx, ty, tz] = pose.feltPosition;
  const lift = Math.sin(Math.PI * t) * 0.1;
  return [
    from[0] + (tx - from[0]) * t,
    from[1] + (ty - from[1]) * t + lift,
    from[2] + (tz - from[2]) * t,
  ];
}

/**
 * Where a folded card is at `progress`, travelling from the seat toward the
 * muck in front of the dealer. A fold is a card leaving the hand, and it has to
 * read as that rather than as the card simply vanishing.
 */
export function muckedCardPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  const muck: readonly [number, number, number] = [0.42, TABLE_HEIGHT, -0.52];
  const lift = Math.sin(Math.PI * t) * 0.05;
  return [x + (muck[0] - x) * t, y + lift, z + (muck[2] - z) * t];
}

/**
 * How many chips to draw for an amount.
 *
 * Deliberately compressive: a stack should read as "short" or "deep" at a
 * glance without a thousand-chip pile costing a thousand draw calls. Mirrors
 * the DOM layer's `potChipStackCount` intent so the two never disagree about
 * who looks short.
 */
export function chipCountForAmount(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.min(18, Math.round(Math.log10(amount + 1) * 4)));
}
