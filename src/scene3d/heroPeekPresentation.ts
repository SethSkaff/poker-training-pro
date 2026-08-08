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
/** The planted portion remains under the thumbs; the rest rises into view. */
export const HERO_PEEK_CARD_PLANTED_FRACTION = 0.35;
export const HERO_PEEK_CARD_EXPOSED_FRACTION = 1 - HERO_PEEK_CARD_PLANTED_FRACTION;
/** A steep, readable curl; 45° left the printed half edge-on to the camera. */
export const HERO_PEEK_HINGE_DEGREES = 78;
/** Air gap above the felt used by the elbow anchors and wrist contacts. */
export const HERO_PEEK_TABLE_CLEARANCE = 0.006;

/**
 * The exposed surface is the underside of a face-down card.  Looking at that
 * underside from the seated camera reverses the top-face U direction, so this
 * deliberately mirrors the authored board UV once to make the printed rank
 * read normally in the actual camera.  V still follows the board's near-to-far
 * direction; the peek face consumes the near 0..0.65 portion while the back
 * remains planted.
 */
export function heroPeekFaceUvForLocalPoint(
  localX: number,
  progress: number,
): readonly [number, number] {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return [
    localX < 0 ? 0 : 1,
    0.02 + clampedProgress * 0.96,
  ] as const;
}

/** Local offset of the first-person hand rig from the hero's card packet. */
export const HERO_PEEK_HAND_ROOT_OFFSET = {
  y: 0.014,
  z: 0,
} as const;

/**
 * Arm-chain landmarks relative to the hand root. The elbow anchors are above
 * the felt, which gives the forearms a physical point of support instead of
 * letting their cylinders pass through the table. The left wrist is placed at
 * the card edge with a millimetre-scale clearance; the right wrist stays behind
 * the raised packet.
 */
export const HERO_PEEK_HAND_RIG = {
  left: {
    shoulder: [0.23, 0.22, -0.24] as const,
    elbow: [0.13, 0.018, -0.08] as const,
    wrist: [0.095, 0.026, 0.018] as const,
  },
  right: {
    shoulder: [-0.21, 0.22, -0.24] as const,
    elbow: [-0.11, 0.018, -0.055] as const,
    wrist: [-0.045, 0.032, 0.078] as const,
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

function boxVolumePoints(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
  return [
    [minimum[0], minimum[1], minimum[2]],
    [minimum[0], minimum[1], maximum[2]],
    [minimum[0], maximum[1], minimum[2]],
    [minimum[0], maximum[1], maximum[2]],
    [maximum[0], minimum[1], minimum[2]],
    [maximum[0], minimum[1], maximum[2]],
    [maximum[0], maximum[1], minimum[2]],
    [maximum[0], maximum[1], maximum[2]],
  ];
}

function cardPoints(centerX: number, z: number): readonly (readonly [number, number, number])[] {
  const farEdge = z + HERO_PEEK_CARD_LENGTH / 2;
  const hinge = farEdge - HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_PLANTED_FRACTION;
  const angle = HERO_PEEK_HINGE_DEGREES * Math.PI / 180;
  const nearEdgeDistance = HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_EXPOSED_FRACTION;
  const nearEdgeY = TABLE_HEIGHT + 0.002 + nearEdgeDistance * Math.sin(angle);
  const nearEdgeZ = hinge - nearEdgeDistance * Math.cos(angle);
  return [
    [centerX - HERO_PEEK_CARD_WIDTH / 2, nearEdgeY, nearEdgeZ],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, nearEdgeY, nearEdgeZ],
    [centerX + HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.003, farEdge],
    [centerX - HERO_PEEK_CARD_WIDTH / 2, TABLE_HEIGHT + 0.003, farEdge],
  ];
}

/**
 * Project the protected printed windows and conservative hand volumes. The
 * arms may cross the same screen region on their way in from below frame, but
 * only the wrist/palm/fingers can occlude a card and are audited here.
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
    [centerX + 0.012, TABLE_HEIGHT + 0.058, z - 0.012],
    [centerX + 0.030, TABLE_HEIGHT + 0.058, z - 0.012],
    [centerX + 0.030, TABLE_HEIGHT + 0.082, z - 0.025],
    [centerX + 0.012, TABLE_HEIGHT + 0.082, z - 0.025],
  ], pose, options.pan, options.cameraView, options.wheelZoom ?? 0,
  options.viewportWidth, options.viewportHeight));
  const root = [0, TABLE_HEIGHT + HERO_PEEK_HAND_ROOT_OFFSET.y, z + HERO_PEEK_HAND_ROOT_OFFSET.z] as const;
  const armLandmarks = [
    [HERO_PEEK_HAND_RIG.left.shoulder, HERO_PEEK_HAND_RIG.left.elbow, HERO_PEEK_HAND_RIG.left.wrist],
    [HERO_PEEK_HAND_RIG.right.shoulder, HERO_PEEK_HAND_RIG.right.elbow, HERO_PEEK_HAND_RIG.right.wrist],
  ].map((arm) => arm.map(([x, y, localZ]) => [x + root[0], TABLE_HEIGHT + HERO_PEEK_HAND_ROOT_OFFSET.y + y, localZ + root[2]] as const));
  const handVolumes = [
    // Left palm/fingers touch the packet's local +X edge without entering its
    // protected printed corner.
    boxVolumePoints([0.084, 0.006, -0.047], [0.118, 0.058, 0.040]),
    // Right palm is behind the packet; this includes its low centre thumb.
    boxVolumePoints([-0.122, -0.004, 0.010], [0.012, 0.060, 0.116]),
  ].map((volume) => volume.map(([x, y, localZ]) => [
    x + root[0],
    TABLE_HEIGHT + HERO_PEEK_HAND_ROOT_OFFSET.y + y,
    localZ + root[2],
  ] as const));
  const handBounds = handVolumes.map((volume) => projectedBounds(
    volume,
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
