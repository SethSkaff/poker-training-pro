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
  if (!pose) return { cardBounds: [], protectedIndexBounds: [], handBounds: [], interfaceScale: options.interfaceScale };
  const z = -0.006;
  const cardCenters = [0.040, -0.040];
  const cards = cardCenters.map((x) => projectedBounds(
    cardPoints(x, z), pose, options.pan, options.cameraView, options.wheelZoom ?? 0,
    options.viewportWidth, options.viewportHeight,
  ));
  const protectedIndexBounds = cardCenters.map((centerX) => projectedBounds([
    [centerX - HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.004, z + 0.031],
    [centerX - HERO_PEEK_CARD_WIDTH / 2 + 0.020, TABLE_HEIGHT + 0.004, z + 0.031],
    [centerX - HERO_PEEK_CARD_WIDTH / 2 + 0.020, TABLE_HEIGHT + 0.022, z + 0.056],
    [centerX - HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.022, z + 0.056],
  ], pose, options.pan, options.cameraView, options.wheelZoom ?? 0,
  options.viewportWidth, options.viewportHeight));
  const rigRoot: readonly [number, number, number] = [0, TABLE_HEIGHT + 0.012, -0.038];
  const armLandmarks: readonly (readonly [number, number, number])[] = [
    [-0.16, TABLE_HEIGHT - 0.148, -0.258], [-0.12, TABLE_HEIGHT - 0.058, -0.168], [-0.074, TABLE_HEIGHT + 0.010, -0.056],
    [0.16, TABLE_HEIGHT - 0.148, -0.258], [0.12, TABLE_HEIGHT - 0.048, -0.148], [0.054, TABLE_HEIGHT + 0.014, 0.000],
    [-0.074, TABLE_HEIGHT + 0.019, -0.036], [0.054, TABLE_HEIGHT + 0.019, 0.014],
  ];
  const handBounds = [
    armLandmarks.slice(0, 3),
    armLandmarks.slice(3, 6),
  ].map((landmarks) => projectedBounds(landmarks, pose, options.pan, options.cameraView, options.wheelZoom ?? 0, options.viewportWidth, options.viewportHeight));
  void rigRoot;
  return { cardBounds: cards, protectedIndexBounds, handBounds, interfaceScale: options.interfaceScale };
}

export function projectedBoundsOverlap(left: ProjectedBounds, right: ProjectedBounds): boolean {
  return left.xMin < right.xMax && left.xMax > right.xMin
    && left.yMin < right.yMax && left.yMax > right.yMin;
}
