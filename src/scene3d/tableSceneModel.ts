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

// The authored six-station ring is immutable. Reusing these pure snapshots is
// important because Training exercises the solver for every stack amount and
// seat, and candidate evaluation must not rebuild the ring thousands of times.
const AUTHORED_PLAYER_STATIONS = playerStations();
const AUTHORED_STATION_POSES = AUTHORED_PLAYER_STATIONS.map((station, index) =>
  stationAsPose(station, index)
);

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

/** The actor cue sits on that player's internal wager anchor, never inside their body. */
export function turnIndicatorPosition(pose: SeatPose): readonly [number, number, number] {
  /*
    On the actor's wager anchor, not around their cards.

    Centred on the felt lane the cue was a 0.34 m ring enclosing the actor's two
    hole cards, and from the seat beside them it filled a fifth of the frame as a
    bright gold donut lying over the table -- unmistakably a piece of interface
    rather than a light. The wager zone is deliberately invisible, but its centre
    remains the one shared location for the cue, chips, collision, and projected
    interaction endpoints.
  */
  const wager = betCirclePosition(pose);
  return [wager[0], TABLE_HEIGHT + 0.004, wager[2]];
}

/**
 * Tournament-style player lane dimensions.  The card rectangle and wager
 * circle are deliberately separate marks: cards remain square to their owner,
 * resting chips can sit beside them, and a committed wager has one unambiguous
 * landing spot toward the middle of the felt.
 */
// These are the protected private-card bounds formerly carried by the visible
// play-zone mesh. They now exist only in this model, where placement and
// collision can protect the asymmetric card lane without rendering it.
export const CARD_ZONE_WIDTH = 0.256;
export const CARD_ZONE_LOCAL_MIN_Z = -0.083;
export const CARD_ZONE_LOCAL_MAX_Z = 0.170;
export const CARD_ZONE_DEPTH = CARD_ZONE_LOCAL_MAX_Z - CARD_ZONE_LOCAL_MIN_Z;
export const CARD_ZONE_LOCAL_CENTER_Z = (CARD_ZONE_LOCAL_MIN_Z + CARD_ZONE_LOCAL_MAX_Z) / 2;
/** Radius of the invisible wager placement/collision zone. */
export const BET_CIRCLE_RADIUS = 0.040;
/** Visible felt between the protected card rectangle and every other object. */
export const CARD_ZONE_OBJECT_GAP = 0.020;
/**
 * Previous wager anchor, retained as migration evidence for the exact requested
 * ownerward delta. It is geometry metadata only and is never rendered.
 */
export const PREVIOUS_BET_CIRCLE_FORWARD = 0.25;
/**
 * The owner-side wager anchor moves halfway from the former centre toward
 * the far/inward edge of that owner's private-card zone.
 */
export const WAGER_OWNERWARD_LOCAL_DELTA = (
  CARD_ZONE_LOCAL_MAX_Z - PREVIOUS_BET_CIRCLE_FORWARD
) / 2;
export const BET_CIRCLE_FORWARD = PREVIOUS_BET_CIRCLE_FORWARD
  + WAGER_OWNERWARD_LOCAL_DELTA;

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

/**
 * Rack depth bias toward its owner.  The approved casino layout keeps the rack
 * in the rail-side row, with the hole cards just inside it and the bet deepest
 * toward the pot.
 */
export const CHIP_STACK_LOCAL_OWNER_OFFSET = -0.070;

/** Shared physical rack dimensions used by both placement and rendering. */
export const CHIPS_PER_COLUMN = 8;
export const CHIP_COLUMN_PITCH = 0.052;
export const CHIP_PHYSICAL_RADIUS = 0.035;
export const CHIP_RACK_COLUMNS_PER_ROW = 3;
/** Shared vertical pitch for both rack chips and the compact wager pile. */
export const CHIP_VERTICAL_PITCH = 0.0045;

/**
 * A committed wager is one compact vertical pile at the invisible zone centre.
 * Keeping all planar offsets at zero guarantees every physical chip remains
 * inside the 40 mm placement/collision zone; denomination-pure spreading is a
 * rack concern and must not leak into the wager lane beside the private cards.
 */
export function wagerChipStackOffset(
  height: number,
): readonly [number, number, number] {
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return [0, safeHeight * CHIP_VERTICAL_PITCH, 0];
}

/** Radius of the physical dealer/blind marker mesh in the renderer. */
export const TABLE_MARKER_RADIUS = 0.028;
/** Visible air between a chip rack and the marker that describes its seat. */
export const TABLE_MARKER_GAP = 0.024;
/** Centre-to-centre spacing for the two physical button slots in one player lane. */
export const TABLE_MARKER_SLOT_OFFSET = 0.065;
/** Conservative radius of the rendered rack footprint, excluding the height. */
export const CHIP_STACK_FOOTPRINT_RADIUS = 0.105;

/** The renderer's station frame has +Z inward; +X is the player's left. */
export const CHIP_STACK_LOCAL_LEFT_SIDE: 1 = 1;

/**
 * Clear table-space gap from the outside edge of a rack to its numeral.
 *
 * The label is deliberately anchored in the owner's local frame rather than
 * nudged in viewport pixels.  This keeps it below the physical rack when the
 * camera changes lens or yaw, while leaving the committed-bet numeral on its
 * own inward betting circle.
 */
export const STACK_AMOUNT_OUTWARD_GAP = 0.014;
/** Physical footprint reserved for the projected stack amount label. */
export const STACK_LABEL_HALF_WIDTH = 0.05;
export const STACK_LABEL_HALF_DEPTH = 0.012;

export interface SeatOccupancyLayout {
  readonly rackOrigin: readonly [number, number, number];
  readonly rackSide: -1 | 0 | 1;
  readonly markerBase: readonly [number, number, number];
  readonly wager: readonly [number, number, number];
  readonly stackLabel: readonly [number, number, number];
  readonly rackBounds: ReturnType<typeof chipRackLayoutBounds>;
}

/** A centred local coordinate for one denomination-pure rack column. */
export function chipRackColumnPosition(
  column: number,
  totalColumns: number,
): readonly [number, number] {
  const safeTotal = Math.max(1, Math.floor(totalColumns));
  const safeColumn = Math.max(0, Math.min(safeTotal - 1, Math.floor(column)));
  const columnsWide = Math.min(CHIP_RACK_COLUMNS_PER_ROW, safeTotal);
  const rowsDeep = Math.ceil(safeTotal / CHIP_RACK_COLUMNS_PER_ROW);
  return [
    (safeColumn % CHIP_RACK_COLUMNS_PER_ROW - (columnsWide - 1) / 2) * CHIP_COLUMN_PITCH,
    (Math.floor(safeColumn / CHIP_RACK_COLUMNS_PER_ROW) - (rowsDeep - 1) / 2) * CHIP_COLUMN_PITCH,
  ];
}

/** Actual local footprint for a denomination-grouped rack. */
export function chipRackLayoutBounds(amount: number): {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
} {
  const columns = chipColumnLayoutForAmount(amount, CHIPS_PER_COLUMN);
  if (columns.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const points = columns.map((column) => chipRackColumnPosition(column.column, columns.length));
  return {
    minX: Math.min(...points.map(([x]) => x)) - CHIP_PHYSICAL_RADIUS,
    maxX: Math.max(...points.map(([x]) => x)) + CHIP_PHYSICAL_RADIUS,
    minZ: Math.min(...points.map(([, z]) => z)) - CHIP_PHYSICAL_RADIUS,
    maxZ: Math.max(...points.map(([, z]) => z)) + CHIP_PHYSICAL_RADIUS,
  };
}

/**
 * Project a point into the inset capsule that remains after reserving room for
 * a full chip rack.  The playing surface is a capsule rather than a rectangle;
 * checking only X/Z bounds let corner-seat stacks clip through the curved rail.
 */
function clampToSafeFelt(
  point: readonly [number, number, number],
  footprintRadius = CHIP_STACK_SAFE_RADIUS,
): readonly [number, number, number] {
  const straightHalfLength = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
  const safeRadius = TABLE_DEPTH / 2 - footprintRadius;
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

function capsuleDistance(point: readonly [number, number, number]): number {
  const straightHalfLength = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
  const centreX = Math.min(straightHalfLength, Math.max(-straightHalfLength, point[0]));
  return Math.hypot(point[0] - centreX, point[2]);
}

function orientedRackFits(
  pose: SeatPose,
  originLocal: readonly [number, number, number],
  bounds: ReturnType<typeof chipRackLayoutBounds>,
): boolean {
  const insetRadius = TABLE_DEPTH / 2 - 0.008;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      const corner = seatWorldPoint(pose, [originLocal[0] + x, TABLE_HEIGHT, originLocal[2] + z]);
      if (capsuleDistance(corner) > insetRadius) return false;
    }
  }
  return true;
}

function pointInStationFrame(
  station: ReturnType<typeof playerStations>[number],
  world: readonly [number, number, number],
): readonly [number, number] {
  const dx = world[0] - station.position[0];
  const dz = world[2] - station.position[2];
  const cos = Math.cos(station.facing);
  const sin = Math.sin(station.facing);
  return [dx * cos - dz * sin, dx * sin + dz * cos] as const;
}

function stationCardRect(station: ReturnType<typeof playerStations>[number], gap = 0) {
  const origin = pointInStationFrame(station, station.feltPosition);
  return {
    minX: origin[0] - CARD_ZONE_WIDTH / 2 - gap,
    maxX: origin[0] + CARD_ZONE_WIDTH / 2 + gap,
    minZ: origin[1] + CARD_ZONE_LOCAL_MIN_Z - gap,
    maxZ: origin[1] + CARD_ZONE_LOCAL_MAX_Z + gap,
  };
}

type OccupancyRect = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

function rectsDisjoint(left: OccupancyRect, right: OccupancyRect): boolean {
  return left.maxX <= right.minX || left.minX >= right.maxX
    || left.maxZ <= right.minZ || left.minZ >= right.maxZ;
}

function localRectCorners(
  centreX: number,
  centreZ: number,
  bounds: OccupancyRect,
): readonly (readonly [number, number])[] {
  return [
    [centreX + bounds.minX, centreZ + bounds.minZ],
    [centreX + bounds.maxX, centreZ + bounds.minZ],
    [centreX + bounds.maxX, centreZ + bounds.maxZ],
    [centreX + bounds.minX, centreZ + bounds.maxZ],
  ];
}

function worldRectCorners(
  pose: SeatPose,
  centreX: number,
  centreZ: number,
  bounds: OccupancyRect,
): readonly (readonly [number, number, number])[] {
  return localRectCorners(centreX, centreZ, bounds)
    .map(([x, z]) => seatWorldPoint(pose, [x, TABLE_HEIGHT, z]));
}

function worldRectInStationFrame(
  station: ReturnType<typeof playerStations>[number],
  corners: readonly (readonly [number, number, number])[],
): OccupancyRect {
  const points = corners.map((corner) => pointInStationFrame(station, corner));
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z)),
  };
}

function circleClearsRect(
  circle: readonly [number, number],
  radius: number,
  rect: OccupancyRect,
  gap = 0,
): boolean {
  const x = Math.max(rect.minX, Math.min(rect.maxX, circle[0]));
  const z = Math.max(rect.minZ, Math.min(rect.maxZ, circle[1]));
  return Math.hypot(circle[0] - x, circle[1] - z) >= radius + gap;
}

type PlanarPoint = readonly [number, number];

function planarCorners(
  corners: readonly (readonly [number, number, number])[],
): readonly PlanarPoint[] {
  return corners.map(([x, , z]) => [x, z] as const);
}

function polygonAxes(polygon: readonly PlanarPoint[]): readonly PlanarPoint[] {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const edgeX = next[0] - point[0];
    const edgeZ = next[1] - point[1];
    return [-edgeZ, edgeX] as const;
  });
}

/** Exact overlap test for the oriented rectangles around rotated stations. */
function polygonsOverlap(left: readonly PlanarPoint[], right: readonly PlanarPoint[]): boolean {
  for (const [axisX, axisZ] of [...polygonAxes(left), ...polygonAxes(right)]) {
    const leftProjection = left.map(([x, z]) => x * axisX + z * axisZ);
    const rightProjection = right.map(([x, z]) => x * axisX + z * axisZ);
    if (Math.max(...leftProjection) <= Math.min(...rightProjection)
      || Math.max(...rightProjection) <= Math.min(...leftProjection)) {
      return false;
    }
  }
  return true;
}

function distanceToSegment(
  point: PlanarPoint,
  start: PlanarPoint,
  end: PlanarPoint,
): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (
      (point[0] - start[0]) * dx + (point[1] - start[1]) * dz
    ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + progress * dx),
    point[1] - (start[1] + progress * dz),
  );
}

function pointInsidePolygon(
  point: PlanarPoint,
  polygon: readonly PlanarPoint[],
): boolean {
  const signs = polygon.map((vertex, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return (next[0] - vertex[0]) * (point[1] - vertex[1])
      - (next[1] - vertex[1]) * (point[0] - vertex[0]);
  });
  return signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0);
}

function circleOverlapsPolygon(
  centre: PlanarPoint,
  radius: number,
  polygon: readonly PlanarPoint[],
): boolean {
  if (pointInsidePolygon(centre, polygon)) return true;
  return polygon.some((point, index) => (
    distanceToSegment(centre, point, polygon[(index + 1) % polygon.length]) < radius
  ));
}

let authoredWagerCircles: readonly {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
}[] | undefined;

function protectedWagerCircles(): readonly {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
}[] {
  authoredWagerCircles ??= AUTHORED_STATION_POSES.map((pose) => ({
    centre: betCirclePosition(pose),
    radius: BET_CIRCLE_RADIUS,
  }));
  return authoredWagerCircles;
}

function markerPocketCentres(
  pose: SeatPose,
  rackOrigin: readonly [number, number, number],
  bounds: ReturnType<typeof chipRackLayoutBounds>,
  markerSide: -1 | 1,
): readonly (readonly [number, number, number])[] {
  const rackCentreX = rackOrigin[0] + (bounds.minX + bounds.maxX) / 2;
  const rackCentreZ = rackOrigin[2] + (bounds.minZ + bounds.maxZ) / 2;
  const rackHalfX = Math.max(
    CHIP_PHYSICAL_RADIUS,
    (bounds.maxX - bounds.minX) / 2,
  );
  const markerX = rackCentreX + markerSide * (
    rackHalfX + TABLE_MARKER_GAP + TABLE_MARKER_RADIUS
  );
  return [0, TABLE_MARKER_SLOT_OFFSET].map((slotOffset) => seatWorldPoint(pose, [
    markerX + markerSide * slotOffset,
    TABLE_HEIGHT + 0.012,
    rackCentreZ,
  ]));
}

function protectedMarkerCircles(
  pose: SeatPose,
  rackOrigin: readonly [number, number, number],
  bounds: ReturnType<typeof chipRackLayoutBounds>,
  markerSide: -1 | 1,
): readonly {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
}[] {
  return markerPocketCentres(pose, rackOrigin, bounds, markerSide).map((centre) => ({
    centre,
    radius: TABLE_MARKER_RADIUS,
  }));
}

type SeatOccupancyCandidate = {
  readonly side: -1 | 0 | 1;
  readonly origin: readonly [number, number, number];
  readonly labelCentre: readonly [number, number];
  readonly markerSide: -1 | 1;
  readonly preferred: boolean;
  readonly fits: boolean;
  readonly rackCorners: readonly PlanarPoint[];
  readonly labelCorners: readonly PlanarPoint[];
  readonly markerCircles: readonly {
    readonly centre: readonly [number, number, number];
    readonly radius: number;
  }[];
};

type SeatOccupancyCandidateSet = {
  readonly bounds: ReturnType<typeof chipRackLayoutBounds>;
  readonly candidates: readonly SeatOccupancyCandidate[];
};

function rackClearsAllCardZones(
  pose: SeatPose,
  origin: readonly [number, number, number],
  bounds: ReturnType<typeof chipRackLayoutBounds>,
  labelCentre: readonly [number, number],
): boolean {
  const rackCorners = worldRectCorners(
    pose,
    origin[0] + (bounds.minX + bounds.maxX) / 2,
    origin[2] + (bounds.minZ + bounds.maxZ) / 2,
    bounds,
  );
  const labelCorners = worldRectCorners(
    pose,
    labelCentre[0],
    labelCentre[1],
    {
      minX: -STACK_LABEL_HALF_WIDTH,
      maxX: STACK_LABEL_HALF_WIDTH,
      minZ: -STACK_LABEL_HALF_DEPTH,
      maxZ: STACK_LABEL_HALF_DEPTH,
    },
  );
  return AUTHORED_PLAYER_STATIONS.every((station) => {
    const rackRect = worldRectInStationFrame(station, rackCorners);
    const labelRect = worldRectInStationFrame(station, labelCorners);
    const card = stationCardRect(station, CARD_ZONE_OBJECT_GAP);
    return rectsDisjoint(rackRect, card) && rectsDisjoint(labelRect, card);
  });
}

/**
 * One collision-aware owner lane for every live object around a seat.
 *
 * The protected card rectangle is immutable. The rack is positioned from its
 * actual denomination-column bounds plus a physical gap, then tried on both
 * owner-relative sides. This is deliberately solved after the final table
 * transform: a centre-only capsule clamp can keep an anchor on the felt while
 * its outer chip columns still cross the card rectangle or rail.
 */
function seatOccupancyCandidateSet(
  pose: SeatPose,
  amount = 15_000,
): SeatOccupancyCandidateSet {
  const cardOrigin = seatLocalPoint(pose, pose.feltPosition);
  const card = [
    cardOrigin[0],
    cardOrigin[1],
    cardOrigin[2] + CARD_ZONE_LOCAL_CENTER_Z,
  ] as const;
  const bounds = chipRackLayoutBounds(amount);
  const rackCentreX = (bounds.minX + bounds.maxX) / 2;
  const rackCentreZ = (bounds.minZ + bounds.maxZ) / 2;
  const rackHalfX = Math.max(CHIP_PHYSICAL_RADIUS, (bounds.maxX - bounds.minX) / 2);
  const rackHalfZ = Math.max(CHIP_PHYSICAL_RADIUS, (bounds.maxZ - bounds.minZ) / 2);
  // The number sits outside the rack and is wider than a one- or two-column
  // rack. Reserve that real footprint before solving the rack, otherwise a
  // geometrically safe pile can still put its projected amount over a card or
  // an adjacent station.
  const lateralHalfWidth = Math.max(rackHalfX, STACK_LABEL_HALF_WIDTH);
  const ownerDepth = CARD_ZONE_DEPTH / 2 + CARD_ZONE_OBJECT_GAP + Math.max(
    rackHalfZ,
    STACK_LABEL_HALF_DEPTH,
  );
  const lateral = CARD_ZONE_WIDTH / 2 + CARD_ZONE_OBJECT_GAP + lateralHalfWidth;
  const playerLeft = CHIP_STACK_LOCAL_LEFT_SIDE;
  const slotCandidates: Array<{
    side: -1 | 0 | 1;
    desiredCentreX: number;
    desiredCentreZ: number;
    markerSide: -1 | 1;
    preferred: boolean;
  }> = [
    // Semantic owner slot first. A rack belongs rail-side and to the player's
    // left of the hole cards; depth-only and opposite-side slots are
    // collision fallbacks, never the preferred placement.
    {
      side: playerLeft,
      desiredCentreX: card[0] + playerLeft * lateral,
      desiredCentreZ: card[2] + CHIP_STACK_LOCAL_OWNER_OFFSET,
      markerSide: playerLeft,
      preferred: true,
    },
    {
      side: playerLeft,
      desiredCentreX: card[0] + playerLeft * lateral,
      desiredCentreZ: card[2] - ownerDepth,
      markerSide: playerLeft,
      preferred: true,
    },
    ...[0.018, 0.036, 0.054].map((extraLateral) => ({
      side: playerLeft,
      desiredCentreX: card[0] + playerLeft * (lateral + extraLateral),
      desiredCentreZ: card[2] + CHIP_STACK_LOCAL_OWNER_OFFSET,
      markerSide: playerLeft,
      preferred: true,
    })),
    ...[0.018, 0.036, 0.054].map((extraLateral) => ({
      side: playerLeft,
      desiredCentreX: card[0] + playerLeft * (lateral + extraLateral),
      desiredCentreZ: card[2] - ownerDepth,
      markerSide: playerLeft,
      preferred: true,
    })),
    // Preserve the old rear lane as a safe fallback for curved seats.
    { side: 0 as const, desiredCentreX: card[0], desiredCentreZ: card[2] - ownerDepth, markerSide: playerLeft, preferred: false },
    { side: -playerLeft as -1 | 1, desiredCentreX: card[0] - playerLeft * lateral, desiredCentreZ: card[2] + CHIP_STACK_LOCAL_OWNER_OFFSET, markerSide: -playerLeft as -1 | 1, preferred: false },
    { side: -playerLeft as -1 | 1, desiredCentreX: card[0] - playerLeft * lateral, desiredCentreZ: card[2] - ownerDepth, markerSide: -playerLeft as -1 | 1, preferred: false },
    ...[0.018, 0.036, 0.054].map((extraLateral) => ({
      side: -playerLeft as -1 | 1,
      desiredCentreX: card[0] - playerLeft * (lateral + extraLateral),
      desiredCentreZ: card[2] + CHIP_STACK_LOCAL_OWNER_OFFSET,
      markerSide: -playerLeft as -1 | 1,
      preferred: false,
    })),
    ...[0.018, 0.036, 0.054].map((extraLateral) => ({
      side: -playerLeft as -1 | 1,
      desiredCentreX: card[0] - playerLeft * (lateral + extraLateral),
      desiredCentreZ: card[2] - ownerDepth,
      markerSide: -playerLeft as -1 | 1,
      preferred: false,
    })),
    // An inward slot is deliberately last among authored placements. It keeps
    // the collision solver useful at the tight end seats without recreating the
    // screenshot regression where stacks read as a second row of bets.
    { side: 0 as const, desiredCentreX: card[0], desiredCentreZ: card[2] + ownerDepth, markerSide: playerLeft, preferred: false },
  ];
  // Curved end seats have less room than side seats, and high-value stacks can
  // change the rack's aspect ratio. Search a deterministic seat-local grid
  // after the preferred owner slots so final, post-clamp bounds—not a magic
  // offset—choose the first physically valid alternate.
  for (const dz of [-0.28, -0.22, -0.16, -0.10, -0.06, 0, 0.10, 0.16, 0.22, 0.28]) {
    for (const dx of [-0.18, 0.18, -0.24, 0.24, -0.30, 0.30, -0.36, 0.36]) {
      const side = (dx < 0 ? -1 : 1) as -1 | 1;
      slotCandidates.push({
        side,
        desiredCentreX: card[0] + dx,
        desiredCentreZ: card[2] + dz,
        markerSide: side,
        preferred: side === playerLeft && dz < 0,
      });
    }
  }
  const candidates = slotCandidates.map(({ side, desiredCentreX, desiredCentreZ, markerSide, preferred }) => {
    const origin = [
      desiredCentreX - rackCentreX,
      TABLE_HEIGHT,
      desiredCentreZ - rackCentreZ,
    ] as const;
    const labelCentre = [
      desiredCentreX,
      desiredCentreZ - rackCentreZ + bounds.minZ - STACK_AMOUNT_OUTWARD_GAP,
    ] as const;
    const rackRect = {
      minX: desiredCentreX + bounds.minX,
      maxX: desiredCentreX + bounds.maxX,
      minZ: desiredCentreZ + bounds.minZ,
      maxZ: desiredCentreZ + bounds.maxZ,
    };
    const labelRect = {
      minX: labelCentre[0] - STACK_LABEL_HALF_WIDTH,
      maxX: labelCentre[0] + STACK_LABEL_HALF_WIDTH,
      minZ: labelCentre[1] - STACK_LABEL_HALF_DEPTH,
      maxZ: labelCentre[1] + STACK_LABEL_HALF_DEPTH,
    };
    const markerCentres = protectedMarkerCircles(pose, origin, bounds, markerSide);
    const allWagersClear = protectedWagerCircles().every(({ centre, radius }) => {
      const localPoint = seatLocalPoint(pose, centre);
      const local: readonly [number, number] = [localPoint[0], localPoint[2]];
      return circleClearsRect(
        local,
        radius,
        rackRect,
        CARD_ZONE_OBJECT_GAP,
      ) && circleClearsRect(
        local,
        radius,
        labelRect,
        CARD_ZONE_OBJECT_GAP,
      );
    });
    const markerClear = markerCentres.every(({ centre, radius }) => {
      const localPoint = seatLocalPoint(pose, centre);
      const local: readonly [number, number] = [localPoint[0], localPoint[2]];
      const cardsClear = AUTHORED_PLAYER_STATIONS.every((station) => {
        const stationPoint = pointInStationFrame(station, centre);
        return circleClearsRect(
          stationPoint,
          radius,
          stationCardRect(station, CARD_ZONE_OBJECT_GAP),
        );
      });
      const wagersClear = protectedWagerCircles().every(({ centre: wager, radius: wagerRadius }) => {
        const wagerPoint = seatLocalPoint(pose, wager);
        return Math.hypot(local[0] - wagerPoint[0], local[1] - wagerPoint[2])
          >= radius + wagerRadius + CARD_ZONE_OBJECT_GAP;
      });
      return cardsClear
        && wagersClear
        && circleClearsRect(local, radius, rackRect, CARD_ZONE_OBJECT_GAP)
        && circleClearsRect(local, radius, labelRect, CARD_ZONE_OBJECT_GAP);
    });
    const rackFits = orientedRackFits(pose, origin, bounds);
    const cardsFit = rackClearsAllCardZones(pose, origin, bounds, labelCentre);
    return {
      side,
      origin,
      labelCentre,
      markerSide,
      preferred,
      fits: rackFits
        && cardsFit
        && allWagersClear
        && markerClear,
      rackCorners: planarCorners(worldRectCorners(
        pose,
        desiredCentreX,
        desiredCentreZ,
        bounds,
      )),
      labelCorners: planarCorners(worldRectCorners(
        pose,
        labelCentre[0],
        labelCentre[1],
        {
          minX: -STACK_LABEL_HALF_WIDTH,
          maxX: STACK_LABEL_HALF_WIDTH,
          minZ: -STACK_LABEL_HALF_DEPTH,
          maxZ: STACK_LABEL_HALF_DEPTH,
        },
      )),
      markerCircles: markerCentres,
    };
  });
  return { bounds, candidates };
}

function seatOccupancyLayoutFromCandidate(
  pose: SeatPose,
  bounds: ReturnType<typeof chipRackLayoutBounds>,
  card: readonly [number, number, number],
  selected: SeatOccupancyCandidate,
): SeatOccupancyLayout {
  const rackOrigin = seatWorldPoint(pose, selected.origin);
  const markerBase = selected.markerCircles[0]?.centre ?? rackOrigin;
  const stackLabel = seatWorldPoint(pose, [
    selected.labelCentre[0],
    TABLE_HEIGHT + 0.002,
    selected.labelCentre[1],
  ]);
  return {
    rackOrigin,
    rackSide: selected.side,
    markerBase,
    wager: betCirclePosition(pose),
    stackLabel,
    rackBounds: bounds,
  };
}

function seatOccupancyFallback(
  pose: SeatPose,
  candidateSet: SeatOccupancyCandidateSet,
): SeatOccupancyCandidate {
  return candidateSet.candidates
    .filter((candidate) => candidate.fits)
    .sort((left, right) => {
      const clearance = (candidate: SeatOccupancyCandidate) => {
        const centre = seatWorldPoint(pose, candidate.origin);
        return TABLE_DEPTH / 2 - capsuleDistance(centre);
      };
      return clearance(right) - clearance(left);
    })[0] ?? candidateSet.candidates[0];
}

function seatOccupancyLayoutSingle(
  pose: SeatPose,
  amount: number,
): SeatOccupancyLayout {
  const cardOrigin = seatLocalPoint(pose, pose.feltPosition);
  const card = [
    cardOrigin[0],
    cardOrigin[1],
    cardOrigin[2] + CARD_ZONE_LOCAL_CENTER_Z,
  ] as const;
  const candidateSet = seatOccupancyCandidateSet(pose, amount);
  const selected = candidateSet.candidates.find((candidate) => candidate.fits)
    ?? seatOccupancyFallback(pose, candidateSet);
  return seatOccupancyLayoutFromCandidate(pose, candidateSet.bounds, card, selected);
}

function occupancyCandidatesClear(
  left: SeatOccupancyCandidate,
  right: SeatOccupancyCandidate,
): boolean {
  const leftPolygons = [left.rackCorners, left.labelCorners];
  const rightPolygons = [right.rackCorners, right.labelCorners];
  const rectangularObjectsClear = leftPolygons.every((leftPolygon) => rightPolygons.every((rightPolygon) => (
    !polygonsOverlap(leftPolygon, rightPolygon)
  )));
  const markersClear = left.markerCircles.every(({ centre, radius }) => (
    rightPolygons.every((polygon) => (
      !circleOverlapsPolygon(
        [centre[0], centre[2]],
        radius + CARD_ZONE_OBJECT_GAP,
        polygon,
      )
    ))
  )) && right.markerCircles.every(({ centre, radius }) => (
    leftPolygons.every((polygon) => (
      !circleOverlapsPolygon(
        [centre[0], centre[2]],
        radius + CARD_ZONE_OBJECT_GAP,
        polygon,
      )
    ))
  ));
  const markerSlotsClear = left.markerCircles.every((leftMarker) => (
    right.markerCircles.every((rightMarker) => (
      Math.hypot(
        leftMarker.centre[0] - rightMarker.centre[0],
        leftMarker.centre[2] - rightMarker.centre[2],
      ) >= leftMarker.radius + rightMarker.radius + CARD_ZONE_OBJECT_GAP
    ))
  ));
  return rectangularObjectsClear && markersClear && markerSlotsClear;
}

const authoredOccupancyLayoutCache = new Map<number, readonly SeatOccupancyLayout[]>();

function authoredStationIndexForPose(pose: SeatPose): number {
  return AUTHORED_STATION_POSES.findIndex((stationPose) => (
    stationPose.position[0] === pose.position[0]
      && stationPose.position[2] === pose.position[2]
  ));
}

function authoredSeatOccupancyLayouts(amount: number): readonly SeatOccupancyLayout[] {
  const cached = authoredOccupancyLayoutCache.get(amount);
  if (cached) return cached;

  const candidateSets = AUTHORED_STATION_POSES.map((pose) => seatOccupancyCandidateSet(pose, amount));
  const fallbackSelection = candidateSets.map((candidateSet, index) => (
    candidateSet.candidates.find((candidate) => candidate.fits)
      ?? seatOccupancyFallback(AUTHORED_STATION_POSES[index], candidateSet)
  ));

  const candidateIndex = (seatIndex: number, candidate: SeatOccupancyCandidate) => (
    candidateSets[seatIndex].candidates.indexOf(candidate)
  );
  const fittingCandidates = candidateSets.map((candidateSet, seatIndex) => (
    candidateSet.candidates
      .filter((candidate) => candidate.fits)
      .sort((left, right) => Number(right.preferred) - Number(left.preferred)
        || candidateIndex(seatIndex, left) - candidateIndex(seatIndex, right))
  ));
  // Assign the most constrained semantic lanes first. A local greedy repair can
  // strand a valid rear candidate behind a neighbouring rack that was itself
  // moved later; the bounded objective search keeps the maximum number of
  // preferred slots when a joint assignment exists and still proves every
  // selected rack and label disjoint globally.
  const seatOrder = Array.from({ length: AUTHORED_STATION_POSES.length }, (_, index) => index)
    .sort((left, right) => {
      const preferredLeft = fittingCandidates[left].filter((candidate) => candidate.preferred).length;
      const preferredRight = fittingCandidates[right].filter((candidate) => candidate.preferred).length;
      return preferredLeft - preferredRight
        || fittingCandidates[left].length - fittingCandidates[right].length
        || left - right;
    });
  const assignment: Array<SeatOccupancyCandidate | undefined> = Array.from(
    { length: AUTHORED_STATION_POSES.length },
    () => undefined,
  );
  const maximumPreferred = fittingCandidates.filter((candidates) => (
    candidates.some((candidate) => candidate.preferred)
  )).length;
  let bestPreferred = -1;
  let bestAssignment: SeatOccupancyCandidate[] | undefined;
  const findAssignment = (depth: number, preferredCount: number): void => {
    if (bestPreferred === maximumPreferred) return;
    const remainingPreferredCapacity = preferredCount + seatOrder
      .slice(depth)
      .filter((seatIndex) => fittingCandidates[seatIndex].some((candidate) => candidate.preferred))
      .length;
    if (remainingPreferredCapacity < bestPreferred) return;
    if (depth === seatOrder.length) {
      if (preferredCount > bestPreferred) {
        bestPreferred = preferredCount;
        bestAssignment = assignment.slice() as SeatOccupancyCandidate[];
      }
      return;
    }
    const seatIndex = seatOrder[depth];
    for (const candidate of fittingCandidates[seatIndex]) {
      const clearAssigned = assignment.every((other) => (
        other === undefined || occupancyCandidatesClear(candidate, other)
      ));
      if (!clearAssigned) continue;
      assignment[seatIndex] = candidate;
      findAssignment(depth + 1, preferredCount + Number(candidate.preferred));
      assignment[seatIndex] = undefined;
    }
  };
  findAssignment(0, 0);
  const selected = bestAssignment ?? fallbackSelection;

  const layouts = candidateSets.map((candidateSet, index) => {
    const pose = AUTHORED_STATION_POSES[index];
    const candidate = selected[index]
      ?? candidateSet.candidates.find((next) => next.fits)
      ?? seatOccupancyFallback(pose, candidateSet);
    const cardOrigin = seatLocalPoint(pose, pose.feltPosition);
    const card = [
      cardOrigin[0],
      cardOrigin[1],
      cardOrigin[2] + CARD_ZONE_LOCAL_CENTER_Z,
    ] as const;
    return seatOccupancyLayoutFromCandidate(pose, candidateSet.bounds, card, candidate);
  });
  authoredOccupancyLayoutCache.set(amount, layouts);
  return layouts;
}

/** Resolve authored seats together so neighboring rack footprints cannot overlap. */
export function seatOccupancyLayout(
  pose: SeatPose,
  amount = 15_000,
): SeatOccupancyLayout {
  const stationIndex = authoredStationIndexForPose(pose);
  if (stationIndex < 0) return seatOccupancyLayoutSingle(pose, amount);
  return authoredSeatOccupancyLayouts(amount)[stationIndex];
}

/**
 * Resting stack for one seat, safely inside that same seat's play lane.
 *
 * This uses the owner's local frame so every player has their chips on the
 * same player-left, rail-side lane. The final capsule clamp protects corner stations
 * from rail overlap without changing any card, wager, or seat-zone anchor.
 */
export function restingChipStackPosition(
  pose: SeatPose,
  amount = 15_000,
): readonly [number, number, number] {
  return seatOccupancyLayout(pose, amount).rackOrigin;
}

/**
 * Place a dealer/blind marker beside the owner's physical chip rack.
 *
 * The puck is not a wager and never replaces one: it owns a dedicated physical
 * slot just outside the rack that represents that player's remaining stack.
 * This makes D/SB/BB legible as player markers instead of central-table UI.
 */
export function tableMarkerPosition(
  pose: SeatPose,
  label: "D" | "SB" | "BB" = "D",
  amount = 15_000,
): readonly [number, number, number] {
  const layout = seatOccupancyLayout(pose, amount);
  const base = seatLocalPoint(pose, layout.markerBase);
  const markerSide = layout.rackSide === 0
    ? CHIP_STACK_LOCAL_LEFT_SIDE
    : layout.rackSide;
  // Heads-up poker gives one player both D and SB. The SB uses a second
  // lateral pocket farther along the same side of the owner's rack.
  const slotOffset = label === "SB" ? markerSide * TABLE_MARKER_SLOT_OFFSET : 0;
  return seatWorldPoint(pose, [
    base[0] + slotOffset,
    TABLE_HEIGHT + 0.012,
    base[2],
  ]);
}

/** World anchor for the exact number that describes a player's remaining rack. */
export function stackAmountPosition(
  pose: SeatPose,
  amount = 15_000,
): readonly [number, number, number] {
  return seatOccupancyLayout(pose, amount).stackLabel;
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
  amount = 15_000,
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0) return undefined;
  if (relativeSeat >= PLAYER_STATION_COUNT || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose) return undefined;
  const projected = projectToViewport(
    stackAmountPosition(pose, amount),
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
  amount = 15_000,
): { readonly xPercent: number; readonly yPercent: number } | undefined {
  if (!Number.isInteger(relativeSeat) || relativeSeat < 0 || relativeSeat >= PLAYER_STATION_COUNT) {
    return undefined;
  }
  const pose = seatPoses(PLAYER_STATION_COUNT, heroIndex)[relativeSeat];
  if (!pose || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const projected = projectToViewport(stackAmountPosition(pose, amount), activeCamera, viewportWidth, viewportHeight);
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
 * Internal wager placement/collision-zone centre, in table space.
 *
 * A wager belongs in front of the player who made it until the street closes
 * and the dealer sweeps it. This stays internal: it aligns physical chips,
 * collision, the turn cue, and projected endpoints without painting a guide on
 * the felt.
 */
export function betCirclePosition(pose: SeatPose): readonly [number, number, number] {
  return [
    pose.feltPosition[0] + Math.sin(pose.facing) * BET_CIRCLE_FORWARD,
    TABLE_HEIGHT,
    pose.feltPosition[2] + Math.cos(pose.facing) * BET_CIRCLE_FORWARD,
  ];
}

/** The pot: centred laterally and slightly toward the dealer's working bay. */
export const POT_POSITION: readonly [number, number, number] = [0, TABLE_HEIGHT, TABLE_ANCHORS.mainPot[2]];

/**
 * Where a bet's chips are at `progress`, travelling from the seat's felt spot
 * out to its own bet circle.
 */
export function betChipPosition(
  pose: SeatPose,
  progress: number,
  rackAmount = 15_000,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.06, rackAmount);
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
  rackAmount = 15_000,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.035, rackAmount);
}

/**
 * A raise gathers chips back toward the player first, then pushes the larger
 * pile out to the betting line -- a different midpoint from both a call and an
 * opening bet, with the same end state.
 */
export function raiseChipPosition(
  pose: SeatPose,
  progress: number,
  rackAmount = 15_000,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = restingChipStackPosition(pose, rackAmount);
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
  const from = t < 0.34 ? [x, y, z] as const : gather;
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
  rackAmount = 15_000,
): readonly [number, number, number] {
  return chipPositionAlongPush(pose, progress, 0.11, rackAmount);
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
  rackAmount: number,
): readonly [number, number, number] {
  const t = actionEase(progress);
  const [x, y, z] = restingChipStackPosition(pose, rackAmount);
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

/**
 * The opening 15k rack must contain playable change, not three orange plaques.
 * This exact bank uses every live early-level denomination and matches the
 * footprint of a stack that has already posted a blind.
 */
const OPENING_STACK_15K_INVENTORY = [
  25, 25, 25, 25,
  100, 100, 100, 100,
  500, 500, 500,
  1_000, 1_000, 1_000,
  5_000, 5_000,
] as const;

export function chipInventoryForAmount(amount: number): readonly number[] {
  let remainder = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  if (remainder === 15_000) return OPENING_STACK_15K_INVENTORY;
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
 * every column contains one denomination and never exceeds the requested
 * capacity. Small groups of high-value chips use one chip per column so a
 * 15,000-ish starting stack reads as several chips instead of one orange rod;
 * very large groups fall back to the normal capacity to keep geometry bounded.
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
    // One coherent denomination group per column. Only split when the normal
    // physical height limit is actually reached; two orange chips must be one
    // two-chip orange stack, never two duplicate orange racks.
    const columnCapacity = chipsPerColumn;
    while (remaining > 0) {
      const size = Math.min(columnCapacity, remaining);
      result.push({ denomination, count: size, column });
      remaining -= size;
      column += 1;
    }
  }
  return result;
}
