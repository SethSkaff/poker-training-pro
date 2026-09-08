/** Blender-authored modular avatars; existing gesture pivots remain authoritative. */
import {
  DoubleSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  RepeatWrapping,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { foregroundPart, type ForegroundPart } from "./foregroundLibrary";
import { tableMeshGeometry } from "./tableGeometryLibrary";
import { describeOpponentCharacter } from "../lib/opponentAppearance";
import type { OpponentCharacter } from "../lib/opponentAppearance";
import {
  bodyProportions,
  headCentreHeight,
  HEAD_RADIUS,
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


function fabricMaterial(
  outfit: OpponentCharacter["outfit"],
  ledger: SceneResourceLedger,
): MeshStandardMaterial {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const value = 233 + ((x * 17 + y * 31) % 13) + ((x + y) % 2) * 5;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  const texture = ledger.track(new DataTexture(pixels, size, size));
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.needsUpdate = true;
  return ledger.track(new MeshStandardMaterial({ color: outfit.base, map: texture,
    roughness: 0.86, metalness: 0, side: DoubleSide }));
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
  const geometry = foregroundPart("limb/sleeve");
  geometry.scale(radiusBottom, length, radiusBottom);
  geometry.translate(0, -length / 2, 0);
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


function buildArticulatedArm(
  body: BodyProportions,
  side: number,
  outfitColour: string,
  skinColour: string,
  ledger: SceneResourceLedger,
): { shoulder: Group; elbow: Group } {
  const { shoulder: shoulderPoint, elbow: elbowPoint, hand: handPoint } = armJoints(body, side);
  const shoulder = new Group();
  // In the station frame +Z points inward, so screen/anatomical left is +X.
  shoulder.name = side > 0 ? "left-shoulder" : "right-shoulder";
  shoulder.position.set(...shoulderPoint);
  const elbow = new Group();
  elbow.name = side > 0 ? "left-elbow" : "right-elbow";
  const upper = new Mesh(
    ledger.track(limb([0, 0, 0], [
      elbowPoint[0] - shoulderPoint[0], elbowPoint[1] - shoulderPoint[1], elbowPoint[2] - shoulderPoint[2],
    ], body.neckRadius * 0.80, body.neckRadius * 0.92)),
    ledger.track(new MeshStandardMaterial({ color: outfitColour, roughness: 0.78, metalness: 0 })),
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
    ledger.track(new MeshStandardMaterial({ color: outfitColour, roughness: 0.78, metalness: 0 })),
  );
  elbow.add(forearm);
  const hand = new Mesh(ledger.track(tableMeshGeometry("hand/peek")),
    ledger.track(new MeshStandardMaterial({color:skinColour,roughness:.8})));
  hand.name = side < 0 ? "left-hand" : "right-hand";
  hand.scale.set(side * .68,.68,.68);
  hand.position.set(forearmVector[0],forearmVector[1],forearmVector[2]);
  elbow.add(hand);
  shoulder.add(elbow);
  return { shoulder, elbow };
}


/** Instantiate the original Blender kit while retaining the existing joint graph. */
function authoredMesh(part: ForegroundPart, color: string | number, ledger: SceneResourceLedger, name = part): Mesh {
  const mesh = new Mesh(ledger.track(foregroundPart(part)), ledger.track(new MeshStandardMaterial({
    color, roughness: 0.83, metalness: 0, side: DoubleSide,
  })));
  mesh.name = name;
  return mesh;
}

export function buildCharacter(character: OpponentCharacter, ledger: SceneResourceLedger): CharacterView {
  const root = new Group(), body = new Group(), arms = new Group();
  const shape = bodyProportions(character.gender, character.body);
  const headY = headCentreHeight(shape);
  const sx = shape.shoulderHalfWidth / 0.205, sy = shape.torsoHeight / 0.52, sz = shape.chestDepth / 0.130;
  const garment = authoredMesh(`top/${character.outfit.name}`, character.outfit.base, ledger, "garment-base");
  garment.material = fabricMaterial(character.outfit, ledger);
  const construction = authoredMesh(`detail/${character.outfit.name}`, character.outfit.trim, ledger, "garment-construction");
  const hem = authoredMesh("top/hem", character.outfit.trim, ledger, "garment-trim");
  for (const item of [garment, construction, hem]) {
    item.scale.set(sx, sy, sz); item.position.y = TORSO_BASE_Y; body.add(item);
  }
  const neck = authoredMesh("neck", character.skinTone, ledger);
  neck.position.y = TORSO_BASE_Y + shape.torsoHeight;
  body.add(neck);
  const head = authoredMesh(`face/${character.face}`, character.skinTone, ledger, "avatar-head");
  head.position.y = headY; body.add(head);
  for (const [part, color, name] of [
    ["eyes/white", "#d4cbbd", "eye-sclera"],
    ["eyes/iris", character.eyeColor ?? "#5b4935", "eye-iris"],
    ["face/features", "#30251f", "face-features"],
    ["face/lips", new Color(character.skinTone).lerp(new Color("#914f49"), 0.25).getHex(), "face-lids-lips"],
  ] as const) {
    const feature = authoredMesh(part, color, ledger, name);
    feature.position.y = headY; body.add(feature);
  }
  if (character.hairStyle !== "bald") {
    const hair = authoredMesh(`hair/${character.hairStyle}` as ForegroundPart, character.hairColor, ledger, "avatar-hair");
    hair.position.y = headY; body.add(hair);
  }
  if (character.facialHair && character.facialHair !== "none") {
    const beard = foregroundPart(`face/${character.face}`);
    // Select the lower frontal surface; fitted to the exact selected face.
    const pos = beard.getAttribute("position");
    const index = beard.getIndex()!; const kept: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i+1), index.getX(i+2)];
      if (ids.every(v => pos.getY(v) < -0.047 && pos.getZ(v) > 0.028
        && (character.facialHair !== "goatee" || Math.abs(pos.getX(v)) < 0.030))) kept.push(...ids);
    }
    beard.setIndex(kept); beard.scale(1.006, 1.006, 1.009);
    const facialHair = new Mesh(ledger.track(beard), ledger.track(new MeshStandardMaterial({color: character.hairColor, roughness: 1, side: DoubleSide})));
    facialHair.name = "facial-hair"; facialHair.position.y = headY; body.add(facialHair);
  }
  if (character.mole != null) {
    const locations = [[-.053,-.032,.067],[.043,-.048,.071],[-.025,.057,.074]];
    const spot = locations[character.mole % locations.length];
    const mole = new Mesh(ledger.track(new SphereGeometry(.0014,8,6)), ledger.track(new MeshStandardMaterial({color: 0x604438, roughness: 1})));
    mole.position.set(spot[0],headY+spot[1],spot[2]); body.add(mole);
  }
  const legs = authoredMesh("body/legs", "#242830", ledger, "seated-legs");
  legs.scale.x = sx; root.add(legs);
  const left = buildArticulatedArm(shape, -1, character.outfit.base, character.skinTone, ledger);
  const right = buildArticulatedArm(shape, 1, character.outfit.base, character.skinTone, ledger);
  if (character.outfit.name === "polo" || character.outfit.name === "tee") {
    for (const arm of [left,right]) {
      const forearm = arm.elbow.children[0] as Mesh;
      forearm.name = "exposed-forearm";
      (forearm.material as MeshStandardMaterial).color.set(character.skinTone);
    }
  }
  arms.add(left.shoulder,right.shoulder); root.add(body,arms); root.scale.setScalar(character.heightScale);
  return {root,body,arms,leftShoulder:left.shoulder,rightShoulder:right.shoulder,leftElbow:left.elbow,rightElbow:right.elbow};
}

export function buildDealer(skinTone: string, ledger: SceneResourceLedger): CharacterView {
  const character = {...describeOpponentCharacter("house-dealer"), gender: "male" as const, body: "average", skinTone,
    face: "angular" as const, hairStyle: "short-side-part", hairColor: "#31251f", facialHair: "none" as const,
    outfit: {name: "waistcoat",base: "#26303b",trim: "#c0b9a9"} as OpponentCharacter["outfit"],heightScale: 1,mole: null};
  const view = buildCharacter(character,ledger);
  // Keep the original elevated torso and shared shoulder pivot used by the
  // light-speed dealer choreography. Only the authored visual meshes change.
  view.body.position.y = 0.08;
  view.arms.clear(); view.arms.position.set(...DEALER_SHOULDER_PIVOT);
  view.body.getObjectByName("avatar-hair")!.name = "dealer-cap";
  view.body.getObjectByName("face-features")!.name = "dealer-face-features";
  const tie = new Mesh(ledger.track(new CylinderGeometry(.011,.017,.15,4)),ledger.track(new MeshStandardMaterial({color:0x763943,roughness:.8})));
  tie.name="dealer-tie";tie.position.set(0,.89,.137); view.body.add(tie);
  for (const side of [-1,1]) {
    const a=[side*.215*.88,DEALER_SHOULDER_PIVOT[1],.02] as const;
    const b=[side===1?.245:side*.215*.76,.90,.17] as const;
    const c=[side===1?.30:side*.215*.52,DEALER_HAND_REST[1],DEALER_HAND_REST[2]] as const;
    const sleeve=merged([limb(a,b,.044,.050),limb(b,c,.036,.048)],ledger)!;
    sleeve.translate(0,-DEALER_SHOULDER_PIVOT[1],-DEALER_SHOULDER_PIVOT[2]);
    view.arms.add(new Mesh(sleeve,ledger.track(new MeshStandardMaterial({color:0xdedbd2,roughness:.86}))));
    const hand = new Mesh(ledger.track(tableMeshGeometry("hand/peek")),ledger.track(new MeshStandardMaterial({color:skinTone,roughness:.8})));
    hand.name=side===1?"dealer-left-hand":"dealer-right-hand";hand.scale.set(side*.72,.72,.72);
    hand.position.set(c[0],c[1]-DEALER_SHOULDER_PIVOT[1],c[2]-DEALER_SHOULDER_PIVOT[2]);view.arms.add(hand);
  }
  return view;
}

export function buildChair(seatColour: number, frameColour: number, ledger: SceneResourceLedger): Group {
  const chair = new Group();
  chair.add(authoredMesh("chair/upholstery", 0x282d30, ledger));
  const frame=authoredMesh("chair/frame", 0x444c50, ledger);
  (frame.material as MeshStandardMaterial).metalness=.65;
  (frame.material as MeshStandardMaterial).roughness=.36;
  chair.add(frame,authoredMesh("chair/piping",0x9b8b6b,ledger));
  return chair;
}
