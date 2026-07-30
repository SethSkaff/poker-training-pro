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

/** How far a station's body centre sits outside the outer rail. */
const STATION_CLEARANCE = 0.30;

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

function stationAt(angleDegrees: number): Station {
  const angle = (angleDegrees * Math.PI) / 180;
  const [bodyA, bodyB] = ellipseSemiAxes(STATION_CLEARANCE);
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
    position: [bodyA * Math.sin(angle), 0, bodyB * Math.cos(angle)],
    // Faces the table centre from wherever the station is.
    facing: Math.atan2(-bodyA * Math.sin(angle), -bodyB * Math.cos(angle)),
    feltPosition: [feltA * Math.sin(angle), TABLE_HEIGHT, feltB * Math.cos(angle)],
    railPosition: [railA * Math.sin(angle), TABLE_HEIGHT + 0.03, railB * Math.cos(angle)],
  };
}

/** The six player stations, in seat order around the table. */
export function playerStations(): readonly Station[] {
  return PLAYER_ANGLES_DEGREES.map(stationAt);
}

/** The dealer's station. Not a player, and never dealt a hand. */
export function dealerStation(): Station {
  return stationAt(DEALER_ANGLE_DEGREES);
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
 * The engine and the DOM both order seats hero-first. The ring does not care
 * where the hero is, so relative seat `n` is `n` stations clockwise from the
 * hero's own station, wrapping. This is the single place that mapping lives.
 */
export function stationIndexForRelativeSeat(
  relativeSeat: number,
  heroIndex: number,
): number {
  return (heroIndex + relativeSeat) % PLAYER_STATION_COUNT;
}

/** Seated eye height above the floor. */
export const EYE_HEIGHT = 1.28;
/** A player looks down at the felt in front of them. */
export const CAMERA_PITCH_DEGREES = 24;
/*
  70 degrees vertical (about 102 horizontal at 16:9). Measured across all six hero
  seats: at rest this frames the board, the pot, the hero's own cards and 3.3 of 5
  opponents on average, and *all five* are reachable inside the +/-40 degree head
  turn. Going wider only buys 0.4 more opponents at rest and costs real barrel
  distortion, so the remaining coverage is handled by looking -- which is what a
  seated player does, and what the composition doc already anticipated with its
  off-screen-actor edge cue requirement.
*/
export const CAMERA_VERTICAL_FOV = 70;
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
