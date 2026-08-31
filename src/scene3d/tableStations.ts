/**
 * Where everyone sits, including the dealer, and where the hero's camera goes.
 *
 * This replaces the `open-arc-v2` composition. That model put the hero at an
 * *open near side* with all five opponents on a forward horseshoe, which meant
 * the hero occupied the one spot at a real table nobody sits at -- the dealer's.
 * The camera read as standing over the table rather than playing at it.
 *
 * The v4 model is a casino-dealt six-player layout: the house dealer owns a
 * shallow cutout in the far rail, while six player chairs touch the remaining
 * perimeter. The hero is one of those six, chosen deterministically per table.
 * Their neighbours are therefore genuinely beside them, which is what sitting
 * at a table looks like.
 *
 * Pure arithmetic, no three.js, so the layout can be tested without a GPU.
 */

export const TABLE_COMPOSITION_ID = "casino-dealer-cutout-v4";

/** Playing surface, in metres. A real six-max oval is about this size. */
export const TABLE_WIDTH = 2.30;
export const TABLE_DEPTH = 1.15;
export const TABLE_RAIL_WIDTH = 0.13;
export const TABLE_HEIGHT = 0.76;

/**
 * The house dealer works from a shallow cutout in the far rail.  These are
 * public composition dimensions (not camera offsets): the authored table mesh,
 * dealer station, shoe and layout tests all consume the same values.
 */
export const DEALER_CUTOUT_HALF_WIDTH = 0.27;
export const DEALER_CUTOUT_DEPTH = 0.12;

/**
 * How far a station's body centre sits outside the outer rail.
 *
 * This is measured from the exact outer-rail contact along the surface normal.
 * It keeps the chair front tangent to the padded rail while leaving the body
 * centre far enough outside the table for believable arms and camera framing.
 */
export const STATION_CLEARANCE = 0.25;

/**
 * The dealer sits tighter to the table than the players do.
 *
 * They work at the felt -- pitching cards, pulling in bets, cutting out the pot
 * -- so they sit right up against the rail rather than back from it. Giving the
 * dealer a player's clearance meant their arms had to span half a metre of open
 * air to reach the felt at all, which read as two long tubes laid across the
 * table rather than a person dealing.
 */
export const DEALER_CLEARANCE = 0.20;

/**
 * Angles are measured from the table's near centre (+Z) and increase toward +X.
 *
 * The dealer holds the far long side. The six players spread across the
 * remaining perimeter with even spacing, which leaves a comfortable gap either
 * side of the dealer instead of crowding a player against their elbow.
 */
export const DEALER_ANGLE_DEGREES = 180;
/*
 * These bearings are diagnostic labels for seat order and test output. Physical
 * placement comes from mirrored rail contacts below: two dealer-side corners,
 * two side seats and two near-straight seats. This preserves the reference's
 * dealer gap and keeps every chair tangent to the same authored rail.
 */
export const PLAYER_ANGLES_DEGREES = [-136, -90, -29, 29, 90, 136] as const;
export const PLAYER_STATION_COUNT = PLAYER_ANGLES_DEGREES.length;

export interface Station {
  /** Bearing around the table, in degrees from the near centre; see above. */
  readonly angleDegrees: number;
  /** Ground position of the body centre. */
  readonly position: readonly [number, number, number];
  /** Rotation about Y so the body faces the middle of the table. */
  readonly facing: number;
  /** Where this station's cards and committed chips rest on the felt. */
  readonly feltPosition: readonly [number, number, number];
  /** Where a rail nameplate attaches, just outside the rail. */
  readonly railPosition: readonly [number, number, number];
}

type StationContact = {
  readonly angleDegrees: number;
  /** Exact point where the chair touches the outside of the padded rail. */
  readonly rail: readonly [number, number];
  /** Unit vector from the rail into the felt, also the seat's facing. */
  readonly inward: readonly [number, number];
};

/*
 * The approved casino reference is not a six-point ellipse. It has two corner
 * seats beside the dealer bay, two true side seats and two seats on the near
 * straight. Authoring the six rail contacts makes all chairs tangent to the
 * same physical outline and gives every local lane an identical depth.
 *
 * Outer capsule geometry: straight half-run 0.575 m, radius 0.705 m.  The two
 * far-corner contacts lie on that exact radius; the side and near contacts lie
 * on its side cap and straight respectively. Values are mirrored by design.
 */
const FAR_CORNER_X = 0.80;
const OUTER_RADIUS = TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH;
const STRAIGHT_HALF_RUN = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
const FAR_CORNER_DX = FAR_CORNER_X - STRAIGHT_HALF_RUN;
const FAR_CORNER_Z = Math.sqrt(OUTER_RADIUS ** 2 - FAR_CORNER_DX ** 2);
const FAR_CORNER_NORMAL_X = FAR_CORNER_DX / OUTER_RADIUS;
const FAR_CORNER_NORMAL_Z = FAR_CORNER_Z / OUTER_RADIUS;
const NEAR_SEAT_X = 0.52;

const PLAYER_CONTACTS: readonly StationContact[] = [
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[0],
    rail: [-FAR_CORNER_X, -FAR_CORNER_Z],
    inward: [FAR_CORNER_NORMAL_X, FAR_CORNER_NORMAL_Z],
  },
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[1],
    rail: [-(TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH), 0],
    inward: [1, 0],
  },
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[2],
    rail: [-NEAR_SEAT_X, OUTER_RADIUS],
    inward: [0, -1],
  },
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[3],
    rail: [NEAR_SEAT_X, OUTER_RADIUS],
    inward: [0, -1],
  },
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[4],
    rail: [TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH, 0],
    inward: [-1, 0],
  },
  {
    angleDegrees: PLAYER_ANGLES_DEGREES[5],
    rail: [FAR_CORNER_X, -FAR_CORNER_Z],
    inward: [-FAR_CORNER_NORMAL_X, FAR_CORNER_NORMAL_Z],
  },
];

/** Full card-zone bounds remain inside the felt while staying close to rail. */
export const PLAYER_LANE_FELT_INSET = 0.20;

function stationAtContact(contact: StationContact): Station {
  const [railX, railZ] = contact.rail;
  const [inwardX, inwardZ] = contact.inward;
  const feltInset = TABLE_RAIL_WIDTH + PLAYER_LANE_FELT_INSET;
  return {
    angleDegrees: contact.angleDegrees,
    position: [
      railX - inwardX * STATION_CLEARANCE,
      0,
      railZ - inwardZ * STATION_CLEARANCE,
    ],
    facing: Math.atan2(inwardX, inwardZ),
    feltPosition: [
      railX + inwardX * feltInset,
      TABLE_HEIGHT,
      railZ + inwardZ * feltInset,
    ],
    railPosition: [railX, TABLE_HEIGHT + 0.03, railZ],
  };
}

/** The six player stations, in seat order around the table. */
export function playerStations(): readonly Station[] {
  return PLAYER_CONTACTS.map((contact) => stationAtContact(contact));
}

/** The dealer's station. Not a player, and never dealt a hand. */
export function dealerStation(): Station {
  const cutoutRailZ = -(OUTER_RADIUS - DEALER_CUTOUT_DEPTH);
  return {
    angleDegrees: DEALER_ANGLE_DEGREES,
    position: [0, 0, cutoutRailZ - DEALER_CLEARANCE],
    facing: 0,
    feltPosition: [0, TABLE_HEIGHT, -(TABLE_DEPTH / 2 - DEALER_CUTOUT_DEPTH - 0.105)],
    railPosition: [0, TABLE_HEIGHT + 0.03, cutoutRailZ],
  };
}

/**
 * Which player station the hero occupies.
 *
 * Deterministic in the table round's identity so a player keeps their seat for
 * every hand in that round rather than teleporting between deals, and so a
 * replay of the same round reproduces the same view.  A fresh/retried round has
 * a new identity and therefore makes a new seat draw. FNV-1a, same as the
 * appearance model.
 */
export function heroStationIndex(tableId: string): number {
  let hash = 2166136261;
  for (const character of `hero-seat ${tableId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PLAYER_STATION_COUNT;
}

/**
 * Map a hero-relative seat index onto a station index.
 *
 * The engine and the DOM both order seats hero-first, with increasing seat
 * numbers advancing clockwise through the hand. The authored station angles
 * increase counter-clockwise when viewed from above the table (near rail at
 * the bottom of the screen, dealer at the far rail), so directly adding the
 * relative seat mirrored the live game: SB and BB appeared on the dealer's
 * right and action visibly travelled counter-clockwise.
 *
 * The ring does not care where the hero is, so relative seat `n` is `n`
 * stations clockwise from the hero's own station. Subtracting here is the
 * sole engine-to-physical conversion: engine seat order remains authoritative
 * while the rendered button, blinds, deal, and turn indicator follow the same
 * clockwise direction a player sees at the table.
 */
export function stationIndexForRelativeSeat(
  relativeSeat: number,
  heroIndex: number,
): number {
  return (
    (heroIndex - relativeSeat) % PLAYER_STATION_COUNT + PLAYER_STATION_COUNT
  ) % PLAYER_STATION_COUNT;
}

/** Seated eye height above the floor. */
export const EYE_HEIGHT = 1.28;
/** A player looks down at the felt in front of them. */
export const CAMERA_PITCH_DEGREES = 24;
/*
  62 degrees vertical (about 95 horizontal at 16:9), narrowed from 70.

  Measured across all six hero seats this still frames the board, the pot and the
  hero's own cards at every supported viewport, and every opponent is still
  reachable inside the +/-40 degree head turn -- the framing tests assert both.
  What 70 bought was peripheral coverage the hero was never looking at, and it
  charged real barrel distortion for it: the neighbour at the frame edge was
  stretched into an unrecognisable mass, which is the single loudest artefact a
  wide lens produces on a face 1 m away. The remaining coverage is handled by
  looking, which is what a seated player does, and what the composition doc
  already anticipated with its off-screen-actor edge cue requirement.
*/
export const CAMERA_VERTICAL_FOV = 62;
/**
 * How far the eyes sit back from the station's body centre.
 *
 * Small and positive: the head is slightly behind the body's centre of mass when
 * seated upright, and pulling back a little keeps the hero's own cards inside the
 * near frame rather than under the chin.
 */
export const EYE_SETBACK = 0.10;

/** Yaw limits either side of centre; a seated player turns their head, not their chair. */
export const MAX_YAW_RADIANS = (40 * Math.PI) / 180;
export const MIN_PAN = -2;
export const MAX_PAN = 2;

export type SceneCameraView = "close" | "standard" | "wide";
export type SceneCameraMotion = "full" | "reduced" | "off";

/**
 * The hero's seated camera.
 *
 * Sits at the hero's own station, looks across the table, and yaws within the
 * head-turn limit. There is no depth solver any more: the hero sits where a
 * player sits, so the framing follows from the seat rather than from fitting the
 * table into a target width.
 */
export function cameraPose(
  pan: number,
  heroIndex: number,
  aspect = 16 / 9,
  zoom = 0,
): {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly target: readonly [number, number, number];
  readonly fov: number;
} {
  void aspect;
  const station = playerStations()[heroIndex % PLAYER_STATION_COUNT];
  const clampedPan = Math.min(MAX_PAN, Math.max(MIN_PAN, pan));
  const yaw = (clampedPan / MAX_PAN) * MAX_YAW_RADIANS;
  // Pull the eyes back along the station's own outward bearing.
  const outward = Math.hypot(station.position[0], station.position[2]) || 1;
  const position = [
    station.position[0] * (1 + EYE_SETBACK / outward),
    EYE_HEIGHT,
    station.position[2] * (1 + EYE_SETBACK / outward),
  ] as const;

  // Base bearing points at the table centre; pan rotates around that.
  const baseYaw = Math.atan2(-position[0], -position[2]);
  const lookYaw = baseYaw + yaw;
  const lookDistance = Math.hypot(position[0], position[2]);
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const target = [
    position[0] + Math.sin(lookYaw) * lookDistance,
    EYE_HEIGHT - Math.tan(pitch) * lookDistance,
    position[2] + Math.cos(lookYaw) * lookDistance,
  ] as const;

  // Wheel zoom changes only the lens, preserving the seated eye position and
  // sight line. This avoids clipping through the rail or moving the camera
  // into another player's seat.
  const clampedZoom = Math.min(1, Math.max(-1, zoom));
  const fov = Math.min(66, Math.max(36, CAMERA_VERTICAL_FOV - clampedZoom * 16));
  return { position, yaw, target, fov };
}

/**
 * Adapt a station to the `SeatPose` shape the object-motion helpers consume, so
 * card and chip travel code is shared between players and the dealer.
 */
export function stationAsPose(station: Station, seat: number): {
  readonly seat: number;
  readonly angle: number;
  readonly position: readonly [number, number, number];
  readonly feltPosition: readonly [number, number, number];
  readonly facing: number;
} {
  return {
    seat,
    angle: Math.atan2(station.position[0], station.position[2]),
    position: station.position,
    feltPosition: station.feltPosition,
    facing: station.facing,
  };
}

/** Distance from a point to the table's centre line segment. */
function capsuleDistance(x: number, z: number): number {
  const straight = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
  const clampedX = Math.min(straight, Math.max(-straight, x));
  return Math.hypot(x - clampedX, z);
}

/**
 * Where a station's ledge medallion is inlaid.
 *
 * The medallion has to land on the hard ledge ring -- the flat shelf between
 * the felt and the padded rail -- on the station's own bearing. The table top is
 * a capsule, not an ellipse, so scaling the seat's ellipse semi-axes does *not*
 * land on it: at the corner stations that error was 27 mm, which put the inlay
 * on the felt chamfer instead of the shelf. This walks out along the station's
 * bearing until it reaches the ledge midline, which is correct for any outline
 * the two share.
 */
const LEDGE_MIDLINE_OFFSET = 0.028;

export function stationLedgeAnchor(station: Station): readonly [number, number, number] {
  const length = Math.hypot(station.position[0], station.position[2]) || 1;
  const ux = station.position[0] / length;
  const uz = station.position[2] / length;
  const target = TABLE_DEPTH / 2 + LEDGE_MIDLINE_OFFSET;
  let low = 0;
  let high = TABLE_WIDTH;
  for (let step = 0; step < 48; step += 1) {
    const mid = (low + high) / 2;
    if (capsuleDistance(ux * mid, uz * mid) < target) low = mid;
    else high = mid;
  }
  const distance = (low + high) / 2;
  return [ux * distance, TABLE_HEIGHT, uz * distance];
}

/** Public poker-object anchors, in table space. */
export const TABLE_ANCHORS = {
  /* Shared objects are dealer-owned and sit just dealer-side of true centre. */
  board: [0, TABLE_HEIGHT + 0.005, -0.05] as const,
  mainPot: [0, TABLE_HEIGHT + 0.005, -0.24] as const,
  sidePot: (index: number) =>
    [
      index % 2 === 0
        ? 0.34 + Math.floor(index / 2) * 0.2
        : -0.34 - Math.floor(index / 2) * 0.2,
      TABLE_HEIGHT + 0.005,
      -0.24,
    ] as const,
  /**
   * Centre of the live pack under the dealer's left palm. The renderer parents
   * the pack to the dealer arm assembly, so this is both its rest position and
   * the exact origin sampled by every deal choreography.
   */
  dealerShoe: [0.30, TABLE_HEIGHT + 0.002, -(TABLE_DEPTH / 2 - 0.2)] as const,
  /**
   * The point a card visibly leaves the dealer's throwing hand.
   *
   * This is deliberately in front of the shoe.  A card that starts from the
   * shoe while the dealer merely waves reads as a floating animation; the shoe
   * is where it is picked up, this is where it is released.
   */
  dealerThrow: [0.12, TABLE_HEIGHT + 0.105, -(TABLE_DEPTH / 2 - 0.16)] as const,
  /**
   * The muck, in a dedicated dealer-right lane. Keeping it off the player
   * racks prevents the folded packet from visually merging with a stack while
   * preserving a short, believable sweep from the dealer's right hand.
   */
  muck: [-0.18, TABLE_HEIGHT + 0.01, -(TABLE_DEPTH / 2 - 0.12)] as const,
} as const;
