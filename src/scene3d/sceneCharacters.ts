/**
 * Build a seated opponent from `characterModel`'s proportions.
 *
 * Every character is three meshes -- skin, hair, clothing -- because those are
 * the three things the appearance model tints independently. Each mesh is a
 * *merge* of its primitives rather than one mesh per sphere: a character is
 * roughly twenty primitives, and at five opponents that would be a hundred extra
 * draw calls against a 150 budget. Merging holds the whole table at six draws.
 *
 * Nothing here reads poker state. It takes an identity's appearance and returns
 * geometry, so a character can never encode how someone plays.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OpponentCharacter } from "../lib/opponentAppearance";
import {
  bodyProportions,
  faceProportions,
  hairParts,
  headCentreHeight,
  HEAD_RADIUS,
  lockJitter,
  TORSO_BASE_Y,
  type BodyProportions,
} from "./characterModel";
import { DEALER_CLEARANCE, STATION_CLEARANCE, TABLE_HEIGHT } from "./tableStations";
import type { SceneResourceLedger } from "./sceneResources";

export interface CharacterView {
  readonly root: Group;
  /** The clothed torso, so a lean/fold gesture can move the body only. */
  readonly body: Group;
  /** Forearm group that reaches toward the felt during an action. */
  readonly arms: Group;
  /** Separate shoulder pivots: action poses must bend elbows, never slide a rigid arm. */
  readonly leftShoulder: Group;
  readonly rightShoulder: Group;
  readonly leftElbow: Group;
  readonly rightElbow: Group;
}

const DEALER_TORSO_BASE_Y = 0.56;
const DEALER_TORSO_HEIGHT = 0.54;

/*
  The dealer is much closer to the camera than the far seats.  Keep these
  proportions explicit rather than letting a couple of scaled spheres drift
  until they read as a cartoon mask.  They are exported so the presentation
  test can enforce the screen-facing silhouette, not merely that a face mesh
  happens to exist.
*/
export const DEALER_FACE_FEATURE_LIMITS = Object.freeze({
  /** A single eye must remain well below one fifth of the head width. */
  maxEyeWidth: HEAD_RADIUS * 0.42,
  /** A neutral mouth is narrower than half the head, never a face-wide bar. */
  maxMouthWidth: HEAD_RADIUS * 0.48,
  /** Both eyes and the mouth together occupy a compact central facial band. */
  maxFeatureBandWidth: HEAD_RADIUS * 1.55,
});

export const DEALER_CAP_COVERAGE = Object.freeze({
  /** The cap begins above the eye line, leaving the whole face unobstructed. */
  lowerEdgeFromHeadCentre: HEAD_RADIUS * 0.18,
  /** Crown extends past the skin sphere's vertically stretched top. */
  crownTopFromHeadCentre: HEAD_RADIUS * 1.18,
});

/**
 * The joint the dealer's arms swing from, in the dealer group's own frame.
 *
 * Exported because the gesture model reasons in shoulder rotations and the test
 * for it has to know where the hands start in order to say where a rotation puts
 * them. Both arms share this one pivot; see `buildDealer`.
 */
export const DEALER_SHOULDER_PIVOT = [
  0,
  DEALER_TORSO_BASE_Y + DEALER_TORSO_HEIGHT - 0.05,
  0.02,
] as const;

/** Where the dealer's hands rest: over the felt, just inside their own edge. */
export const DEALER_HAND_REST = [
  0,
  TABLE_HEIGHT + 0.055,
  DEALER_CLEARANCE + 0.20,
] as const;

/** Low segment counts: a character is ~2 m away and a few hundred pixels tall. */
const SPHERE_SEGMENTS = 10;
const SPHERE_RINGS = 7;
const CYLINDER_SEGMENTS = 9;

function sphere(
  radius: number,
  centre: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
): BufferGeometry {
  const geometry = new SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_RINGS);
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.translate(centre[0], centre[1], centre[2]);
  return geometry;
}

function taper(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  centre: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
): BufferGeometry {
  const geometry = new CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    CYLINDER_SEGMENTS,
    1,
    false,
  );
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.translate(centre[0], centre[1], centre[2]);
  return geometry;
}

/**
 * A continuous, low-poly soft-body shell.  The older character used stacked
 * cones and decorative boxes, which makes a seated person read as a collection
 * of rigid props.  This ring mesh gives the chest, waist and hem their own
 * silhouette in a single connected surface, closer to the grounded human
 * construction of a late-2000s source-engine character while staying light
 * enough to draw once per seat.
 */
function shapedShell(
  rings: readonly { readonly y: number; readonly x: number; readonly z: number }[],
  segments = 10,
): BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex]!;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      // Flatten the back slightly: a seated torso presses into its chair rather
      // than being a perfect tube.
      const frontBias = Math.cos(angle) > 0 ? 1 : 0.90;
      vertices.push(Math.sin(angle) * ring.x, ring.y, Math.cos(angle) * ring.z * frontBias);
      uvs.push(segment / segments, ringIndex / (rings.length - 1));
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function seam(
  points: readonly [number, number, number][],
  radius: number,
): BufferGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points.map((point) => new Vector3(...point))), 8, radius, 5, false);
}

/** Flatten a shell below `floorY` so a hair cap cannot enclose the face. */
function clampBelow(geometry: BufferGeometry, floorY: number): BufferGeometry {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    if (position.getY(index) < floorY) position.setY(index, floorY);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function merged(
  parts: readonly BufferGeometry[],
  ledger: SceneResourceLedger,
): BufferGeometry | null {
  if (parts.length === 0) return null;
  const result = mergeGeometries([...parts], false);
  for (const part of parts) part.dispose();
  if (!result) return null;
  result.computeVertexNormals();
  return ledger.track(result);
}

/**
 * The head, its face relief, and the neck. Returned separately from the torso so
 * the skin material can be shared while clothing is tinted independently.
 */
function skinGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const face = faceProportions(character.face);
  const top = TORSO_BASE_Y + body.torsoHeight;
  const headY = headCentreHeight(body);
  const parts: BufferGeometry[] = [];

  // A short neck. At 0.11 m it stood the head off the shoulders like a lamp.
  parts.push(taper(body.neckRadius * 0.94, body.neckRadius * 1.04, 0.06, [0, top + 0.055, 0]));

  /*
    Face variation now comes almost entirely from *shaping the skull itself* --
    jaw width, and a chin taper applied as a vertical scale -- rather than from
    bolted-on spheres. Two rounds of shrinking discrete cheek and chin blobs still
    left them reading as loose balls stuck to a face at this distance, because any
    sphere large enough to see is large enough to look separate. Only a brow ridge
    and a small nose survive, and both are flattened into the surface.
  */
  // A face is not a sphere with loose parts glued on.  This continuous skull
  // shell carries the chin, jaw, cheeks, temples and crown in its silhouette.
  // It is deliberately faceted at this scale: grounded late-2000s game art,
  // not a smooth toy head.
  const headScaleY = 1.14 / Math.max(0.85, face.chin);
  const headScaleZ = 1.04 * face.cheek * 0.92;
  parts.push(shapedShell([
    { y: headY - HEAD_RADIUS * headScaleY * 0.98, x: HEAD_RADIUS * face.jaw * 0.42, z: HEAD_RADIUS * headScaleZ * 0.40 },
    { y: headY - HEAD_RADIUS * headScaleY * 0.68, x: HEAD_RADIUS * face.jaw * 0.76, z: HEAD_RADIUS * headScaleZ * 0.78 },
    { y: headY - HEAD_RADIUS * headScaleY * 0.16, x: HEAD_RADIUS * face.jaw, z: HEAD_RADIUS * headScaleZ },
    { y: headY + HEAD_RADIUS * headScaleY * 0.42, x: HEAD_RADIUS * face.jaw * 0.92, z: HEAD_RADIUS * headScaleZ * 0.94 },
    { y: headY + HEAD_RADIUS * headScaleY * 0.90, x: HEAD_RADIUS * face.jaw * 0.52, z: HEAD_RADIUS * headScaleZ * 0.55 },
  ]));
  /*
    The brow sits *in* the forehead, not on it. At 0.15 R scaled 2.1 wide it stood
    proud enough to cast its own terminator line, and on the neighbour a metre
    from the camera that line read as a dark horizontal slot across the face --
    a letterbox, not a brow. Half the projection and a shorter span keeps the
    variation between face presets while staying part of the skull.
  */
  parts.push(sphere(
    HEAD_RADIUS * 0.13 * face.brow,
    [0, headY + HEAD_RADIUS * 0.28, HEAD_RADIUS * 0.48],
    [1.75, 0.34, 0.30],
  ));
  parts.push(sphere(
    HEAD_RADIUS * 0.085 * face.nose,
    [0, headY - HEAD_RADIUS * 0.06, HEAD_RADIUS * 0.72],
    [0.85, 1.15, 1.2],
  ));
  /*
    Ears, reinstated. They were dropped when the nearest opponent was two metres
    away and an ear was a couple of pixels that joined the nose in a cluster of
    blobs round the jaw. The seat beside the hero is now about a metre off, which
    is close enough that a head without them reads as a mannequin. Flattened hard
    against the skull, so they are a silhouette rather than another sphere.
  */
  for (const side of [-1, 1]) {
    parts.push(sphere(
      HEAD_RADIUS * 0.20,
      [side * HEAD_RADIUS * face.jaw * 0.94, headY + HEAD_RADIUS * 0.02, -HEAD_RADIUS * 0.06],
      [0.32, 0.78, 0.52],
    ));
  }
  return parts;
}

/**
 * Eyes, brows and mouth, as one mesh in a single dark tone.
 *
 * The heads were a skull, a brow ridge and a nose -- anatomically a face, and
 * from any distance a blank egg. Featurelessness is not a style here, it is the
 * single loudest thing about the characters: the seat beside the hero is a metre
 * from the camera and it has nobody in it.
 *
 * These are deliberately flat inlays rather than modelled eyeballs. A sphere
 * with an iris on it needs to be aimed at something to look right, and an
 * unaimed pair of eyeballs on a low-poly head is markedly worse than none. Almond
 * slots that follow the skull read as eyes at every distance the table uses and
 * never look like they are staring past you.
 */
function featureGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const face = faceProportions(character.face);
  const headY = headCentreHeight(body);
  const wide = HEAD_RADIUS * face.jaw;
  const tall = HEAD_RADIUS * (1.14 / Math.max(0.85, face.chin));
  const deep = HEAD_RADIUS * 1.04 * face.cheek * 0.92;
  const parts: BufferGeometry[] = [];

  /*
    Put each feature on the skull's actual surface.

    Placing them at a fixed fraction of the head's depth buried them: the head
    is an ellipsoid, so a point at 82% of its depth and any height at all is
    *inside* it. The eyes only showed because their own radius happened to poke
    back out; the mouth, being shallower, never appeared on any face at all.
    This solves the ellipsoid for the depth at a given height, which is what the
    fixed fraction was standing in for.
  */
  const surface = (x: number, y: number): number => {
    const inside = 1 - (x / wide) ** 2 - (y / tall) ** 2;
    return deep * Math.sqrt(Math.max(0.05, inside));
  };

  for (const side of [-1, 1]) {
    const eyeX = side * wide * 0.36;
    const eyeY = HEAD_RADIUS * 0.10;
    parts.push(sphere(
      HEAD_RADIUS * 0.115,
      [eyeX, headY + eyeY, surface(eyeX, eyeY) * 0.97],
      [1.45, 0.62, 0.34],
    ));
    // Brows sit above and slightly wider than the eye, angled by preset: a low
    // heavy brow and a high thin one are most of the difference between two
    // faces that share a skull.
    const browX = side * wide * 0.38;
    // Below the hairline. At 0.27 R the brows sat exactly where the hair caps
    // floor out, so on most styles they were covered and the face lost the
    // one feature that carries its expression.
    const browY = HEAD_RADIUS * (0.19 + 0.04 * face.brow);
    const brow = sphere(
      HEAD_RADIUS * 0.105 * face.brow,
      [browX, headY + browY, surface(browX, browY) * 0.97],
      [1.7, 0.30, 0.30],
    );
    brow.rotateZ(side * 0.14);
    parts.push(brow);
  }
  const mouthY = -HEAD_RADIUS * 0.34;
  parts.push(sphere(
    HEAD_RADIUS * 0.12,
    [0, headY + mouthY, surface(0, mouthY) * 0.97],
    [2.0, 0.24, 0.30],
  ));
  return parts;
}

/**
 * Where a seated player's arms go.
 *
 * The hero's two neighbours sit about a metre from their eyes and roughly 45
 * degrees off the view axis, so their torsos fall just outside the frame while
 * their arms, reaching inward, fall just inside it. That makes the arms the one
 * part of a neighbour the hero sees close up, and it means a wrong arm reads as
 * two disembodied tubes floating over the carpet -- which is exactly what the
 * first two passes produced, because the hands stopped 0.12 m short of the rail
 * and had nothing to rest on.
 *
 * So the pose is defined by where the hand has to end up: on the rail top, in
 * front of its owner, converging slightly inward toward their own cards. The
 * shoulder, elbow and hand are three explicit points and the segments are built
 * between them, so a hand can never end up somewhere its forearm does not
 * reach.
 */
/*
  Where a resting hand lands, in the seat's own frame. The station's clearance is
  measured from the outer rail, so a hand a little past that distance is sitting
  on the rail top -- and it moves with the clearance instead of being a constant
  that silently stops reaching whenever the seating changes.
*/
const HAND_LOCAL_Z = STATION_CLEARANCE + 0.05;
/** Rail crest height; see `build_table.py`. */
const RAIL_TOP_Y = TABLE_HEIGHT + 0.063;

function armJoints(body: BodyProportions, side: number): {
  shoulder: readonly [number, number, number];
  elbow: readonly [number, number, number];
  hand: readonly [number, number, number];
} {
  const top = TORSO_BASE_Y + body.torsoHeight;
  const shoulder = [side * body.shoulderHalfWidth * 0.92, top - 0.02, 0.03] as const;
  const elbow = [side * body.shoulderHalfWidth * 0.90, top - 0.23, 0.15] as const;
  // Forearms angle inward so the hands come together in front of the player
  // rather than running parallel; a resting forearm also rises to the rail.
  const hand = [
    side * (body.shoulderHalfWidth * 0.90 - 0.075),
    RAIL_TOP_Y + 0.022,
    HAND_LOCAL_Z,
  ] as const;
  return { shoulder, elbow, hand };
}

/**
 * A tapered limb segment between two points.
 *
 * Cylinders are authored along +Y, so this rotates the whole geometry onto the
 * joint-to-joint direction rather than composing hand-solved Euler angles. Two
 * earlier passes did the latter and both left the hand detached from the arm
 * the moment any one of the angles changed.
 */
function limb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  radiusTop: number,
  radiusBottom: number,
): BufferGeometry {
  const axis = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = axis.length() || 0.0001;
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, CYLINDER_SEGMENTS, 1, false);
  geometry.applyQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize()),
  );
  geometry.translate(
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  );
  return geometry;
}

function handPart(body: BodyProportions, side: number): BufferGeometry {
  const { elbow, hand } = armJoints(body, side);
  // A flattened palm stretched along the forearm, nudged past the wrist so it
  // reads as a hand lying on the rail. A round ball at this size read as a knob
  // on the end of a pipe from the seat beside it.
  const reach = 0.035;
  const direction = new Vector3(hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]).normalize();
  return sphere(
    body.neckRadius * 0.60,
    [
      hand[0] + direction.x * reach,
      hand[1] + direction.y * reach,
      hand[2] + direction.z * reach,
    ],
    [1.05, 0.5, 1.5],
  );
}

function sleeveParts(body: BodyProportions, side: number): BufferGeometry[] {
  const { shoulder, elbow, hand } = armJoints(body, side);
  /*
    Elbow, and a cuff three quarters of the way to the wrist. Both are there for
    the same reason: a neighbour's forearm is a metre from the hero's eye and an
    unbroken taper at that size reads as a length of pipe. Two changes of radius
    along it are enough to make it read as a sleeved arm, and cost eighteen
    triangles inside a merged mesh.
    */
  const cuffAt = (t: number): readonly [number, number, number] => [
    elbow[0] + (hand[0] - elbow[0]) * t,
    elbow[1] + (hand[1] - elbow[1]) * t,
    elbow[2] + (hand[2] - elbow[2]) * t,
  ];
  return [
    limb(shoulder, elbow, body.neckRadius * 0.80, body.neckRadius * 0.92),
    limb(elbow, hand, body.neckRadius * 0.52, body.neckRadius * 0.78),
    sphere(body.neckRadius * 0.86, elbow, [1, 1, 1]),
    limb(cuffAt(0.68), cuffAt(0.80), body.neckRadius * 0.66, body.neckRadius * 0.66),
  ];
}

/** The clothed torso, shoulders, and sleeved arms. */
function clothGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const top = TORSO_BASE_Y + body.torsoHeight;
  const parts: BufferGeometry[] = [];

  const hem = body.waistHalfWidth * 1.03;
  const chest = body.shoulderHalfWidth * 0.94;
  // These rings make a shoulder slope, chest fullness and narrowed waist part
  // of one mesh.  There are no rectangular add-ons to read as armour plates.
  parts.push(shapedShell([
    { y: TORSO_BASE_Y, x: hem, z: body.chestDepth * 0.78 },
    { y: TORSO_BASE_Y + body.torsoHeight * 0.18, x: body.waistHalfWidth, z: body.chestDepth * 0.88 },
    { y: TORSO_BASE_Y + body.torsoHeight * 0.52, x: chest * 0.92, z: body.chestDepth },
    { y: top - 0.07, x: chest, z: body.chestDepth * 0.94 },
    { y: top, x: body.shoulderHalfWidth * 0.82, z: body.chestDepth * 0.74 },
  ]));
  return parts;
}

/**
 * Small, costume-specific construction pieces.  These are deliberately real
 * geometry rather than a bright painted decal: at poker-table distance a
 * shoulder yoke, lapel, zip or hood catches the room key light and breaks the
 * "single coloured mannequin" silhouette without increasing the character
 * texture budget.
 */
function wardrobeDetailGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const top = TORSO_BASE_Y + body.torsoHeight;
  const depth = body.chestDepth * 0.98;
  const parts: BufferGeometry[] = [];
  const front = depth + 0.006;

  // Curved seam work catches light like sewn cloth.  It intentionally avoids
  // the old rectangular yoke/lapel blocks that made everyone look armoured.
  parts.push(seam([
    [-body.shoulderHalfWidth * 0.72, top - 0.075, front],
    [0, top - 0.095, front + 0.009],
    [body.shoulderHalfWidth * 0.72, top - 0.075, front],
  ], 0.006));

  switch (character.outfit.name) {
    case "hoodie":
      // Folded hood resting behind the neck, never a helmet around the head.
      parts.push(new TorusGeometry(body.neckRadius * 1.62, body.neckRadius * 0.28, 6, 12, Math.PI * 1.18).translate(0, top - 0.015, -depth * 0.70));
      break;
    case "track-jacket":
    case "puffer":
      // Central zip/placket and a shallow collar, both softly rounded.
      parts.push(seam([[0, TORSO_BASE_Y + 0.045, front + 0.006], [0, top - 0.10, front + 0.010]], 0.006));
      parts.push(new TorusGeometry(body.neckRadius * 1.42, 0.010, 5, 12).translate(0, top + 0.006, 0));
      break;
    case "blazer":
    case "waistcoat":
      // Two separate lapels retain the formal silhouette even with low-poly
      // geometry and make the dealer-adjacent players less uniform.
      for (const side of [-1, 1]) {
        parts.push(seam([
          [side * body.neckRadius * 0.8, top - 0.04, front + 0.006],
          [side * body.shoulderHalfWidth * 0.42, top - body.torsoHeight * 0.25, front + 0.012],
          [side * body.shoulderHalfWidth * 0.22, TORSO_BASE_Y + body.torsoHeight * 0.35, front + 0.008],
        ], 0.010));
      }
      break;
    case "flannel":
    case "cardigan":
      parts.push(seam([[0, TORSO_BASE_Y + 0.075, front + 0.006], [0, top - 0.10, front + 0.009]], 0.007));
      break;
    case "polo":
      // Compact knitted collar, intentionally flatter than a jacket collar.
      parts.push(new TorusGeometry(body.neckRadius * 1.30, 0.010, 5, 12).translate(0, top + 0.003, 0));
      break;
    case "tee":
    case "turtleneck":
      parts.push(new TorusGeometry(body.neckRadius * 1.22, 0.008, 5, 12).translate(0, top + 0.002, 0));
      break;
  }
  return parts;
}

/**
 * Build a genuinely articulated arm: upper arm is parented at the shoulder and
 * the forearm (and palm) is parented at the elbow.  Keeping these as separate
 * meshes is intentional.  A merged limb can only translate as one rigid bar,
 * which was the source of the visible "sway" regression.
 */
function buildArticulatedArm(
  body: BodyProportions,
  side: number,
  outfitColour: string,
  skinColour: string,
  ledger: SceneResourceLedger,
): { shoulder: Group; elbow: Group } {
  const { shoulder: shoulderPoint, elbow: elbowPoint, hand: handPoint } = armJoints(body, side);
  const shoulder = new Group();
  shoulder.name = side < 0 ? "left-shoulder" : "right-shoulder";
  shoulder.position.set(...shoulderPoint);
  const elbow = new Group();
  elbow.name = side < 0 ? "left-elbow" : "right-elbow";
  const upper = new Mesh(
    ledger.track(limb([0, 0, 0], [
      elbowPoint[0] - shoulderPoint[0], elbowPoint[1] - shoulderPoint[1], elbowPoint[2] - shoulderPoint[2],
    ], body.neckRadius * 0.80, body.neckRadius * 0.92)),
    ledger.track(new MeshLambertMaterial({ color: outfitColour })),
  );
  shoulder.add(upper);
  elbow.position.set(
    elbowPoint[0] - shoulderPoint[0], elbowPoint[1] - shoulderPoint[1], elbowPoint[2] - shoulderPoint[2],
  );
  const forearmVector: [number, number, number] = [
    handPoint[0] - elbowPoint[0], handPoint[1] - elbowPoint[1], handPoint[2] - elbowPoint[2],
  ];
  const forearm = new Mesh(
    ledger.track(limb([0, 0, 0], forearmVector, body.neckRadius * 0.52, body.neckRadius * 0.78)),
    ledger.track(new MeshLambertMaterial({ color: outfitColour })),
  );
  elbow.add(forearm);
  const cuff = new Mesh(
    ledger.track(new TorusGeometry(body.neckRadius * 0.61, body.neckRadius * 0.07, 5, 9)),
    ledger.track(new MeshLambertMaterial({ color: skinColour })),
  );
  cuff.position.set(...forearmVector);
  cuff.rotation.x = Math.PI / 2;
  elbow.add(cuff);
  const palm = new Mesh(
    ledger.track(new SphereGeometry(body.neckRadius * 0.60, SPHERE_SEGMENTS, SPHERE_RINGS)),
    ledger.track(new MeshLambertMaterial({ color: skinColour })),
  );
  palm.name = side < 0 ? "left-hand" : "right-hand";
  palm.scale.set(1.05, 0.50, 1.5);
  palm.position.set(forearmVector[0], forearmVector[1] + 0.004, forearmVector[2] + 0.020);
  elbow.add(palm);
  shoulder.add(elbow);
  return { shoulder, elbow };
}

function hairGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const top = TORSO_BASE_Y + body.torsoHeight;
  const headY = headCentreHeight(body);
  const parts: BufferGeometry[] = [];

  for (const part of hairParts(character.gender, character.hairStyle)) {
    if (part.kind === "cap") {
      const shell = sphere(
        HEAD_RADIUS * part.radiusScale,
        [0, 0, 0],
        part.scale,
      );
      clampBelow(shell, part.floorY);
      shell.translate(part.offset[0], headY + part.offset[1], part.offset[2]);
      parts.push(shell);
    } else if (part.kind === "blob") {
      parts.push(sphere(
        HEAD_RADIUS * part.radiusScale,
        [part.offset[0], headY + part.offset[1], part.offset[2]],
        part.scale,
      ));
    } else if (part.kind === "locks") {
      /*
        A band of locks around the back and sides of the skull. Centred on the
        back of the head and wrapped forward by `arc`, so the fringe and the
        face are never covered however wide the band is set.
      */
      const span = Math.max(1, part.count - 1);
      const spacing = (part.arc / span) * HEAD_RADIUS;
      for (let row = 0; row < part.rows; row += 1) {
        // Half-step stagger between rows, so the band reads as a mass of hair
        // rather than as stripes of it.
        const stagger = (row % 2) * 0.5;
        for (let index = 0; index < part.count; index += 1) {
          const wobble = lockJitter(part.seed + row * 17, index);
          const angle = Math.PI + ((index + stagger) / span - 0.5) * part.arc;
          const surface = HEAD_RADIUS * (1 + part.bulge * (0.7 + wobble * 0.6));
          parts.push(sphere(
            spacing * part.thickness * (0.86 + wobble * 0.28),
            [
              Math.sin(angle) * surface,
              headY + HEAD_RADIUS * (part.latitude - row * 0.24 + (wobble - 0.5) * 0.07),
              Math.cos(angle) * surface,
            ],
            [1, 1.15, 1],
          ));
        }
      }
    } else {
      const strand = taper(part.radiusTop, part.radiusBottom, part.length, [0, 0, 0]);
      if (part.tiltX !== 0) strand.rotateX(part.tiltX);
      strand.translate(
        part.offset[0],
        headY + part.offset[1] - part.length / 2,
        part.offset[2],
      );
      parts.push(strand);
    }
  }
  return parts;
}

/**
 * Build one seated character. `heightScale` is applied to the whole group rather
 * than baked in, so two identities sharing a body family still differ in height
 * without duplicating geometry work.
 */
export function buildCharacter(
  character: OpponentCharacter,
  ledger: SceneResourceLedger,
): CharacterView {
  const root = new Group();
  const body = new Group();
  const arms = new Group();

  const skin = merged(skinGeometry(character), ledger);
  const cloth = merged(clothGeometry(character), ledger);
  const wardrobeDetails = merged(wardrobeDetailGeometry(character), ledger);
  const hair = merged(hairGeometry(character), ledger);
  const features = merged(featureGeometry(character), ledger);

  if (cloth) {
    const garment = new Mesh(cloth, ledger.track(new MeshStandardMaterial({
      color: character.outfit.base,
      roughness: 0.84,
      metalness: 0,
    })));
    garment.name = "garment-base";
    body.add(garment);
    // A restrained collar/hem layer gives each low-poly outfit a readable
    // construction line instead of a single painted torso block.
    const trim = new Mesh(
      ledger.track(new TorusGeometry(0.16, 0.012, 5, 12)),
      ledger.track(new MeshStandardMaterial({ color: character.outfit.trim, roughness: 0.72, metalness: 0 })),
    );
    trim.name = "garment-trim";
    trim.position.set(0, TORSO_BASE_Y + 0.11, 0.01);
    trim.rotation.x = Math.PI / 2;
    body.add(trim);
  }
  if (wardrobeDetails) {
    const details = new Mesh(
      wardrobeDetails,
      ledger.track(new MeshStandardMaterial({
        color: character.outfit.trim,
        roughness: 0.68,
        metalness: 0,
      })),
    );
    details.name = "garment-construction";
    body.add(details);
  }
  if (skin) {
    body.add(new Mesh(skin, ledger.track(new MeshStandardMaterial({
      color: character.skinTone,
      roughness: 0.82,
      metalness: 0,
    }))));
  }
  if (hair) {
    body.add(new Mesh(hair, ledger.track(new MeshStandardMaterial({
      color: character.hairColor,
      roughness: 0.9,
      metalness: 0,
    }))));
  }
  if (features) {
    /* One dark tone for eyes, brows and mouth. Brows in the identity's hair
       colour would be more correct and would cost a fourth mesh per character
       to say something nobody can see at this distance. */
    body.add(new Mesh(features, ledger.track(new MeshLambertMaterial({
      color: 0x2b211c,
    }))));
  }

  const bodyShape = bodyProportions(character.gender, character.body);
  const left = buildArticulatedArm(bodyShape, -1, character.outfit.base, character.skinTone, ledger);
  const right = buildArticulatedArm(bodyShape, 1, character.outfit.base, character.skinTone, ledger);
  // The lower sleeve is intentionally short for polos and tees.  The named
  // meshes preserve the presentation contract while the actual arm remains
  // jointed instead of being a decorative forearm bolted to the torso.
  if (character.outfit.name === "polo" || character.outfit.name === "tee") {
    left.elbow.children[0]!.name = "exposed-forearm";
    right.elbow.children[0]!.name = "exposed-forearm";
  }
  arms.add(left.shoulder, right.shoulder);

  root.add(body, arms);
  root.scale.setScalar(character.heightScale);
  return {
    root, body, arms,
    leftShoulder: left.shoulder,
    rightShoulder: right.shoulder,
    leftElbow: left.elbow,
    rightElbow: right.elbow,
  };
}

/**
 * The dealer, built to a deliberately different silhouette from the players.
 *
 * A card room's dealer reads as staff at a glance, and none of that comes from
 * the face: it is the waistcoat over a white shirt, the visor, the squared-up
 * posture, and the fact that they are the only figure whose hands sit over the
 * middle of the felt rather than in front of a seat. This is a house look rather
 * than a per-identity one, so unlike `buildCharacter` it takes no appearance --
 * every dealer is the same dealer.
 *
 * Worth recording: PokerStars VR, which this scene is otherwise mimicking, has
 * *no* dealer avatar at all -- an empty notch with a printed chip tray, and cards
 * that animate themselves. A visible animated dealer is a deliberate divergence
 * the owner asked for twice.
 */
export function buildDealer(
  skinTone: string,
  ledger: SceneResourceLedger,
): CharacterView {
  const root = new Group();
  const body = new Group();
  const arms = new Group();
  const shoulder = 0.215;
  const torsoHeight = DEALER_TORSO_HEIGHT;
  // A dealer sits higher than the players: their chair is raised so they can
  // reach the middle of the felt.
  const base = DEALER_TORSO_BASE_Y;
  const top = base + torsoHeight;
  const headY = top + 0.06 + HEAD_RADIUS * 1.02;

  const shirt: BufferGeometry[] = [];
  const waistcoat: BufferGeometry[] = [];
  const skin: BufferGeometry[] = [];
  const armShirt: BufferGeometry[] = [];
  const armSkin: BufferGeometry[] = [];

  // White shirt torso, with the waistcoat as a slightly larger shell over its
  // front so both read at once.
  shirt.push(taper(shoulder, shoulder * 0.86, torsoHeight, [0, base + torsoHeight / 2, 0], [1, 1, 0.62]));
  waistcoat.push(taper(shoulder * 1.02, shoulder * 0.9, torsoHeight * 0.82, [0, base + torsoHeight * 0.44, 0.012], [1, 1, 0.58]));
  for (const side of [-1, 1]) {
    shirt.push(sphere(shoulder * 0.3, [side * shoulder * 0.88, top - 0.03, 0], [1, 0.72, 0.66]));
    /*
      Both forearms reach in over the felt: the dealing pose, and the one thing
      that separates the dealer's silhouette from a player's at a glance.

      Built from explicit joints through `limb`, like the players' arms, so the
      hands land where the pose says rather than at whatever point a hand-solved
      rotation happens to end at. The reach is measured from the station's own
      clearance: the dealer sits `STATION_CLEARANCE` back from the rail, so the
      hands have to travel the rail width plus that clearance to be over the felt
      at all.
    */
    const shoulderPoint = [
      side * shoulder * 0.88,
      DEALER_SHOULDER_PIVOT[1],
      DEALER_SHOULDER_PIVOT[2],
    ] as const;
    const elbowPoint = [side * shoulder * 0.76, top - 0.20, 0.17] as const;
    const handPoint = [
      side * shoulder * 0.52,
      DEALER_HAND_REST[1],
      DEALER_HAND_REST[2],
    ] as const;
    armShirt.push(limb(shoulderPoint, elbowPoint, 0.044, 0.050));
    armShirt.push(limb(elbowPoint, handPoint, 0.036, 0.048));
    armSkin.push(sphere(0.041, handPoint, [1, 0.58, 1.35]));
  }
  skin.push(taper(0.05, 0.056, 0.06, [0, top + 0.03, 0]));
  skin.push(sphere(HEAD_RADIUS, [0, headY, 0], [0.98, 1.14, 1.02]));
  skin.push(sphere(HEAD_RADIUS * 0.09, [0, headY - HEAD_RADIUS * 0.06, HEAD_RADIUS * 0.72], [0.85, 1.1, 1.2]));

  // The visor: a dark band and a translucent-looking brim, the clearest single
  // "this one is the dealer" cue at a glance.
  const visor: BufferGeometry[] = [];
  const band = sphere(
    HEAD_RADIUS * 1.045,
    [0, headY + 0.006, 0],
    [1, 1.15, 1.04],
  );
  /*
    Clamped in world Y, which is the space `sphere` has already translated into.

    Passing the bare `HEAD_RADIUS * 0.42` clamped against a floor of 0.07 m --
    somewhere around the dealer's shins. No vertex of a head sitting at 1.45 m is
    below that, so nothing was flattened and the "band" stayed a complete sphere
    one and a bit head-radii across: the dealer's whole head was a green ball.
    The hair code above gets this right by clamping at the origin and translating
    afterwards; this one translates first, so the floor has to be offset too.
  */
  clampBelow(band, headY + DEALER_CAP_COVERAGE.lowerEdgeFromHeadCentre);
  visor.push(band);
  const brim = taper(HEAD_RADIUS * 0.95, HEAD_RADIUS * 0.95, 0.012, [0, headY + HEAD_RADIUS * 0.34, HEAD_RADIUS * 0.5], [1.15, 1, 0.7]);
  brim.rotateX(-0.22);
  visor.push(brim);

  const shirtGeometry = merged(shirt, ledger);
  const waistcoatGeometry = merged(waistcoat, ledger);
  const skinGeometryMerged = merged(skin, ledger);
  const visorGeometry = merged(visor, ledger);

  if (shirtGeometry) {
    body.add(new Mesh(shirtGeometry, ledger.track(new MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.8, metalness: 0 }))));
  }
  if (waistcoatGeometry) {
    body.add(new Mesh(waistcoatGeometry, ledger.track(new MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.76, metalness: 0 }))));
  }
  if (skinGeometryMerged) {
    body.add(new Mesh(skinGeometryMerged, ledger.track(new MeshStandardMaterial({ color: skinTone, roughness: 0.82, metalness: 0 }))));
  }
  if (visorGeometry) {
    const cap = new Mesh(visorGeometry, ledger.track(new MeshStandardMaterial({ color: 0x26324a, roughness: 0.86, metalness: 0 })));
    cap.name = "dealer-cap";
    body.add(cap);
  }
  const dealerFeatures = new Mesh(
    merged([
      // At the table camera's distance, flatter almond eyes and a compact
      // mouth read clearly without becoming dark bars wider than the face.
      sphere(0.014, [-0.052, headY + 0.018, HEAD_RADIUS * 0.89], [1.2, 0.36, 0.15]),
      sphere(0.014, [0.052, headY + 0.018, HEAD_RADIUS * 0.89], [1.2, 0.36, 0.15]),
      sphere(0.012, [0, headY - 0.06, HEAD_RADIUS * 0.93], [1.55, 0.24, 0.14]),
    ], ledger)!,
    ledger.track(new MeshLambertMaterial({ color: 0x30241f })),
  );
  dealerFeatures.name = "dealer-face-features";
  body.add(dealerFeatures);
  // A narrow tie is a useful card-room uniform cue and gives the dealer's
  // otherwise dark waistcoat a grounded, readable centre line.
  const tie = new Mesh(
    ledger.track(new BoxGeometry(0.030, 0.155, 0.014)),
    ledger.track(new MeshStandardMaterial({ color: 0x4b1f2a, roughness: 0.72, metalness: 0 })),
  );
  tie.name = "dealer-tie";
  tie.position.set(0, base + torsoHeight * 0.63, shoulder * 0.62 + 0.014);
  tie.rotation.z = Math.PI;
  body.add(tie);

  /*
    The arms hang off a shoulder pivot rather than being merged into the torso.

    They were part of the shirt mesh, which made the dealer a statue holding the
    dealing pose: a figure who deals every hand and sweeps every pot without ever
    moving is more conspicuous than no dealer at all. Re-centring the arm
    geometry on the shoulder line and parenting it to `arms` means the whole
    limb swings from the joint it would really swing from, so a reach is a
    rotation about a point rather than a group sliding through the torso.

    Both arms share one pivot on the body's centre line. A dealer works with the
    hands together -- gathering a pot, squaring a deck, pitching from a shoe --
    so the two arms move as one unit, and one pivot is both cheaper and closer
    to the pose than two independent shoulders would be.
  */
  arms.position.set(...DEALER_SHOULDER_PIVOT);
  const recentre = (parts: BufferGeometry[]) => {
    for (const part of parts) {
      part.translate(-DEALER_SHOULDER_PIVOT[0], -DEALER_SHOULDER_PIVOT[1], -DEALER_SHOULDER_PIVOT[2]);
    }
    return merged(parts, ledger);
  };
  const armShirtGeometry = recentre(armShirt);
  const armSkinGeometry = recentre(armSkin);
  if (armShirtGeometry) {
    arms.add(new Mesh(armShirtGeometry, ledger.track(new MeshLambertMaterial({ color: 0xe8e4dc }))));
  }
  if (armSkinGeometry) {
    arms.add(new Mesh(armSkinGeometry, ledger.track(new MeshLambertMaterial({ color: skinTone }))));
  }

  root.add(body, arms);
  // Dealer gestures currently rotate the shared `arms` assembly.  Keep the
  // same joint contract as player views so callers never receive a malformed
  // CharacterView while the dealer rig is upgraded independently.
  const leftShoulder = new Group();
  const rightShoulder = new Group();
  const leftElbow = new Group();
  const rightElbow = new Group();
  leftShoulder.name = "dealer-left-shoulder";
  rightShoulder.name = "dealer-right-shoulder";
  leftElbow.name = "dealer-left-elbow";
  rightElbow.name = "dealer-right-elbow";
  return { root, body, arms, leftShoulder, rightShoulder, leftElbow, rightElbow };
}

/** A simple upholstered chair, tinted from the room rather than the character. */
export function buildChair(
  seatColour: number,
  frameColour: number,
  ledger: SceneResourceLedger,
): Group {
  const chair = new Group();
  const seatMaterial = ledger.track(new MeshLambertMaterial({ color: seatColour }));
  const frameMaterial = ledger.track(new MeshLambertMaterial({ color: frameColour }));

  /*
    A slim pan and a thin backrest *behind* the occupant. The first version used a
    half-cylinder shell 0.56 m tall scaled across its depth, which came out as a
    barrel wrapped around the character and hid the torso completely -- the body
    was rendering the whole time, just occluded by its own chair.
  */
  const pan = ledger.track(new CylinderGeometry(0.25, 0.23, 0.07, 14));
  const panMesh = new Mesh(pan, seatMaterial);
  panMesh.position.y = 0.44;
  chair.add(panMesh);

  /*
    A curved tub back rather than a flat slab.

    The slab version was 0.44 x 0.48 x 0.055 standing square behind the seat,
    and from the neighbouring station -- which is where the hero actually sits --
    it presented its whole broad face to the camera and read as a coloured
    panel, not a chair. Half a cylinder open to the front wraps the occupant the
    way a card-room chair does, is seen edge-on from beside it, and cannot hide
    the torso because it only spans the rear 180 degrees.
  */
  const back = ledger.track(new CylinderGeometry(0.27, 0.25, 0.40, 16, 1, true, Math.PI / 2, Math.PI));
  const backMesh = new Mesh(back, seatMaterial);
  backMesh.position.set(0, 0.66, 0);
  chair.add(backMesh);

  // Rolled top edge, in the upholstery rather than the frame: in the frame
  // colour it read as a dark handlebar hooked over the back of the chair.
  const cap = ledger.track(new TorusGeometry(0.262, 0.016, 6, 18, Math.PI));
  const capMesh = new Mesh(cap, seatMaterial);
  capMesh.position.set(0, 0.86, 0);
  capMesh.rotation.x = Math.PI / 2;
  capMesh.rotation.z = Math.PI / 2;
  chair.add(capMesh);

  // Low armrests. They cost two boxes and give the seated silhouette the
  // horizontal line that reads as furniture rather than a stool.
  const armGeometry = ledger.track(new BoxGeometry(0.055, 0.045, 0.30));
  for (const side of [-1, 1]) {
    const arm = new Mesh(armGeometry, frameMaterial);
    arm.position.set(side * 0.255, 0.60, 0.05);
    chair.add(arm);
  }

  const post = ledger.track(new CylinderGeometry(0.05, 0.07, 0.40, 8));
  const postMesh = new Mesh(post, frameMaterial);
  postMesh.position.y = 0.2;
  chair.add(postMesh);

  return chair;
}
