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
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OpponentCharacter } from "../lib/opponentAppearance";
import {
  bodyProportions,
  faceProportions,
  hairParts,
  headCentreHeight,
  HEAD_RADIUS,
  TORSO_BASE_Y,
} from "./characterModel";
import type { SceneResourceLedger } from "./sceneResources";

export interface CharacterView {
  readonly root: Group;
  /** The clothed torso, so a lean/fold gesture can move the body only. */
  readonly body: Group;
  /** Forearm group that reaches toward the felt during an action. */
  readonly arms: Group;
}

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
  parts.push(sphere(
    HEAD_RADIUS,
    [0, headY, 0],
    [face.jaw, 1.14 / Math.max(0.85, face.chin), 1.04 * face.cheek * 0.92],
  ));
  parts.push(sphere(
    HEAD_RADIUS * 0.15 * face.brow,
    [0, headY + HEAD_RADIUS * 0.3, HEAD_RADIUS * 0.55],
    [2.1, 0.38, 0.42],
  ));
  parts.push(sphere(
    HEAD_RADIUS * 0.085 * face.nose,
    [0, headY - HEAD_RADIUS * 0.06, HEAD_RADIUS * 0.72],
    [0.85, 1.15, 1.2],
  ));
  /*
    No ears. At the seated camera a head is around ninety pixels tall, and ear
    spheres at that scale did not read as ears -- they joined the nose in a little
    cluster of balls around the jaw line, because looking down 27 degrees projects
    anything at head-centre height down toward the chin. Dropping them is a
    straight gain in readability and costs nothing anyone can see.
  */
  // Hands rest at the felt, which is where cards and chips are.
  for (const side of [-1, 1]) {
    parts.push(sphere(
      body.neckRadius * 0.8,
      [side * body.shoulderHalfWidth * 0.8, top - 0.3, 0.34],
      [1, 0.65, 1.25],
    ));
  }
  return parts;
}

/** The clothed torso, shoulders, and upper arms. */
function clothGeometry(character: OpponentCharacter): BufferGeometry[] {
  const body = bodyProportions(character.gender, character.body);
  const top = TORSO_BASE_Y + body.torsoHeight;
  const depthRatio = body.chestDepth / body.shoulderHalfWidth;
  const parts: BufferGeometry[] = [];

  parts.push(taper(
    body.shoulderHalfWidth,
    body.waistHalfWidth,
    body.torsoHeight,
    [0, TORSO_BASE_Y + body.torsoHeight / 2, 0],
    [1, 1, depthRatio],
  ));
  // Shoulder caps: the bare cone rim reads as armour without them.
  for (const side of [-1, 1]) {
    parts.push(sphere(
      body.shoulderHalfWidth * 0.3,
      [side * body.shoulderHalfWidth * 0.88, top - 0.028, 0],
      [1, 0.72, depthRatio * 1.05],
    ));
    parts.push(taper(
      body.neckRadius * 0.86,
      body.neckRadius * 0.94,
      0.28,
      [side * body.shoulderHalfWidth * 0.92, top - 0.16, 0.02],
    ));
    // Forearm angled down toward the felt: the pose a seated player holds.
    const forearm = taper(body.neckRadius * 0.7, body.neckRadius * 0.84, 0.3, [0, 0, 0]);
    forearm.rotateX(Math.PI / 2.35);
    forearm.translate(side * body.shoulderHalfWidth * 0.86, top - 0.3, 0.2);
    parts.push(forearm);
  }
  return parts;
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
  const hair = merged(hairGeometry(character), ledger);

  if (cloth) {
    body.add(new Mesh(cloth, ledger.track(new MeshLambertMaterial({
      color: character.outfit.base,
    }))));
  }
  if (skin) {
    body.add(new Mesh(skin, ledger.track(new MeshLambertMaterial({
      color: character.skinTone,
    }))));
  }
  if (hair) {
    body.add(new Mesh(hair, ledger.track(new MeshLambertMaterial({
      color: character.hairColor,
    }))));
  }

  root.add(body, arms);
  root.scale.setScalar(character.heightScale);
  return { root, body, arms };
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
  const torsoHeight = 0.54;
  // A dealer sits higher than the players: their chair is raised so they can
  // reach the middle of the felt.
  const base = 0.56;
  const top = base + torsoHeight;
  const headY = top + 0.06 + HEAD_RADIUS * 1.02;

  const shirt: BufferGeometry[] = [];
  const waistcoat: BufferGeometry[] = [];
  const skin: BufferGeometry[] = [];

  // White shirt torso, with the waistcoat as a slightly larger shell over its
  // front so both read at once.
  shirt.push(taper(shoulder, shoulder * 0.86, torsoHeight, [0, base + torsoHeight / 2, 0], [1, 1, 0.62]));
  waistcoat.push(taper(shoulder * 1.02, shoulder * 0.9, torsoHeight * 0.82, [0, base + torsoHeight * 0.44, 0.012], [1, 1, 0.58]));
  for (const side of [-1, 1]) {
    shirt.push(sphere(shoulder * 0.3, [side * shoulder * 0.88, top - 0.03, 0], [1, 0.72, 0.66]));
    // Both forearms reach in over the felt: the dealing pose.
    // Shorter and less horizontal than the first pass, where 0.34 m at nearly
    // 90 degrees read as two long tubes laid across the felt.
    /*
      The hand is placed at the *computed end* of the forearm rather than at a
      separately guessed point. Hard-coding both meant every tweak to the arm left
      the hands floating detached in mid-air beside it.
    */
    const forearmLength = 0.24;
    const forearmTilt = Math.PI / 2.9;
    const armX = side * shoulder * 0.66;
    const armY = top - 0.17;
    const armZ = 0.17;
    const forearm = taper(0.04, 0.047, forearmLength, [0, 0, 0]);
    forearm.rotateX(forearmTilt);
    forearm.translate(armX, armY, armZ);
    shirt.push(forearm);
    // Local +Y maps to (0, cos, sin) after a rotation about X, so the far end of
    // the cylinder is half its length along that direction.
    const reach = forearmLength / 2;
    skin.push(sphere(
      0.043,
      [armX, armY - Math.cos(forearmTilt) * reach, armZ + Math.sin(forearmTilt) * reach],
      [1, 0.62, 1.15],
    ));
  }
  skin.push(taper(0.05, 0.056, 0.06, [0, top + 0.03, 0]));
  skin.push(sphere(HEAD_RADIUS, [0, headY, 0], [0.98, 1.14, 1.02]));
  skin.push(sphere(HEAD_RADIUS * 0.09, [0, headY - HEAD_RADIUS * 0.06, HEAD_RADIUS * 0.72], [0.85, 1.1, 1.2]));

  // The visor: a dark band and a translucent-looking brim, the clearest single
  // "this one is the dealer" cue at a glance.
  const visor: BufferGeometry[] = [];
  const band = sphere(HEAD_RADIUS * 1.03, [0, headY + 0.004, 0], [1, 1.02, 1.02]);
  clampBelow(band, HEAD_RADIUS * 0.42);
  visor.push(band);
  const brim = taper(HEAD_RADIUS * 0.95, HEAD_RADIUS * 0.95, 0.012, [0, headY + HEAD_RADIUS * 0.34, HEAD_RADIUS * 0.5], [1.15, 1, 0.7]);
  brim.rotateX(-0.22);
  visor.push(brim);

  const shirtGeometry = merged(shirt, ledger);
  const waistcoatGeometry = merged(waistcoat, ledger);
  const skinGeometryMerged = merged(skin, ledger);
  const visorGeometry = merged(visor, ledger);

  if (shirtGeometry) {
    body.add(new Mesh(shirtGeometry, ledger.track(new MeshLambertMaterial({ color: 0xe8e4dc }))));
  }
  if (waistcoatGeometry) {
    body.add(new Mesh(waistcoatGeometry, ledger.track(new MeshLambertMaterial({ color: 0x1d1f26 }))));
  }
  if (skinGeometryMerged) {
    body.add(new Mesh(skinGeometryMerged, ledger.track(new MeshLambertMaterial({ color: skinTone }))));
  }
  if (visorGeometry) {
    body.add(new Mesh(visorGeometry, ledger.track(new MeshLambertMaterial({ color: 0x1f5e46 }))));
  }

  root.add(body, arms);
  return { root, body, arms };
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
  const pan = ledger.track(new CylinderGeometry(0.25, 0.23, 0.07, 12));
  const panMesh = new Mesh(pan, seatMaterial);
  panMesh.position.y = 0.44;
  chair.add(panMesh);

  const back = ledger.track(new BoxGeometry(0.44, 0.48, 0.055));
  const backMesh = new Mesh(back, seatMaterial);
  backMesh.position.set(0, 0.74, -0.27);
  chair.add(backMesh);

  const post = ledger.track(new CylinderGeometry(0.05, 0.07, 0.40, 8));
  const postMesh = new Mesh(post, frameMaterial);
  postMesh.position.y = 0.2;
  chair.add(postMesh);

  return chair;
}
