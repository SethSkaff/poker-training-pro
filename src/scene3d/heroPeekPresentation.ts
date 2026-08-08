import {
  cameraLensZoom,
  cameraPose,
  projectToViewport,
  seatWorldPoint,
  seatPoses,
  TABLE_HEIGHT,
  type SeatPose,
} from "./tableSceneModel";

export const HERO_PEEK_CARD_WIDTH = 0.088;
export const HERO_PEEK_CARD_LENGTH = 0.123;
export const HERO_PEEK_HINGE_DEGREES = 24;

/**
 * The hero station faces the table along local +Z. From that seated camera,
 * local +X projects to the viewer's left, so the texture's left edge belongs on
 * the mesh's positive-X edge. The vertical mapping is intentionally reversed:
 * local +Z is the far/top edge of the card and must sample the canvas top, not
 * the rotated duplicate index painted at the canvas bottom.
 */
export function heroPeekFaceUvForLocalPoint(
  localX: number,
  progress: number,
): readonly [number, number] {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return [
    localX < 0 ? 1 : 0,
    0.98 - clampedProgress * 0.96,
  ] as const;
}

/** The previously approved local offset of the first-person hand rig. */
export const HERO_PEEK_HAND_ROOT_OFFSET = {
  y: 0.012,
  z: -0.038,
} as const;

/**
 * Arm-chain landmarks relative to the hand root. This is the compact seated
 * rig used by the previous approved build: both palms stay low and forward,
 * with the right hand bracing the packet rather than crossing its faces.
 */
export const HERO_PEEK_HAND_RIG = {
  left: {
    shoulder: [-0.16, -0.16, -0.22] as const,
    elbow: [-0.12, -0.07, -0.13] as const,
    wrist: [-0.074, -0.002, -0.018] as const,
  },
  right: {
    shoulder: [0.16, -0.16, -0.22] as const,
    elbow: [0.12, -0.06, -0.11] as const,
    wrist: [0.054, 0.002, 0.038] as const,
  },
} as const;

export type InterfaceScale = "compact" | "standard" | "large" | "extra-large";

export interface ProjectedBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface HeroPeekProjectedLayout {
  readonly cardBounds: readonly ProjectedBounds[];
  readonly protectedIndexBounds: readonly ProjectedBounds[];
  readonly handBounds: readonly ProjectedBounds[];
  readonly handDepths: readonly number[];
  readonly cardFarEdgeDepth: number;
  readonly interfaceScale: InterfaceScale;
}

function bounds(points: readonly { xPercent: number; yPercent: number }[]): ProjectedBounds {
  return {
    xMin: Math.min(...points.map((point) => point.xPercent)),
    xMax: Math.max(...points.map((point) => point.xPercent)),
    yMin: Math.min(...points.map((point) => point.yPercent)),
    yMax: Math.max(...points.map((point) => point.yPercent)),
  };
}

function projectedBounds(
  points: readonly (readonly [number, number, number])[],
  pose: SeatPose,
  pan: number,
  cameraView: "standard" | "close" | "wide",
  wheelZoom: number,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedBounds {
  const camera = cameraPose(
    pan,
    pose.seat,
    viewportWidth / Math.max(1, viewportHeight),
    cameraLensZoom(cameraView, wheelZoom),
  );
  return bounds(points.map((point) => projectToViewport(
    seatWorldPoint(pose, point),
    camera,
    viewportWidth,
    viewportHeight,
  )));
}

function handVolumePoints(
  landmarks: readonly (readonly [number, number, number])[],
  radius = 0.023,
): readonly (readonly [number, number, number])[] {
  return landmarks.flatMap(([x, y, z]) => [
    [x - radius, y - radius, z - radius],
    [x + radius, y - radius, z - radius],
    [x - radius, y + radius, z + radius],
    [x + radius, y + radius, z + radius],
  ] as const);
}

function cardPoints(centerX: number, z: number): readonly (readonly [number, number, number])[] {
  return [
    [centerX - HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.003, z - HERO_PEEK_CARD_LENGTH / 2],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.003, z - HERO_PEEK_CARD_LENGTH / 2],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.027, z + HERO_PEEK_CARD_LENGTH / 2],
    [centerX - HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.027, z + HERO_PEEK_CARD_LENGTH / 2],
  ];
}

/**
 * Project the protected printed windows and every arm-chain landmark. The
 * renderer's first-person rig and this layout use the same authored landmarks;
 * tests can therefore reject an occluding pose before a packaged build exists.
 */
export function heroPeekProjectedLayout(options: {
  readonly pan: number;
  readonly cameraView: "standard" | "close" | "wide";
  readonly wheelZoom?: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly interfaceScale: InterfaceScale;
  readonly heroIndex?: number;
}): HeroPeekProjectedLayout {
  const pose = seatPoses(1, options.heroIndex ?? 0)[0];
  if (!pose) {
    return {
      cardBounds: [],
      protectedIndexBounds: [],
      handBounds: [],
      handDepths: [],
      cardFarEdgeDepth: 0,
      interfaceScale: options.interfaceScale,
    };
  }
  const z = 0;
  const cardCenters = [0.040, -0.040];
  const cards = cardCenters.map((x) => projectedBounds(
    cardPoints(x, z), pose, options.pan, options.cameraView, options.wheelZoom ?? 0,
    options.viewportWidth, options.viewportHeight,
  ));
  const protectedIndexBounds = cardCenters.map((centerX) => projectedBounds([
    [centerX + HERO_PEEK_CARD_WIDTH / 2 - 0.020, TABLE_HEIGHT + 0.004, z + 0.031],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.004, z + 0.031],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.022, z + 0.056],
    [centerX + HERO_PEEK_CARD_WIDTH / 2 - 0.020, TABLE_HEIGHT + 0.022, z + 0.056],
  ], pose, options.pan, options.cameraView, options.wheelZoom ?? 0,
  options.viewportWidth, options.viewportHeight));
  const root = [0, TABLE_HEIGHT + HERO_PEEK_HAND_ROOT_OFFSET.y, z + HERO_PEEK_HAND_ROOT_OFFSET.z] as const;
  const armLandmarks = [
    [HERO_PEEK_HAND_RIG.left.shoulder, HERO_PEEK_HAND_RIG.left.elbow, HERO_PEEK_HAND_RIG.left.wrist],
    [HERO_PEEK_HAND_RIG.right.shoulder, HERO_PEEK_HAND_RIG.right.elbow, HERO_PEEK_HAND_RIG.right.wrist],
  ].map((arm) => arm.map(([x, y, localZ]) => [x + root[0], TABLE_HEIGHT + HERO_PEEK_HAND_ROOT_OFFSET.y + y, localZ + root[2]] as const));
  const handBounds = [
    armLandmarks[0],
    armLandmarks[1],
  ].map((landmarks) => projectedBounds(
    handVolumePoints(landmarks),
    pose,
    options.pan,
    options.cameraView,
    options.wheelZoom ?? 0,
    options.viewportWidth,
    options.viewportHeight,
  ));
  return {
    cardBounds: cards,
    protectedIndexBounds,
    handBounds,
    handDepths: armLandmarks.map((arm) => arm[2][2]),
    cardFarEdgeDepth: z + HERO_PEEK_CARD_LENGTH / 2,
    interfaceScale: options.interfaceScale,
  };
}

export function projectedBoundsOverlap(left: ProjectedBounds, right: ProjectedBounds): boolean {
  return left.xMin < right.xMax && left.xMax > right.xMin
    && left.yMin < right.yMax && left.yMax > right.yMin;
}
