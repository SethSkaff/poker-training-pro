import {
  cameraLensZoom,
  cameraPose,
  projectToViewport,
  seatLocalPoint,
  seatWorldPoint,
  seatPoses,
  TABLE_HEIGHT,
  type SeatPose,
} from "./tableSceneModel";
import { HOLE_CARD_HALF_SPREAD_METRES } from "./dealChoreography";

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

export interface ProjectedPoint {
  readonly xPercent: number;
  readonly yPercent: number;
}

/**
 * The CSS-pixel hit target for the two physical hero cards.
 *
 * The polygons remain in scene-viewport percentages so the same projection can
 * position the semantic DOM button and validate a pointer without involving the
 * WebGL drawing-buffer size (which is device-pixel-ratio dependent).
 */
export interface HeroHoleCardProjectedHitTarget {
  readonly cardPolygons: readonly (readonly ProjectedPoint[])[];
  /** Projected face strips used for exact point containment. */
  readonly hitPolygons: readonly (readonly ProjectedPoint[])[];
  readonly bounds: ProjectedBounds | undefined;
}

export interface CssViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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

/** Renderer and DOM projection share this exact seat-local placement contract. */
export const HERO_HOLE_CARD_PLACEMENT = {
  restingSpread: HOLE_CARD_HALF_SPREAD_METRES,
  squeezedSpread: 0.040,
  squeezedYOffset: 0.003,
  squeezedZOffset: -0.006,
  squeezedYaw: 0.025,
} as const;
const AUTHORED_CARD_CORNER_RADIUS = 0.008;
const AUTHORED_CARD_THICKNESS = 0.0035;

/** The authored card's rounded top-face perimeter in card-local coordinates. */
function restingCardPerimeter(): readonly (readonly [number, number, number])[] {
  const halfWidth = HERO_PEEK_CARD_WIDTH / 2;
  const halfLength = HERO_PEEK_CARD_LENGTH / 2;
  const cornerX = halfWidth - AUTHORED_CARD_CORNER_RADIUS;
  const cornerZ = halfLength - AUTHORED_CARD_CORNER_RADIUS;
  const points: Array<readonly [number, number, number]> = [];
  for (const [centreX, centreZ, start] of [
    [cornerX, cornerZ, 0],
    [-cornerX, cornerZ, Math.PI / 2],
    [-cornerX, -cornerZ, Math.PI],
    [cornerX, -cornerZ, Math.PI * 1.5],
  ] as const) {
    for (let step = 0; step <= 4; step += 1) {
      const angle = start + Math.PI / 2 * step / 4;
      points.push([
        centreX + Math.cos(angle) * AUTHORED_CARD_CORNER_RADIUS,
        AUTHORED_CARD_THICKNESS / 2,
        centreZ + Math.sin(angle) * AUTHORED_CARD_CORNER_RADIUS,
      ]);
    }
  }
  return points;
}

/**
 * Outer silhouette of the exact bent mesh built by `heroPeekCardGeometry`.
 * Twelve side samples match the renderer's twelve flexible strips; including
 * the planted far edge keeps a second click on the raised physical card valid.
 */
function squeezedCardPerimeter(): readonly (readonly [number, number, number])[] {
  const halfWidth = HERO_PEEK_CARD_WIDTH / 2;
  const farEdge = HERO_PEEK_CARD_LENGTH / 2;
  const hinge = farEdge - HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_PLANTED_FRACTION;
  const exposedLength = HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_EXPOSED_FRACTION;
  const hingeRadians = HERO_PEEK_HINGE_DEGREES * Math.PI / 180;
  const edge = (x: number, progress: number): readonly [number, number, number] => {
    const distanceFromHinge = exposedLength * (1 - progress);
    const angle = hingeRadians * (1 - progress);
    return [
      x,
      0.002 + distanceFromHinge * Math.sin(angle),
      hinge - distanceFromHinge * Math.cos(angle),
    ];
  };
  const left = Array.from({ length: 13 }, (_, row) => edge(-halfWidth, row / 12));
  const right = Array.from({ length: 13 }, (_, row) => edge(halfWidth, row / 12));
  return [
    ...left,
    [-halfWidth, 0.002, farEdge],
    [halfWidth, 0.002, farEdge],
    ...right.reverse(),
  ];
}

/** Individual rendered surfaces avoid treating a folded projection as one self-intersecting polygon. */
function squeezedCardSurfacePolygons(): readonly (readonly (readonly [number, number, number])[])[] {
  const halfWidth = HERO_PEEK_CARD_WIDTH / 2;
  const farEdge = HERO_PEEK_CARD_LENGTH / 2;
  const hinge = farEdge - HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_PLANTED_FRACTION;
  const exposedLength = HERO_PEEK_CARD_LENGTH * HERO_PEEK_CARD_EXPOSED_FRACTION;
  const hingeRadians = HERO_PEEK_HINGE_DEGREES * Math.PI / 180;
  const edge = (x: number, progress: number): readonly [number, number, number] => {
    const distanceFromHinge = exposedLength * (1 - progress);
    const angle = hingeRadians * (1 - progress);
    return [
      x,
      0.002 + distanceFromHinge * Math.sin(angle),
      hinge - distanceFromHinge * Math.cos(angle),
    ];
  };
  const strips = Array.from({ length: 12 }, (_, row) => {
    const start = row / 12;
    const end = (row + 1) / 12;
    return [
      edge(-halfWidth, start),
      edge(halfWidth, start),
      edge(halfWidth, end),
      edge(-halfWidth, end),
    ] as const;
  });
  return [
    ...strips,
    [
      [-halfWidth, 0.002, hinge],
      [halfWidth, 0.002, hinge],
      [halfWidth, 0.002, farEdge],
      [-halfWidth, 0.002, farEdge],
    ],
  ];
}

function rotateCardPoint(
  point: readonly [number, number, number],
  yaw: number,
): readonly [number, number, number] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    point[0] * cos + point[2] * sin,
    point[1],
    -point[0] * sin + point[2] * cos,
  ];
}

/**
 * Project the physical, renderer-owned hero cards into the CSS viewport.
 *
 * `camera` accepts the renderer's current interpolated frame. When it is not
 * available yet, the same pure camera model supplies the initial frame. Card
 * centres and squeeze offsets mirror `updateSeat`, while every perimeter point
 * passes through the station root's Y rotation before perspective projection.
 */
export function heroHoleCardProjectedHitTarget(options: {
  readonly pan: number;
  readonly cameraView: "standard" | "close" | "wide";
  readonly wheelZoom?: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly heroIndex?: number;
  readonly peeked?: boolean;
  readonly cardCount?: number;
  readonly camera?: ReturnType<typeof cameraPose>;
}): HeroHoleCardProjectedHitTarget {
  if (options.viewportWidth <= 0 || options.viewportHeight <= 0) {
    return { cardPolygons: [], hitPolygons: [], bounds: undefined };
  }
  const heroIndex = options.heroIndex ?? 0;
  const pose = seatPoses(1, heroIndex)[0];
  if (!pose) return { cardPolygons: [], hitPolygons: [], bounds: undefined };
  const camera = options.camera ?? cameraPose(
    options.pan,
    heroIndex,
    options.viewportWidth / options.viewportHeight,
    cameraLensZoom(options.cameraView, options.wheelZoom ?? 0),
  );
  const peeked = options.peeked ?? false;
  const cardCount = Math.max(0, Math.min(2, Math.floor(options.cardCount ?? 2)));
  const spread = peeked
    ? HERO_HOLE_CARD_PLACEMENT.squeezedSpread
    : HERO_HOLE_CARD_PLACEMENT.restingSpread;
  const base = seatLocalPoint(pose, pose.feltPosition);
  const perimeter = peeked ? squeezedCardPerimeter() : restingCardPerimeter();
  const surfacePolygons = peeked ? squeezedCardSurfacePolygons() : [perimeter];
  const projectedCards = Array.from({ length: cardCount }, (_, index) => {
    const yaw = peeked
      ? (index === 0 ? HERO_HOLE_CARD_PLACEMENT.squeezedYaw : -HERO_HOLE_CARD_PLACEMENT.squeezedYaw)
      : 0;
    const centre = [
      base[0] + (index === 0 ? spread : -spread),
      base[1] + (peeked ? HERO_HOLE_CARD_PLACEMENT.squeezedYOffset : 0),
      base[2] + (peeked ? HERO_HOLE_CARD_PLACEMENT.squeezedZOffset : 0),
    ] as const;
    const projectPoint = (point: readonly [number, number, number]): ProjectedPoint => {
      const rotated = rotateCardPoint(point, yaw);
      const projected = projectToViewport(
        seatWorldPoint(pose, [
          centre[0] + rotated[0],
          centre[1] + rotated[1],
          centre[2] + rotated[2],
        ]),
        camera,
        options.viewportWidth,
        options.viewportHeight,
      );
      return { xPercent: projected.xPercent, yPercent: projected.yPercent };
    };
    return {
      outline: perimeter.map(projectPoint),
      surfaces: surfacePolygons.map((surface) => surface.map(projectPoint)),
    };
  });
  const cardPolygons = projectedCards.map((card) => card.outline);
  const hitPolygons = projectedCards.flatMap((card) => card.surfaces);
  const points = cardPolygons.flat();
  return {
    cardPolygons,
    hitPolygons,
    bounds: points.length > 0 ? bounds(points) : undefined,
  };
}

/** Convert browser `clientX/Y` CSS pixels into the canvas parent's percentage space. */
export function sceneClientPointToViewportPercent(
  clientX: number,
  clientY: number,
  viewport: CssViewportRect,
): ProjectedPoint | undefined {
  if (viewport.width <= 0 || viewport.height <= 0) return undefined;
  return {
    xPercent: (clientX - viewport.left) / viewport.width * 100,
    yPercent: (clientY - viewport.top) / viewport.height * 100,
  };
}

function pointOnSegment(point: ProjectedPoint, start: ProjectedPoint, end: ProjectedPoint): boolean {
  const lengthSquared = (end.xPercent - start.xPercent) ** 2
    + (end.yPercent - start.yPercent) ** 2;
  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(
      point.xPercent - start.xPercent,
      point.yPercent - start.yPercent,
    ) <= 1e-7;
  }
  const cross = (point.yPercent - start.yPercent) * (end.xPercent - start.xPercent)
    - (point.xPercent - start.xPercent) * (end.yPercent - start.yPercent);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (point.xPercent - start.xPercent) * (end.xPercent - start.xPercent)
    + (point.yPercent - start.yPercent) * (end.yPercent - start.yPercent);
  if (dot < 0) return false;
  return dot <= lengthSquared;
}

function pointInPolygon(point: ProjectedPoint, polygon: readonly ProjectedPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (start.yPercent > point.yPercent) !== (end.yPercent > point.yPercent)
      && point.xPercent < (end.xPercent - start.xPercent)
        * (point.yPercent - start.yPercent)
        / (end.yPercent - start.yPercent)
        + start.xPercent;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * True only when the browser pointer lands on a projected physical card.
 * The enclosing DOM button may be rectangular, but the accepted region is not.
 */
export function heroHoleCardClientPointHits(
  target: HeroHoleCardProjectedHitTarget,
  clientX: number,
  clientY: number,
  viewport: CssViewportRect,
): boolean {
  const point = sceneClientPointToViewportPercent(clientX, clientY, viewport);
  return point !== undefined
    && target.hitPolygons.some((polygon) => pointInPolygon(point, polygon));
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
