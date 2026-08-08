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
import {
  cameraPose as ringCameraPose,
  dealerStation,
  heroStationIndex,
  playerStations,
  stationAsPose,
  stationIndexForRelativeSeat,
  TABLE_ANCHORS,
  PLAYER_STATION_COUNT,
  type Station,
  type SceneCameraView,
} from "./tableStations";

export {
  CAMERA_PITCH_DEGREES,
  CAMERA_VERTICAL_FOV,
  dealerStation,
  EYE_HEIGHT,
  heroStationIndex,
  MAX_PAN,
  MAX_YAW_RADIANS,
  MIN_PAN,
  playerStations,
  PLAYER_STATION_COUNT,
  stationIndexForRelativeSeat,
  TABLE_ANCHORS,
  TABLE_COMPOSITION_ID,
  TABLE_DEPTH,
  TABLE_HEIGHT,
  TABLE_RAIL_WIDTH,
  TABLE_WIDTH,
  type SceneCameraMotion,
  type SceneCameraView,
  type Station,
} from "./tableStations";

/** Convert the persisted lens choice plus wheel zoom into the renderer FOV input. */
export function cameraLensZoom(
  view: SceneCameraView = "standard",
  wheelZoom = 0,
): number {
  const viewZoom = view === "close" ? 0.35 : view === "wide" ? -0.35 : 0;
  return Math.min(1, Math.max(-1, viewZoom + wheelZoom));
}

import {
  TABLE_DEPTH,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from "./tableStations";

/** Retained name for older object-motion helpers. */
export const TABLE_RADIUS = TABLE_WIDTH / 2;
/** The active-turn cue sits on the felt, below every card. */
export const TURN_INDICATOR_HEIGHT = 0.018;

export interface SeatPose {
  readonly seat: number;
  readonly angle: number;
  readonly position: readonly [number, number, number];
  readonly feltPosition: readonly [number, number, number];
  readonly facing: number;
}

/**
 * Hero-relative seat poses, mapped onto the ring.
 *
 * Seat 0 is always the hero, because the engine and the accessible DOM both order
 * seats hero-first. Which *station* that is depends on where the hero was seated,
 * so this is the one place the two orderings meet. Unlike the old open-arc model,
 * the hero is an ordinary seat here: their cards and chips use their own felt
 * anchor exactly like everyone else's, which is what lets the hole cards live on
 * the table instead of in a floating surface.
 */
export function seatPoses(count: number, heroIndex = 0): readonly SeatPose[] {
  if (count <= 0) return [];
  const stations = playerStations();
  return Array.from(
    { length: Math.min(count, PLAYER_STATION_COUNT) },
    (_, relativeSeat) => stationAsPose(
      stations[stationIndexForRelativeSeat(relativeSeat, heroIndex)],
      relativeSeat,
    ),
  );
}

/** The seated camera at the hero's own station. */
export function cameraPose(
  pan: number,
  heroIndex = 0,
  aspect = 16 / 9,
  zoom = 0,
): ReturnType<typeof ringCameraPose> {
  return ringCameraPose(pan, heroIndex, aspect, zoom);
}

/** The rail anchor for a station, kept for non-numeric scene composition. */
export function seatRailAnchor(pose: SeatPose): readonly [number, number, number] {
  const stations = playerStations();
  const match = stations.find(
    (station: Station) => station.position[0] === pose.position[0]
      && station.position[2] === pose.position[2],
  );
  return match?.railPosition ?? [pose.feltPosition[0], TABLE_HEIGHT + 0.03, pose.feltPosition[2]];
}

/**
 * Convert a table-space point into a station group's local frame.
 *
 * Station roots are translated and rotated about Y, so a child's local point maps
 * to the world as three.js applies `rotation.y`. The inverse rotates by
 * `-facing`, which is `cos(+facing)` with a negated sine term -- *not*
 * `cos(-facing)`/`sin(-facing)`, which silently re-applies the forward rotation
 * and threw every non-centre seat's cards and chips a metre off the felt.
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

/** The forward map a station group's transform applies. */
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

/** The actor cue sits on that player's own felt lane, never inside their body. */
export function turnIndicatorPosition(pose: SeatPose): readonly [number, number, number] {
  /*
    On the actor's printed bet circle, not around their cards.

    Centred on the felt lane the cue was a 0.34 m ring enclosing the actor's two
    hole cards, and from the seat beside them it filled a fifth of the frame as a
    bright gold donut lying over the table -- unmistakably a piece of interface
    rather than a light. The bet circle is already printed on the felt in front of
    every seat, so lighting that up is a cue the table itself provides.
  */
  const forward = BET_CIRCLE_FORWARD;
  return [
    pose.feltPosition[0] + Math.sin(pose.facing) * forward,
    TABLE_HEIGHT + 0.004,
    pose.feltPosition[2] + Math.cos(pose.facing) * forward,
  ];
}

/**
 * Tournament-style player lane dimensions.  The card rectangle and wager
 * circle are deliberately separate marks: cards remain square to their owner,
 * resting chips can sit beside them, and a committed wager has one unambiguous
 * landing spot toward the middle of the felt.
 */
export const CARD_ZONE_WIDTH = 0.25;
export const CARD_ZONE_DEPTH = 0.16;
/** Distance from a seat's card lane to its printed bet circle; see build_table.py. */
export const BET_CIRCLE_FORWARD = 0.125;
export const BET_CIRCLE_RADIUS = 0.040;

/**
 * Conservative footprint for the deepest rendered chip rack.
 *
 * Eighteen chips can resolve into three short columns.  Reserving 130 mm from
 * the felt edge covers those columns, their edge spots, and the small visual
 * gap a stack needs before the padded rail.  It is intentionally a scene
 * placement value rather than a table-layout value: changing it cannot move a
 * card lane or a betting circle.
 */
export const CHIP_STACK_SAFE_RADIUS = 0.13;

/** Chip racks sit beside the cards, slightly toward their owner. */
export const CHIP_STACK_LOCAL_SIDE_OFFSET = 0.145;
export const CHIP_STACK_LOCAL_OWNER_OFFSET = -0.018;

/** Radius of the physical dealer/blind marker mesh in the renderer. */
export const TABLE_MARKER_RADIUS = 0.028;
/** Visible air between a chip rack and the marker that describes its seat. */
export const TABLE_MARKER_GAP = 0.024;
/** Conservative radius of the rendered rack footprint, excluding the height. */
export const CHIP_STACK_FOOTPRINT_RADIUS = 0.052;

/**
 * Clear table-space gap from the outside edge of a rack to its numeral.
 *
 * The label is deliberately anchored in the owner's local frame rather than
 * nudged in viewport pixels.  This keeps it below the physical rack when the
 * camera changes lens or yaw, while leaving the committed-bet numeral on its
 * own inward betting circle.
 */
export const STACK_AMOUNT_OUTWARD_GAP = 0.085;

/**
 * Project a point into the inset capsule that remains after reserving room for
 * a full chip rack.  The playing surface is a capsule rather than a rectangle;
 * checking only X/Z bounds let corner-seat stacks clip through the curved rail.
 */
function clampToSafeFelt(
  point: readonly [number, number, number],
): readonly [number, number, number] {
  const straightHalfLength = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
  const safeRadius = TABLE_DEPTH / 2 - CHIP_STACK_SAFE_RADIUS;
  const centreX = Math.min(straightHalfLength, Math.max(-straightHalfLength, point[0]));
  const offsetX = point[0] - centreX;
  const offsetZ = point[2];
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= safeRadius || distance === 0) return point;
  const scale = safeRadius / distance;
  return [
    centreX + offsetX * scale,
    point[1],
    offsetZ * scale,
  ] as const;
}

/**
 * Resting stack for one seat, safely inside that same seat's play lane.
 *
 * This uses the owner's local frame so every player has their chips on the
 * same side of their cards. The final capsule clamp protects corner stations
 * from rail overlap without changing any card, bet-circle, or seat-zone anchor.
 */
export function restingChipStackPosition(
  pose: SeatPose,
): readonly [number, number, number] {
  const cardLocal = seatLocalPoint(pose, pose.feltPosition);
  const desired = seatWorldPoint(pose, [
    cardLocal[0] + CHIP_STACK_LOCAL_SIDE_OFFSET,
    TABLE_HEIGHT,
    cardLocal[2] + CHIP_STACK_LOCAL_OWNER_OFFSET,
  ]);
  return clampToSafeFelt(desired);
}

/**
 * Place a dealer/blind marker between its rack and the table centre.
 *
 * The old owner offset was a fixed local-Z nudge that happened to put every
 * puck farther from the centre than its rack. That made the marker read as a
 * second object behind the chips, and made the error more obvious as the
 * camera panned. This derives the direction from the actual rack anchor, so
 * every station uses the same seat-relative radial rule.
 */
export function tableMarkerPosition(
  pose: SeatPose,
): readonly [number, number, number] {
  const stack = restingChipStackPosition(pose);
  const radialLength = Math.hypot(stack[0], stack[2]) || 1;
  const towardCentre = [-stack[0] / radialLength, -stack[2] / radialLength] as const;
  const advance = CHIP_STACK_FOOTPRINT_RADIUS + TABLE_MARKER_GAP + TABLE_MARKER_RADIUS;
  return clampToSafeFelt([
    stack[0] + towardCentre[0] * advance,
    TABLE_HEIGHT + 0.012,
    stack[2] + towardCentre[1] * advance,
  ]);
}

/** World anchor for the exact number that describes a player's remaining rack. */
export function stackAmountPosition(
  pose: SeatPose,
): readonly [number, number, number] {
  const stack = restingChipStackPosition(pose);
  const local = seatLocalPoint(pose, stack);
  return seatWorldPoint(pose, [
    local[0],
    TABLE_HEIGHT + 0.002,
    local[2] - STACK_AMOUNT_OUTWARD_GAP,
  ]);
}

/** World anchor for the exact number that describes chips pushed forward. */
export function committedAmountPosition(
  pose: SeatPose,
): readonly [number, number, number] {
  const bet = betCirclePosition(pose);
  const local = seatLocalPoint(pose, bet);
  return seatWorldPoint(pose, [local[0], TABLE_HEIGHT + 0.006, local[2] - 0.040]);
}

/** Resolve the actor cue by stable player identity, never an array slot. */
export function turnIndicatorPositionForPlayer(
  playerId: string | undefined,
  poseForPlayer: (playerId: string) => SeatPose | undefined,
): readonly [number, number, number] | undefined {
  const pose = playerId === undefined ? undefined : poseForPlayer(playerId);
  return pose ? turnIndicatorPosition(pose) : undefined;
}

/**
 * Project a world point into viewport percentages for the current camera.
 *
 * Pure perspective arithmetic against the same `cameraPose` the renderer uses, so
 * anything the DOM has to align with a physical object tracks it without a
 * per-frame bridge out of three.js.
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
  return {
    xPercent: ((xView / (depth * halfTangent * aspect)) + 1) / 2 * 100,
    yPercent: (1 - yView / (depth * halfTangent)) / 2 * 100,
    behind: false,
  };
}

/** Small visual lift so the stack numeral clears the top chip edge. */
export const SEAT_PLAQUE_LIFT_PERCENT = 0.8;

/**
 * Viewport anchor for a ready-mode stack numeral, or `undefined` for a station
 * behind the camera lens.
 */
export function seatPlaqueViewportAnchor(
  relativeSeat: number,
  cameraPan: number,
  viewportWidth: number,
  viewportHeight: number,
  heroIndex = 0,
  cameraZoom = 0,
  cameraView: SceneCameraView = "standard",
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0) return undefined;
  if (relativeSeat >= PLAYER_STATION_COUNT) return undefined;
  if (viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose) return undefined;
  const projected = projectToViewport(
    stackAmountPosition(pose),
    cameraPose(cameraPan, heroIndex, viewportWidth / viewportHeight, cameraLensZoom(cameraView, cameraZoom)),
    viewportWidth,
    viewportHeight,
  );
  if (projected.behind) return undefined;
  return {
    xPercent: projected.xPercent,
    yPercent: projected.yPercent - SEAT_PLAQUE_LIFT_PERCENT,
  };
}

/** Project the numeric stack amount below the physical denomination columns. */
export function seatStackAmountViewportAnchor(
  relativeSeat: number,
  cameraPan: number,
  viewportWidth: number,
  viewportHeight: number,
  heroIndex = 0,
  cameraZoom = 0,
  cameraView: SceneCameraView = "standard",
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0) return undefined;
  if (relativeSeat >= PLAYER_STATION_COUNT || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose) return undefined;
  const projected = projectToViewport(
    stackAmountPosition(pose),
    cameraPose(cameraPan, heroIndex, viewportWidth / viewportHeight, cameraLensZoom(cameraView, cameraZoom)),
    viewportWidth,
    viewportHeight,
  );
  return projected.behind ? undefined : { xPercent: projected.xPercent, yPercent: projected.yPercent };
}

/** Viewport anchor for a committed-bet numeral, using the same camera as the scene. */
export function seatBetViewportAnchor(
  relativeSeat: number,
  cameraPan: number,
  viewportWidth: number,
  viewportHeight: number,
  heroIndex = 0,
  cameraZoom = 0,
  cameraView: SceneCameraView = "standard",
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0) return undefined;
  if (relativeSeat >= PLAYER_STATION_COUNT) return undefined;
  if (viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose) return undefined;
  const projected = projectToViewport(
    committedAmountPosition(pose),
    cameraPose(cameraPan, heroIndex, viewportWidth / viewportHeight, cameraLensZoom(cameraView, cameraZoom)),
    viewportWidth,
    viewportHeight,
  );
  if (projected.behind) return undefined;
  return { xPercent: projected.xPercent, yPercent: projected.yPercent };
}

/** Camera-frame variants used while the renderer is easing toward a new view. */
export function seatStackAmountViewportAnchorFromCamera(
  relativeSeat: number,
  viewportWidth: number,
  viewportHeight: number,
  heroIndex: number,
  activeCamera: ReturnType<typeof cameraPose>,
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0 || relativeSeat >= PLAYER_STATION_COUNT) {
    return undefined;
  }
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const projected = projectToViewport(stackAmountPosition(pose), activeCamera, viewportWidth, viewportHeight);
  return projected.behind ? undefined : { xPercent: projected.xPercent, yPercent: projected.yPercent };
}

export function seatBetViewportAnchorFromCamera(
  relativeSeat: number,
  viewportWidth: number,
  viewportHeight: number,
  heroIndex: number,
  activeCamera: ReturnType<typeof cameraPose>,
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0 || relativeSeat >= PLAYER_STATION_COUNT) {
    return undefined;
  }
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const projected = projectToViewport(committedAmountPosition(pose), activeCamera, viewportWidth, viewportHeight);
  return projected.behind ? undefined : { xPercent: projected.xPercent, yPercent: projected.yPercent };
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
 * Clockwise two-pass hole-card choreography. The public event is one queue item,
 * but each physical card gets its own handoff window: first card to every
 * recipient, then the second card to every recipient. Overlap is intentional so
 * the dealer never has to teleport a card between pitches.
 */
export function holeCardDealProgress(
  progress: number,
  recipientIndex: number,
  cardIndex: number,
  recipientCount: number,
): number {
  const total = Math.max(1, Math.floor(recipientCount) * 2);
  const order = Math.max(0, Math.min(total - 1,
    Math.floor(cardIndex) * Math.max(1, Math.floor(recipientCount)) + Math.floor(recipientIndex)));
  const start = (order / total) * 0.72;
  const duration = 0.28;
  return Math.min(1, Math.max(0, (progress - start) / duration));
}

/**
 * The printed bet circle a wager rests on, in table space.
 *
 * A wager belongs in front of the player who made it until the street closes
 * and the dealer sweeps it. Everything here used to push straight to the middle
 * of the felt, and an idle seat with a live bet drew its chips at `progress` 1
 * -- so every wager teleported into a heap at the centre the moment it was
 * made, and the six bet circles printed on the felt were never once used.
 */
export function betCirclePosition(pose: SeatPose): readonly [number, number, number] {
  return [
    pose.feltPosition[0] + Math.sin(pose.facing) * BET_CIRCLE_FORWARD,
    TABLE_HEIGHT,
    pose.feltPosition[2] + Math.cos(pose.facing) * BET_CIRCLE_FORWARD,
  ];
}

/** The pot: the middle of the felt, a little toward the hero. */
export const POT_POSITION: readonly [number, number, number] = [0, TABLE_HEIGHT, TABLE_ANCHORS.mainPot[2]];

/**
 * Where a bet's chips are at `progress`, travelling from the seat's felt spot
 * out to its own bet circle.
 */
export function betChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.06);
}

/**
 * A call is the same push with a flatter arc: a smaller, more routine motion
 * than an opening bet. The two must stay tellable apart while sharing a
 * terminal position, so reduced motion and the next authoritative snapshot
 * agree exactly.
 */
export function callChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.035);
}

/**
 * A raise gathers chips back toward the player first, then pushes the larger
 * pile out to the betting line -- a different midpoint from both a call and an
 * opening bet, with the same end state.
 */
export function raiseChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  const circle = betCirclePosition(pose);
  if (t === 1) return circle;
  /*
    Gathered back toward the player, not scaled toward the table centre.

    Scaling the felt anchor was fine when a wager travelled half a metre to the
    pot -- there was room for two trajectories to differ. The push is now the
    82 mm from the lane to the betting line, and over that distance a scaled
    gather is a rounding error: the raise and the call became the same motion.
    Pulling the chips back behind the lane first is what a raise looks like
    anyway, and it stays legible however short the push is.
  */
  const gather: readonly [number, number, number] = [
    x - Math.sin(pose.facing) * 0.045,
    y,
    z - Math.cos(pose.facing) * 0.045,
  ];
  const segment = t < 0.34 ? t / 0.34 : (t - 0.34) / 0.66;
  const from = t < 0.34 ? pose.feltPosition : gather;
  const to = t < 0.34 ? gather : circle;
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

/**
 * The dealer's sweep: bet circle to pot. The only motion that puts a player's
 * chips in the middle of the table, and it is the dealer doing it.
 */
export function collectChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const from = betCirclePosition(pose);
  const lift = Math.sin(Math.PI * t) * 0.05;
  return [
    from[0] + (POT_POSITION[0] - from[0]) * t,
    from[1] + lift,
    from[2] + (POT_POSITION[2] - from[2]) * t,
  ];
}

/** The inverse of a dealer sweep: a physical pot travels to the winner's rack. */
export function awardChipPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const from = POT_POSITION;
  const to = restingChipStackPosition(pose);
  const lift = Math.sin(Math.PI * t) * 0.065;
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + lift,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function chipPositionAlongPush(
  pose: SeatPose,
  progress: number,
  maxLift: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = pose.feltPosition;
  const circle = betCirclePosition(pose);
  if (t === 1) return circle;
  const lift = Math.sin(Math.PI * t) * maxLift;
  return [x + (circle[0] - x) * t, y + lift, z + (circle[2] - z) * t];
}
/**
 * Where a dealt card is at `progress`, travelling from the dealer's hands to a
 * seat's felt spot.
 */
export function dealtCardPosition(
  pose: SeatPose,
  progress: number,
): readonly [number, number, number] {
  const action = actionEase(progress);
  /*
    Leave the card on the dealer's shoe during the pickup.  Its outward travel
    starts after the dealer's hand has reached the pack, which makes each deal
    read as a throw/slide rather than a card spawning into a long arc.
  */
  const pickup = 0.18;
  const t = action <= pickup ? 0 : actionEase((action - pickup) / (1 - pickup));
  // The first beat is at the shoe; once the dealer has visibly picked it up,
  // the flight starts at their throwing hand.  This preserves the physical
  // cause-and-effect chain: shoe -> hand -> receiving lane.
  const from = TABLE_ANCHORS.dealerThrow;
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
  // Keep the fold destination on the same dealer-side muck anchor used by the
  // visible muck pile. The old mirrored X coordinate sent cards away from the
  // dealer and made the collector gesture physically meaningless.
  const muck: readonly [number, number, number] = [
    TABLE_ANCHORS.muck[0],
    TABLE_HEIGHT,
    TABLE_ANCHORS.muck[2],
  ];
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
  return chipInventoryForAmount(amount).length;
}

/**
 * A visible rack is made from real tournament denominations, never a
 * colour-picked approximation.  The renderer may elect not to draw every
 * physical chip in a very deep stack, but this list is an exact decomposition
 * of the displayed amount, so a wager cannot turn a pair of green chips into a
 * new column of unrelated purple ones.
 */
/** Public rack order is low-to-high, while the greedy decomposition is high-to-low. */
export const TOURNAMENT_CHIP_DENOMINATIONS = [25, 100, 500, 1_000, 5_000, 25_000, 100_000] as const;

export function chipInventoryForAmount(amount: number): readonly number[] {
  let remainder = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  const inventory: number[] = [];
  for (const denomination of [...TOURNAMENT_CHIP_DENOMINATIONS].reverse()) {
    const count = Math.floor(remainder / denomination);
    for (let index = 0; index < count; index += 1) inventory.push(denomination);
    remainder -= count * denomination;
  }
  // Tournament stacks are multiples of 25. Keep the helper exact for legacy
  // training fixtures and diagnostics without pretending the remainder is a
  // standard tournament chip; valid tournament values never take this path.
  if (remainder > 0) inventory.push(remainder);
  return inventory.sort((left, right) => left - right);
}

export interface ChipColumnLayout {
  readonly denomination: number;
  readonly count: number;
  readonly column: number;
}

/**
 * The physical rack contract: denominations are adjacent and low-to-high;
 * every column contains one denomination and never exceeds twenty chips.
 */
export function chipColumnLayoutForAmount(
  amount: number,
  chipsPerColumn = 20,
): readonly ChipColumnLayout[] {
  if (!Number.isFinite(chipsPerColumn) || chipsPerColumn < 1) return [];
  const inventory = chipInventoryForAmount(amount);
  const groups = new Map<number, number>();
  for (const denomination of inventory) groups.set(denomination, (groups.get(denomination) ?? 0) + 1);
  const result: ChipColumnLayout[] = [];
  let column = 0;
  for (const [denomination, count] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    let remaining = count;
    while (remaining > 0) {
      const size = Math.min(chipsPerColumn, remaining);
      result.push({ denomination, count: size, column });
      remaining -= size;
      column += 1;
    }
  }
  return result;
}
