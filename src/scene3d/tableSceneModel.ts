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

/**
 * Direction A's named, single-source composition contract.  Every number in
 * the ready-mode renderer comes from here; fallback CSS is intentionally not
 * part of this world contract.
 */
import { MAX_SEATED_HEAD_HEIGHT } from "./characterModel";

export const TABLE_COMPOSITION_ID = "open-arc-v2";
/**
 * Capsule table dimensions, in metres.
 *
 * Reduced from 2.72 x 1.42 with the v2 close pose. The owner asked for a much
 * *apparently* larger table; sitting at opponent distance delivers that, but at
 * that range the old ±1.28 near seats projected off-screen. Tightening the arc
 * onto a slightly smaller capsule keeps all five opponents in the resting view
 * while the felt still fills ~98% of a 16:9 frame.
 */
export const TABLE_WIDTH = 2.42;
export const TABLE_DEPTH = 1.34;
export const TABLE_RAIL_WIDTH = 0.12;
/** Retained name for the older object-motion helpers. */
export const TABLE_RADIUS = TABLE_WIDTH / 2;
/** Height of the felt surface above the floor. */
export const TABLE_HEIGHT = 0.76;
/** The active-turn halo sits around a chair on the floor, below every card. */
export const TURN_INDICATOR_HEIGHT = 0.018;
/** Where a seated player's eyes sit above the floor, leaning slightly in. */
export const EYE_HEIGHT = 1.36;
/** v2 lens. Wider than v1's 52 so the close pose still holds the forward arc. */
export const CAMERA_VERTICAL_FOV = 56;
/** A poker player looks down at the felt; v1's -16 degrees read as a spectator. */
export const CAMERA_PITCH_DEGREES = 27;
/**
 * Direction A reconciliation: closest normal seated depth and the compact
 * native-safe ceiling.  The final solver also reserves the approved apparent
 * capsule-table width, which requires 3.62 m at 1024x768. The original 2.25 m
 * initial range is deliberately exceeded there rather than clipping a player,
 * shrinking the table, or distorting it with a wider lens.
 */
export const CAMERA_DEPTH_MIN = 1.25;
export const CAMERA_DEPTH_MAX = 2.30;
export const CAMERA_SAFE_INSET_PX = 16;
/*
  The critical envelope is now the outer near seat's shoulder at head height:
  that is the first thing the close pose pushes out of frame, and it is what the
  depth solver backs away from on narrow aspects. Measured against the v2 arc.
*/
const CRITICAL_NEAR_SEAT_X = 1.24 + 0.18;
const CRITICAL_NEAR_SEAT_Z = -0.16;
// Derived from the character library so the solver always reserves room for the
// head that is actually rendered; a hard-coded 1.13 disagreed with the seated
// proportions by about 0.14 m.
const CRITICAL_NEAR_SEAT_Y = MAX_SEATED_HEAD_HEIGHT;
/**
 * Visual breathing room beyond the geometric envelope.
 *
 * Reserving only the head's own half-width put its silhouette exactly on the
 * frame edge, and the chair and shoulders behind it were then clipped -- the
 * -27 degree gaze shortens view-space depth, so a near seat is optically much
 * closer than its ground distance suggests. A head touching the edge reads as
 * clipped even when it technically fits.
 */
const NEAR_SEAT_VISUAL_SAFE_FRACTION = 0.94;
const OUTER_RAIL_HALF_WIDTH = TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH;
const OUTER_NEAR_RAIL_Z = TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH;
const DESKTOP_GAMEPLAY_SAFE_WIDTH_PX = 1920;

/**
 * How far the camera may look left or right, in radians.
 *
 * The brief asks for *limited* looking from a seated position: enough to take in
 * the neighbours and the room's near field, not a free orbit. 28 degrees each
 * way keeps the felt and every opponent in frame at the extremes.
 */
export const MAX_YAW_RADIANS = (32 * Math.PI) / 180;

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

/*
  v2 tightened forward arc. The near pair moved from z +0.28 to z -0.16, i.e.
  genuinely in front of the hero rather than beside the lens, which is what keeps
  them on screen at the close seated pose.
*/
const OPEN_ARC_OPPONENTS = [
  [-1.24, -0.16], [-0.98, -0.74], [0, -0.94], [0.98, -0.74], [1.24, -0.16],
] as const;

const OPEN_ARC_FELT_ANCHORS = [
  [-0.77, -0.10], [-0.61, -0.46], [0, -0.58], [0.61, -0.46], [0.77, -0.10],
] as const;

/** Direction A's public poker-object anchors. */
export const OPEN_ARC_ANCHORS = {
  // Hero objects sit immediately inside the near rail. They are deliberately
  // closer than the board so the player reads cards and chips as physical
  // foreground rather than a small duplicate on the felt.
  // Rescaled onto the v2 capsule (near felt edge z = TABLE_DEPTH/2 = 0.67). The
  // hero's hand lies flat on the felt where the -27 degree gaze reads it, rather
  // than tilted up against the rail.
  heroCards: [[-0.10, TABLE_HEIGHT, 0.46], [0.10, TABLE_HEIGHT, 0.46]] as const,
  heroStack: [0.44, TABLE_HEIGHT, 0.42] as const,
  heroCommitted: [0.38, TABLE_HEIGHT, 0.20] as const,
  board: [0, TABLE_HEIGHT + 0.005, -0.20] as const,
  mainPot: [0, TABLE_HEIGHT + 0.005, 0.06] as const,
  sidePot: (index: number) => [index % 2 === 0 ? 0.32 + Math.floor(index / 2) * 0.20 : -0.32 - Math.floor(index / 2) * 0.20, TABLE_HEIGHT + 0.005, 0.06] as const,
  cameraTarget: [0, 0.73, -0.20] as const,
} as const;

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
  // Seat zero is the invisible hero anchor.  The next five are a deliberately
  // forward-only horseshoe: no chair can enter from behind or beside the lens.
  const hero: SeatPose = {
    seat: 0,
    angle: 0,
    position: [0, 0, 1.95],
    feltPosition: [0, TABLE_HEIGHT, 0.50],
    facing: Math.PI,
  };
  const opponents = OPEN_ARC_OPPONENTS.map(([x, z], index): SeatPose => {
    const [feltX, feltZ] = OPEN_ARC_FELT_ANCHORS[index];
    return {
      seat: index + 1,
      angle: Math.atan2(x, z),
      position: [x, 0, z],
      feltPosition: [feltX, TABLE_HEIGHT, feltZ],
      facing: Math.atan2(-x, -z),
    };
  });
  return [hero, ...opponents].slice(0, Math.min(count, 6));
}

/**
 * Convert a table-space point into a seat group's local frame.
 *
 * Seat roots are translated to `pose.position` and rotated by `pose.facing`
 * about Y, so a child's local point maps to the world as three.js applies
 * `rotation.y`: `wx = cos(f)·lx + sin(f)·lz`, `wz = -sin(f)·lx + cos(f)·lz`.
 * The inverse therefore rotates by `-facing`, which is `cos(+facing)` with a
 * negated sine term -- *not* `cos(-facing)`/`sin(-facing)`, which silently
 * re-applies the forward rotation.
 *
 * This lived as a closure inside the renderer and got that inverse backwards,
 * which threw every non-centre seat's cards, bet, and stack about a metre off
 * the felt while the pure seat model still tested clean. It is exported so the
 * round trip is asserted rather than assumed.
 */
export function seatLocalPoint(
  pose: SeatPose,
  world: readonly [number, number, number],
): readonly [number, number, number] {
  const dx = world[0] - pose.position[0];
  const dz = world[2] - pose.position[2];
  const cos = Math.cos(pose.facing);
  const sin = Math.sin(pose.facing);
  return [dx * cos - dz * sin, world[1], dx * sin + dz * cos] as const;
}

/**
 * The forward map a seat group's transform applies, for tests and any caller
 * that needs to check where a local offset actually lands on the felt.
 */
export function seatWorldPoint(
  pose: SeatPose,
  local: readonly [number, number, number],
): readonly [number, number, number] {
  const cos = Math.cos(pose.facing);
  const sin = Math.sin(pose.facing);
  return [
    pose.position[0] + local[0] * cos + local[2] * sin,
    local[1],
    pose.position[2] - local[0] * sin + local[2] * cos,
  ] as const;
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
export function cameraPose(
  pan: number,
  view: SceneCameraView = "standard",
  aspect = 1366 / 768,
  viewportWidth = 1366,
): {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly target: readonly [number, number, number];
  /** Perspective field of view, degrees. */
  readonly fov: number;
} {
  const clampedPan = Math.min(MAX_PAN, Math.max(MIN_PAN, pan));
  const yaw = (clampedPan / MAX_PAN) * MAX_YAW_RADIANS;
  const preset = cameraViewPreset(view, aspect, viewportWidth);
  const position = [0, EYE_HEIGHT, preset.distance] as const;
  const targetBase = OPEN_ARC_ANCHORS.cameraTarget;
  const lookDistance = Math.hypot(position[0] - targetBase[0], position[2] - targetBase[2]);
  // A fixed target height made the pitch flatten as compact-safe depth
  // increased, pushing the room horizon down into a dashboard-like frame.
  // Keep the approved seated -16-degree gaze while retaining the same centered
  // target x/z anchor and camera eye height.
  const targetHeight = EYE_HEIGHT - Math.tan((CAMERA_PITCH_DEGREES * Math.PI) / 180) * lookDistance;
  // The camera looks down -Z from the hero's seat, so screen-right is +X and a
  // negative yaw ("look one seat left") must swing the target toward -X. The
  // earlier negated sine turned the camera the opposite way, so the left
  // control revealed the room on the player's right.
  const target = [
    targetBase[0] + Math.sin(yaw) * lookDistance,
    targetHeight,
    position[2] - Math.cos(yaw) * lookDistance,
  ] as const;

  return { position, yaw, target, fov: preset.fov };
}

/** Comfortable seated-camera presets; neither becomes a spectator orbit. */
export function cameraViewPreset(
  view: SceneCameraView,
  aspect = 1366 / 768,
  viewportWidth = 1366,
): {
  readonly distance: number;
  readonly fov: number;
} {
  // The approved composition has one 52-degree vertical lens. Neither the
  // legacy close/wide preference nor responsive fitting may use FOV to squeeze
  // the composition into a capture; only seated camera depth moves.
  void view;
  return {
    distance: cameraDepthForSafeFrame(CAMERA_VERTICAL_FOV, aspect, viewportWidth),
    fov: CAMERA_VERTICAL_FOV,
  };
}

/**
 * Minimum centered camera depth for the Direction A critical near-seat
 * envelope.  This preserves table/seat scale and FOV: only the seated camera
 * retreats enough to put x=±1.54 m at least 16 native pixels from a side edge.
 */
export function cameraDepthForSafeFrame(
  verticalFovDegrees: number,
  aspect: number,
  viewportWidth: number,
): number {
  const width = Math.max(1, viewportWidth);
  const safeFraction = Math.max(0.5, 1 - (CAMERA_SAFE_INSET_PX * 2) / width);
  const halfHorizontalTangent = Math.tan((verticalFovDegrees * Math.PI) / 360)
    * Math.max(0.1, aspect);
  /*
   * v2 inverts the old rule. There is no longer a table-width target to fit --
   * the owner wants the felt to dominate -- so the pose sits at CAMERA_DEPTH_MIN
   * and the solver's only job is to retreat far enough that the outer near
   * seat's shoulder stays inside the safe frame. On 16:9 and wider that costs
   * almost nothing; on the legacy 4:3 target it backs off noticeably, which is
   * the correct trade for not clipping a player.
   *
   * The pitch matters here: the gaze is 27 degrees down, so a head above the
   * felt is nearer the view axis than its ground-plane distance suggests.
   */
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const requiredViewDepth = CRITICAL_NEAR_SEAT_X
    / (halfHorizontalTangent * safeFraction * NEAR_SEAT_VISUAL_SAFE_FRACTION);
  // viewDepth = (camZ - seatZ)*cos(pitch) + (eye - seatY)*sin(pitch)
  const heightTerm = (EYE_HEIGHT - CRITICAL_NEAR_SEAT_Y) * Math.sin(pitch);
  const required = CRITICAL_NEAR_SEAT_Z
    + (requiredViewDepth - heightTerm) / Math.max(0.2, Math.cos(pitch));
  void OUTER_NEAR_RAIL_Z;
  void OUTER_RAIL_HALF_WIDTH;
  void DESKTOP_GAMEPLAY_SAFE_WIDTH_PX;
  return Math.min(CAMERA_DEPTH_MAX, Math.max(CAMERA_DEPTH_MIN, required));
}

/**
 * The point on the outer rail directly in front of a seat.
 *
 * Ready-mode seat plaques must *attach to the rail* rather than sit at fixed
 * viewport percentages -- the earlier arbitrary percentage anchors (14%/57%,
 * 18%/31%, ...) matched no actual chair and left nameplates, markers, and card
 * mirrors floating in empty room while the bodies sat on the forward arc.
 * Plaque height stays on the rail so it can never rise over a face.
 */
export function seatRailAnchor(pose: SeatPose): readonly [number, number, number] {
  const [x, , z] = pose.feltPosition;
  const length = Math.hypot(x, z);
  if (length === 0) return [0, TABLE_HEIGHT + 0.03, TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH];
  const dx = x / length;
  const dz = z / length;
  const halfWidth = TABLE_WIDTH / 2;
  const halfDepth = TABLE_DEPTH / 2;
  const straight = Math.max(0, halfWidth - halfDepth);
  // Capsule boundary along the ray: the flat side if the ray leaves through it,
  // otherwise one of the two end caps.
  let t = Number.POSITIVE_INFINITY;
  if (Math.abs(dz) > 1e-9) {
    const flat = halfDepth / Math.abs(dz);
    if (Math.abs(flat * dx) <= straight) t = flat;
  }
  if (!Number.isFinite(t)) {
    const centreX = Math.sign(dx || 1) * straight;
    const dot = dx * centreX;
    const discriminant = Math.max(0, dot * dot - centreX * centreX + halfDepth * halfDepth);
    t = dot + Math.sqrt(discriminant);
  }
  const boundary = [dx * t, dz * t] as const;
  const boundaryLength = Math.hypot(boundary[0], boundary[1]) || 1;
  const outward = (boundaryLength + TABLE_RAIL_WIDTH) / boundaryLength;
  return [boundary[0] * outward, TABLE_HEIGHT + 0.03, boundary[1] * outward] as const;
}

/**
 * Project a world point into viewport percentages for the current camera.
 *
 * Pure perspective arithmetic against the same `cameraPose` the renderer uses,
 * so DOM plaques track the physical rail through pan and every responsive depth
 * without a per-frame bridge out of three.js. `behind` is true when the point is
 * at or behind the lens, where a projected percentage is meaningless.
 */
export function projectToViewport(
  world: readonly [number, number, number],
  camera: ReturnType<typeof cameraPose>,
  viewportWidth: number,
  viewportHeight: number,
): { readonly xPercent: number; readonly yPercent: number; readonly behind: boolean } {
  const aspect = Math.max(0.1, viewportWidth / Math.max(1, viewportHeight));
  const [px, py, pz] = camera.position;
  const forward = [
    camera.target[0] - px,
    camera.target[1] - py,
    camera.target[2] - pz,
  ] as const;
  const forwardLength = Math.hypot(...forward) || 1;
  const f = [forward[0] / forwardLength, forward[1] / forwardLength, forward[2] / forwardLength] as const;
  // right = normalize(f x worldUp) and up = right x f, with worldUp = +Y. The
  // gaze never approaches vertical at Direction A's fixed -16 degrees, so this
  // basis cannot degenerate.
  const rightLength = Math.hypot(f[2], f[0]) || 1;
  const r = [-f[2] / rightLength, 0, f[0] / rightLength] as const;
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ] as const;
  const d = [world[0] - px, world[1] - py, world[2] - pz] as const;
  const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const halfTangent = Math.tan((camera.fov * Math.PI) / 360);
  if (depth <= 1e-4) return { xPercent: 50, yPercent: 50, behind: true };
  const xView = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const yView = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const ndcX = xView / (depth * halfTangent * aspect);
  const ndcY = yView / (depth * halfTangent);
  return {
    xPercent: ((ndcX + 1) / 2) * 100,
    yPercent: ((1 - ndcY) / 2) * 100,
    behind: false,
  };
}

/**
 * How far above its rail anchor a seat plaque is drawn, as a share of viewport
 * height. The anchor is the plaque's bottom edge, which keeps it clear of the
 * felt objects below -- notably the main pot plaque, which used to collide with
 * the centre seat's nameplate.
 */
export const SEAT_PLAQUE_LIFT_PERCENT = 0.8;

/**
 * Viewport anchor for a ready-mode seat plaque, or `undefined` when the seat has
 * no physical body to attach to (the hero, whose seat is the camera) or projects
 * behind the lens.
 */
export function seatPlaqueViewportAnchor(
  relativeSeat: number,
  cameraPan: number,
  viewportWidth: number,
  viewportHeight: number,
  view: SceneCameraView = "standard",
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat <= 0 || relativeSeat > 5) return undefined;
  if (viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const pose = seatPoses(6)[relativeSeat];
  if (!pose) return undefined;
  const camera = cameraPose(
    cameraPan,
    view,
    viewportWidth / viewportHeight,
    viewportWidth,
  );
  const projected = projectToViewport(
    seatRailAnchor(pose),
    camera,
    viewportWidth,
    viewportHeight,
  );
  if (projected.behind) return undefined;
  return {
    xPercent: projected.xPercent,
    yPercent: projected.yPercent - SEAT_PLAQUE_LIFT_PERCENT,
  };
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
