/**
 * The proportional system for a seated opponent, as pure numbers.
 *
 * This is the shipping counterpart to `tools/blender/build_characters.py`. The
 * Blender script builds the same library from the same proportions so the set can
 * be previewed and eyeballed as a whole, but the runtime does **not** load a
 * mesh: every shape here is a sphere or a tapered cylinder, which three.js has
 * natively, so the characters are built procedurally like the rest of the scene.
 *
 * That choice is deliberate. Shipping a glTF would add a loader to an already
 * large lazy chunk, put a binary through the asset-rights ledger (whose
 * `runtimeAssetExtensions` does not even cover `.glb`, so it would silently
 * bypass the gate), and introduce a fetch under a `default-src 'self'` CSP. None
 * of that buys anything while the geometry is primitive-composable.
 *
 * Measurements are metres in the seat's local frame with y=0 at the chair seat
 * pan, and the whole thing is arithmetic so the proportions can be tested
 * without a WebGL context.
 */

/** Shoulder half-width, chest depth, waist half-width, torso height, neck radius. */
export interface BodyProportions {
  readonly shoulderHalfWidth: number;
  readonly chestDepth: number;
  readonly waistHalfWidth: number;
  readonly torsoHeight: number;
  readonly neckRadius: number;
}

export const BODY_PROPORTIONS: Readonly<Record<string, BodyProportions>> = Object.freeze({
  "male:lean": { shoulderHalfWidth: 0.185, chestDepth: 0.115, waistHalfWidth: 0.140, torsoHeight: 0.520, neckRadius: 0.052 },
  "male:average": { shoulderHalfWidth: 0.205, chestDepth: 0.130, waistHalfWidth: 0.160, torsoHeight: 0.520, neckRadius: 0.056 },
  "male:stocky": { shoulderHalfWidth: 0.215, chestDepth: 0.150, waistHalfWidth: 0.190, torsoHeight: 0.505, neckRadius: 0.060 },
  "male:broad": { shoulderHalfWidth: 0.238, chestDepth: 0.152, waistHalfWidth: 0.192, torsoHeight: 0.530, neckRadius: 0.062 },
  "male:heavy": { shoulderHalfWidth: 0.240, chestDepth: 0.180, waistHalfWidth: 0.232, torsoHeight: 0.500, neckRadius: 0.064 },
  "female:slight": { shoulderHalfWidth: 0.165, chestDepth: 0.108, waistHalfWidth: 0.128, torsoHeight: 0.500, neckRadius: 0.046 },
  "female:average": { shoulderHalfWidth: 0.178, chestDepth: 0.120, waistHalfWidth: 0.142, torsoHeight: 0.505, neckRadius: 0.049 },
  "female:curvy": { shoulderHalfWidth: 0.192, chestDepth: 0.138, waistHalfWidth: 0.170, torsoHeight: 0.500, neckRadius: 0.051 },
});

/** Jaw width, cheek prominence, brow, nose, and chin multipliers. */
export interface FaceProportions {
  readonly jaw: number;
  readonly cheek: number;
  readonly brow: number;
  readonly nose: number;
  readonly chin: number;
}

export const FACE_PROPORTIONS: Readonly<Record<string, FaceProportions>> = Object.freeze({
  "broad-jaw": { jaw: 1.10, cheek: 1.15, brow: 1.12, nose: 1.05, chin: 1.20 },
  narrow: { jaw: 0.90, cheek: 0.92, brow: 0.95, nose: 1.05, chin: 0.88 },
  "soft-round": { jaw: 1.05, cheek: 0.85, brow: 0.82, nose: 0.90, chin: 0.92 },
  angular: { jaw: 0.97, cheek: 1.25, brow: 1.10, nose: 1.12, chin: 1.05 },
  "high-cheek": { jaw: 0.95, cheek: 1.32, brow: 0.92, nose: 0.95, chin: 0.90 },
  "heavy-brow": { jaw: 1.04, cheek: 1.00, brow: 1.35, nose: 1.10, chin: 1.02 },
});

/*
  Slightly smaller than the 0.098 first pass. With the table occluding the lower
  torso, a head that measures correctly against full shoulders still reads as
  oversized against the part of the body you can actually see.
*/
export const HEAD_RADIUS = 0.091;
/** Chair seat pan height; the torso is stacked from here. */
export const TORSO_BASE_Y = 0.50;

/**
 * The seated head centre, used by the composition solver's head envelope.
 *
 * Mirrors how `sceneCharacters` stacks the body: chair pan, torso, then a short
 * neck, then the head. Keep the two in step -- the solver reserves camera room
 * from this number, and when it disagreed with the rendered head by 0.14 m the
 * near seats kept needing hand-tuned framing margin.
 */
export const NECK_HEIGHT = 0.06;

export function headCentreHeight(body: BodyProportions, heightScale = 1): number {
  return (TORSO_BASE_Y + body.torsoHeight + NECK_HEIGHT + HEAD_RADIUS * 1.02) * heightScale;
}

/** The widest per-identity height scale `describeOpponentCharacter` can produce. */
export const MAX_HEIGHT_SCALE = 1.04;

/**
 * The highest head centre any identity can produce.
 *
 * The camera's depth solver reserves horizontal frame room for a near seat's
 * head, and it has to reserve it at the *real* height. When that constant was
 * hard-coded at 1.13 m it silently disagreed with these proportions -- a 0.50 m
 * chair pan plus a torso puts a seated head near 1.27 m -- so the solver was
 * fitting a head that was not where it thought. Deriving it here means the two
 * cannot drift apart again.
 */
export const MAX_SEATED_HEAD_HEIGHT = Object.values(BODY_PROPORTIONS).reduce(
  (highest, body) => Math.max(highest, headCentreHeight(body, MAX_HEIGHT_SCALE)),
  0,
);

/** Look up proportions for a presented gender and body family name. */
export function bodyProportions(gender: string, body: string): BodyProportions {
  return BODY_PROPORTIONS[`${gender}:${body}`] ?? BODY_PROPORTIONS["male:average"];
}

export function faceProportions(face: string): FaceProportions {
  return FACE_PROPORTIONS[face] ?? FACE_PROPORTIONS.narrow;
}

/**
 * Hair shells, as a list of primitive placements per style.
 *
 * A `cap` flattens everything below `floorY` so the shell cannot swallow the
 * face, which is the one thing that makes procedural hair read as a helmet.
 */
export type HairPart =
  | {
      readonly kind: "cap";
      readonly radiusScale: number;
      readonly scale: readonly [number, number, number];
      readonly offset: readonly [number, number, number];
      readonly floorY: number;
    }
  | {
      readonly kind: "blob";
      readonly radiusScale: number;
      readonly scale: readonly [number, number, number];
      readonly offset: readonly [number, number, number];
    }
  | {
      readonly kind: "strand";
      readonly radiusTop: number;
      readonly radiusBottom: number;
      readonly length: number;
      readonly offset: readonly [number, number, number];
      readonly tiltX: number;
    }
  /**
   * A band of overlapping locks hugging the skull.
   *
   * A `cap` on its own is a smooth shell, and a smooth shell is exactly what
   * makes procedural hair read as a moulded helmet however well it is coloured.
   * Real hair has a silhouette that breaks up -- it is the *edge* the eye reads,
   * not the surface. `count` ellipsoids around a latitude band, each with a
   * deterministic size and depth wobble, give that edge for a few dozen
   * triangles inside an already-merged mesh.
   */
  | {
      readonly kind: "locks";
      readonly count: number;
      /** Height on the skull, as a multiple of HEAD_RADIUS. */
      readonly latitude: number;
      readonly radiusScale: number;
      /** How far the band wraps, in radians, centred on the back of the head. */
      readonly arc: number;
      /** Outward push, as a multiple of HEAD_RADIUS. */
      readonly bulge: number;
      readonly seed: number;
    };

/** Deterministic per-lock wobble; two builds of one identity must be identical. */
export function lockJitter(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export const HAIR_PARTS: Readonly<Record<string, readonly HairPart[]>> = Object.freeze({
  "male:buzz": [
    { kind: "cap", radiusScale: 1.035, scale: [1, 1.02, 1.04], offset: [0, 0.006, 0], floorY: HEAD_RADIUS * 0.30 },
    { kind: "locks", count: 22, latitude: 0.34, radiusScale: 0.062, arc: 4.4, bulge: 0.009, seed: 131 },
  ],
  "male:short-side-part": [
    { kind: "cap", radiusScale: 1.06, scale: [1.02, 1.02, 1.03], offset: [0.008, 0.008, 0], floorY: HEAD_RADIUS * 0.26 },
    { kind: "blob", radiusScale: 0.22, scale: [1.5, 0.9, 0.55], offset: [-HEAD_RADIUS * 0.34, HEAD_RADIUS * 0.62, HEAD_RADIUS * 0.5] },
    { kind: "locks", count: 22, latitude: 0.42, radiusScale: 0.104, arc: 4.2, bulge: 0.027, seed: 11 },
  ],
  "male:textured-crop": [
    { kind: "cap", radiusScale: 1.07, scale: [1, 1.03, 1.04], offset: [0, 0.008, 0], floorY: HEAD_RADIUS * 0.28 },
    { kind: "blob", radiusScale: 0.18, scale: [1, 0.7, 1], offset: [-0.045, HEAD_RADIUS * 0.92, -HEAD_RADIUS * 0.3] },
    { kind: "blob", radiusScale: 0.18, scale: [1, 0.7, 1], offset: [0, HEAD_RADIUS * 0.95, -HEAD_RADIUS * 0.3] },
    { kind: "blob", radiusScale: 0.18, scale: [1, 0.7, 1], offset: [0.045, HEAD_RADIUS * 0.92, -HEAD_RADIUS * 0.3] },
    { kind: "locks", count: 26, latitude: 0.55, radiusScale: 0.099, arc: 5.4, bulge: 0.041, seed: 23 },
  ],
  "male:slick-back": [
    { kind: "cap", radiusScale: 1.055, scale: [1, 1.03, 1.08], offset: [0, 0.012, 0.022], floorY: HEAD_RADIUS * 0.26 },
    { kind: "locks", count: 18, latitude: 0.50, radiusScale: 0.083, arc: 3.0, bulge: 0.023, seed: 37 },
  ],
  // A faint scalp shell, so a bald head takes stubble tinting instead of showing
  // a hard skin/hair seam.
  "male:bald": [
    { kind: "cap", radiusScale: 1.008, scale: [1, 1.01, 1.02], offset: [0, 0.004, 0], floorY: HEAD_RADIUS * 0.40 },
  ],
  /*
    Note the negative Z on every strand. Blender is Z-up with +Y running back
    through the head, and porting those offsets to the renderer's Y-up frame
    silently turned "behind the head" into "in front of the face" -- the ponytail
    hung down over the nose like a limb. Behind is -Z here.
  */
  "female:ponytail": [
    { kind: "cap", radiusScale: 1.06, scale: [1.02, 1.03, 1.04], offset: [0, 0.008, 0], floorY: HEAD_RADIUS * 0.14 },
    { kind: "strand", radiusTop: 0.03, radiusBottom: 0.052, length: 0.24, offset: [0, -HEAD_RADIUS * 0.3, -HEAD_RADIUS * 0.9], tiltX: 0.3 },
    { kind: "locks", count: 24, latitude: 0.30, radiusScale: 0.088, arc: 4.6, bulge: 0.023, seed: 53 },
  ],
  "female:bob": [
    { kind: "cap", radiusScale: 1.09, scale: [1.05, 1.04, 1.05], offset: [0, 0.006, 0], floorY: -HEAD_RADIUS * 0.45 },
    { kind: "locks", count: 30, latitude: -0.35, radiusScale: 0.125, arc: 5.0, bulge: 0.050, seed: 71 },
    { kind: "locks", count: 26, latitude: 0.25, radiusScale: 0.104, arc: 5.0, bulge: 0.036, seed: 79 },
  ],
  "female:long-straight": [
    { kind: "cap", radiusScale: 1.08, scale: [1.04, 1.04, 1.05], offset: [0, 0.006, 0], floorY: -HEAD_RADIUS * 0.26 },
    { kind: "strand", radiusTop: 0.05, radiusBottom: 0.065, length: 0.30, offset: [-HEAD_RADIUS * 0.66, -HEAD_RADIUS * 1.35, -HEAD_RADIUS * 0.35], tiltX: 0 },
    { kind: "strand", radiusTop: 0.05, radiusBottom: 0.065, length: 0.30, offset: [HEAD_RADIUS * 0.66, -HEAD_RADIUS * 1.35, -HEAD_RADIUS * 0.35], tiltX: 0 },
    { kind: "locks", count: 28, latitude: -0.20, radiusScale: 0.114, arc: 4.8, bulge: 0.050, seed: 97 },
  ],
  "female:curly-shoulder": [
    { kind: "cap", radiusScale: 1.10, scale: [1.06, 1.05, 1.04], offset: [0, 0.008, 0], floorY: -HEAD_RADIUS * 0.18 },
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return {
        kind: "blob" as const,
        radiusScale: 0.20,
        scale: [1, 1, 1] as readonly [number, number, number],
        offset: [
          Math.sin(angle) * HEAD_RADIUS * 0.95,
          -HEAD_RADIUS * (0.85 + 0.3 * ((index % 3) / 3)),
          Math.cos(angle) * HEAD_RADIUS * 0.5 - HEAD_RADIUS * 0.62,
        ] as readonly [number, number, number],
      };
    }),
  ],
  "female:top-knot": [
    { kind: "cap", radiusScale: 1.05, scale: [1.02, 1.03, 1.04], offset: [0, 0.006, 0], floorY: HEAD_RADIUS * 0.12 },
    { kind: "blob", radiusScale: 0.30, scale: [1, 0.85, 1], offset: [0, HEAD_RADIUS * 1.02, HEAD_RADIUS * 0.1] },
    { kind: "locks", count: 20, latitude: 0.55, radiusScale: 0.078, arc: 3.6, bulge: 0.023, seed: 113 },
  ],
});

export function hairParts(gender: string, style: string): readonly HairPart[] {
  return HAIR_PARTS[`${gender}:${style}`] ?? [];
}
