/**
 * Where everyone sits, including the dealer, and where the hero's camera goes.
 *
 * This replaces the `open-arc-v2` composition. That model put the hero at an
 * *open near side* with all five opponents on a forward horseshoe, which meant
 * the hero occupied the one spot at a real table nobody sits at -- the dealer's.
 * The camera read as standing over the table rather than playing at it.
 *
 * The v3 model is a conventional card-room layout: seven stations around an oval,
 * one of which is the dealer's, six of which are players. The hero is one of
 * those six, chosen deterministically per table. Their neighbours are therefore
 * genuinely beside them, which is what sitting at a table looks like.
 *
 * Pure arithmetic, no three.js, so the layout can be tested without a GPU.
 */

export const TABLE_COMPOSITION_ID = "seated-ring-v3";

/** Playing surface, in metres. A real six-max oval is about this size. */
export const TABLE_WIDTH = 2.30;
export const TABLE_DEPTH = 1.15;
export const TABLE_RAIL_WIDTH = 0.13;
export const TABLE_HEIGHT = 0.76;

/**
 * How far a station's body centre sits outside the outer rail.
 *
 * Raised from 0.30, where the hero's two neighbours sat 0.55 m from the eye and
 * a neighbour's shoulder and forearm were the two largest objects in the frame.
 * Most of that problem turned out to belong to the 70-degree lens rather than
 * the spacing, and pushing the seats out to 0.42 to compensate simply moved it:
 * at that distance nobody could rest their hands on their own rail without an
 * arm long enough to look wrong. 0.34 is ordinary card-room spacing and, with
 * the narrower lens, leaves the neighbours reading as people.
 */
export const STATION_CLEARANCE = 0.34;

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
  Narrowed from +/-125 to +/-108. At 125 the outermost seat sat only 55 degrees
  from the dealer, which put the dealer 1.4 m from that hero's eyes and made them
  loom over a third of the frame. 72 degrees of clearance reads as sitting next to
  the dealer rather than inside them, and still leaves 0.8 m between neighbours.
*/
export const PLAYER_ANGLES_DEGREES = [-108, -66, -22, 22, 66, 108] as const;
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

function ellipseSemiAxes(clearance: number): readonly [number, number] {
  return [
    TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH + clearance,
    TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH + clearance,
  ];
}

function stationAt(angleDegrees: number, clearance = STATION_CLEARANCE): Station {
  const angle = (angleDegrees * Math.PI) / 180;
  const [bodyA, bodyB] = ellipseSemiAxes(clearance);
  const [railA, railB] = ellipseSemiAxes(0.015);
  /*
    Felt anchors sit just inboard of the ledge on the station's own bearing, so a
    player's cards and chips are unambiguously in front of *them*. Pulled further
    in (0.34/0.26) every seat's objects bunched toward the middle of the felt and
    it was impossible to tell whose chips were whose.
  */
  const feltA = TABLE_WIDTH / 2 - 0.20;
  const feltB = TABLE_DEPTH / 2 - 0.15;
  return {
    angleDegrees,
    position: [bodyA * Math.sin(angle), 0, bodyB * Math.cos(angle)],
    // Faces the table centre from wherever the station is.
    facing: Math.atan2(-bodyA * Math.sin(angle), -bodyB * Math.cos(angle)),
    feltPosition: [feltA * Math.sin(angle), TABLE_HEIGHT, feltB * Math.cos(angle)],
    railPosition: [railA * Math.sin(angle), TABLE_HEIGHT + 0.03, railB * Math.cos(angle)],
  };
}

/** The six player stations, in seat order around the table. */
export function playerStations(): readonly Station[] {
  // Not `map(stationAt)`: `map` passes the index as a second argument, which
  // would land in the clearance parameter and give each seat a different one.
  return PLAYER_ANGLES_DEGREES.map((angleDegrees) => stationAt(angleDegrees));
}

/** The dealer's station. Not a player, and never dealt a hand. */
export function dealerStation(): Station {
  return stationAt(DEALER_ANGLE_DEGREES, DEALER_CLEARANCE);
}

/**
 * Which player station the hero occupies.
 *
 * Deterministic in the table's identity so a player keeps their seat for the
 * whole event rather than teleporting between hands, and so a replay of the same
 * table reproduces the same view. FNV-1a, same as the appearance model.
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

  return { position, yaw, target, fov: CAMERA_VERTICAL_FOV };
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
  board: [0, TABLE_HEIGHT + 0.005, 0] as const,
  mainPot: [0, TABLE_HEIGHT + 0.005, 0.24] as const,
  sidePot: (index: number) =>
    [
      index % 2 === 0
        ? 0.34 + Math.floor(index / 2) * 0.2
        : -0.34 - Math.floor(index / 2) * 0.2,
      TABLE_HEIGHT + 0.005,
      0.24,
    ] as const,
  /** Where the dealer's shoe sits, and where dealt cards originate. */
  dealerShoe: [0.36, TABLE_HEIGHT + 0.02, -(TABLE_DEPTH / 2 - 0.2)] as const,
  /** The muck, in front of the dealer. */
  muck: [-0.42, TABLE_HEIGHT + 0.01, -(TABLE_DEPTH / 2 - 0.2)] as const,
} as const;
