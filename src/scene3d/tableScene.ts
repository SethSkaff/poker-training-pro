/**
 * The real-time 3D table scene (E09-001 M1 vertical slice).
 *
 * three.js, WebGL2, drawn behind the DOM table. This module owns geometry,
 * lights, and the render loop and nothing else: every position it draws comes
 * from `tableSceneModel`, and every piece of state it draws comes from the
 * caller. It never reads the poker engine, never decides an action, and never
 * holds state the DOM layer does not also have.
 *
 * The table, the playing card, and the casino chip come from the Blender
 * library in `tools/blender/build_table.py`, by way of `tableGeometryLibrary`.
 * Everything else -- the room, the seated bodies, the markers -- is still built
 * procedurally from primitives here. Either way the geometry is original work by
 * construction, with no external mesh to license and nothing fetched at runtime
 * (the CSP forbids that anyway): the authored meshes are compiled into the
 * bundle, so the scene still builds synchronously on the first frame.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Color,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import {
  allInChipPosition,
  betChipPosition,
  cameraPose,
  callChipPosition,
  CAMERA_PITCH_DEGREES,
  CAMERA_VERTICAL_FOV,
  chipCountForAmount,
  dealtCardPosition,
  muckedCardPosition,
  raiseChipPosition,
  seatLocalPoint,
  dealerStation,
  seatPoses,
  TABLE_ANCHORS,
  TABLE_HEIGHT,
  turnIndicatorPositionForPlayer,
  BET_CIRCLE_RADIUS,
  type SceneCameraMotion,
  type SceneCameraView,
  type SeatActionKind,
  type SeatPose,
} from "./tableSceneModel";
import {
  playerStations,
  stationLedgeAnchor,
  TABLE_DEPTH,
  TABLE_WIDTH,
  type Station,
} from "./tableStations";
import { tableMeshGeometry, type TableMeshName } from "./tableGeometryLibrary";
import {
  drawCarpetTexture,
  drawFeltTexture,
  drawWallTexture,
  SURFACE_TEXTURE_SIZE,
  surfaceTextureBytes,
} from "./sceneSurfaceTextures";
import { sceneGestureFor } from "./sceneGestures";
import { buildCharacter, buildChair, buildDealer } from "./sceneCharacters";
import { describeOpponentCharacter } from "../lib/opponentAppearance";
import type { SceneFrameCallbacks, WebGlProbeResult } from "./sceneAvailability";
import type { SceneTransition } from "./sceneTransition";
import { createSceneActionTimingState, reconcileSceneActionTiming } from "./sceneActionTiming";
import { createSceneRenderLifecycle } from "./sceneLifecycle";
import { createSceneResourceLedger, type SceneResourceLedger } from "./sceneResources";
import { createSceneFrameTelemetry } from "./sceneDiagnostics";
import {
  parsePublicCardFace,
  PROCEDURAL_CARD_FACE_SIZE,
  PROCEDURAL_CARD_FACE_USE_MIPMAPS,
  PROCEDURAL_TABLE_MARKER_SIZE,
  proceduralCardFaceBytes,
  proceduralTableMarkerBytes,
} from "./sceneCardFaces";

export interface SceneSeatState {
  readonly id: string;
  readonly seat: number;
  readonly stack: number;
  readonly bet: number;
  readonly folded: boolean;
  readonly acting: boolean;
  readonly isHero: boolean;
  /** Public display codes only; absent means render card backs. */
  readonly publicCardCodes?: readonly string[];
  /** Public action this seat is currently performing, if any. */
  readonly action?: SeatActionKind;
}

export interface TableSceneState {
  readonly seats: readonly SceneSeatState[];
  readonly pot: number;
  /** Public main/side lanes.  The aggregate remains a DOM-parity guard. */
  readonly pots?: readonly { id: string; kind: "main" | "side"; amount: number }[];
  readonly boardCards: number;
  /** The table's discrete camera control, -2..2. */
  readonly cameraPan: number;
  /** Real WebGL composition preference, mirrored from Settings. */
  readonly cameraView?: SceneCameraView;
  /** Camera-only motion policy; never changes table-action motion. */
  readonly cameraMotion?: SceneCameraMotion;
  /** When true the scene renders a fixed camera and no idle motion. */
  readonly reducedMotion: boolean;
  /** Public table objects projected by the redacted snapshot adapter. */
  readonly buttonRelativeSeat?: number;
  readonly smallBlindRelativeSeat?: number;
  readonly bigBlindRelativeSeat?: number;
  /** Stable player identities for physical marker reconciliation. */
  readonly buttonPlayerId?: string;
  readonly smallBlindPlayerId?: string;
  readonly bigBlindPlayerId?: string;
  readonly tier?: "local" | "regional" | "national" | "championship";
  readonly publicBoardCardCodes?: readonly string[];
  /** Which player station the hero occupies; the camera sits there. */
  readonly heroStationIndex?: number;
  /** True while the hero holds their own cards up to read them. */
  readonly heroPeeked?: boolean;
  /** Current public queue item, sampled from the authoritative delay clock. */
  readonly transition?: SceneTransition;
}

export interface TableSceneHandle {
  update(state: TableSceneState): void;
  resize(width: number, height: number): void;
  /** Stop the loop without tearing the scene down (window hidden, paused). */
  suspend(): void;
  resume(): void;
  dispose(): void;
  /** Diagnostics for the packaged audit. */
  readonly stats: () => {
    drawCalls: number;
    triangles: number;
    textures: number;
    /** Decoded texture memory estimate; procedural M1 has no Texture objects. */
    textureEstimateMiB: number;
    resources: number;
    running: boolean;
    frameCount: number;
    firstFrameMs: number | null;
    frameP50Ms: number | null;
    frameP95Ms: number | null;
    renderer: string | null;
    /** Actual renderer-owned public objects; exposed only by the audit bridge. */
    objects: {
      boardCardCodes: readonly (string | null)[];
      potChipCount: number;
      /** Public physical main/side lanes, available only to the audit bridge. */
      potLanes: readonly { id: string; amount: number; chipCount: number }[];
      seats: readonly {
        id: string;
        stackChipCount: number;
        betChipCount: number;
      }[];
      markers: { button: string | null; smallBlind: string | null; bigBlind: string | null };
      actingPlayerId: string | null;
    };
  };
}

/** Probe the actual target canvas without allowing a driver error to escape. */
export function probeWebGl2(canvas: HTMLCanvasElement): WebGlProbeResult {
  try {
    return canvas.getContext("webgl2") === null ? "unsupported" : "available";
  } catch {
    return "blocked";
  }
}

/*
  v3 palette: a green baize table in a warm card room.

  The two previous passes both chased a single reference and both ended up
  monochrome -- v1 was one green and one brown, v2 went charcoal-on-plum after a
  PokerStars VR study and lost the thing that makes a poker table legible on
  sight. Green is what a poker table is. It also does real work here: it is the
  only cool hue in the room, so the felt separates from the timber, the carpet
  and the chips without needing to be the brightest thing in frame.

  The room around it is a card room rather than a void: red figured carpet,
  panelled timber walls, brass rail and cove. All of it sits well below the felt
  in value so the pendant key still pools on the table.
*/
const FELT = 0x1d6b3c;
const FELT_EDGE = 0x0e3a21;
/* Printed felt graphics -- medallion, racetrack line, per-seat play zones. A
   shade lighter than the baize, as printed felt actually is: high contrast here
   pulls the eye off the cards, which is the only thing on the table that
   matters. */
const FELT_PRINT = 0x2b8552;
/* Padded leather, not bare timber. At 0x7b6b59 the near rail was the brightest
   large surface in the seated frame -- a pale tan band across the bottom third
   that pulled the eye off the felt and read as moulded plastic. A darker hide
   lets the brass trim be the highlight, which is the way round a real table
   works. */
const RAIL = 0x5a4131;
/* The hard ledge between felt and padded rail, in a darker timber than the rail
   so the three zones separate under the pendant key rather than merging. */
const LEDGE = 0x46311f;
const PEDESTAL = 0x33231a;
const BRASS = 0xc9a227;
const CARPET = 0x5c1a28;
const CARPET_PATTERN = 0x7d2837;
const CARPET_ACCENT = 0x9a7a2c;
const WALL = 0x4a3626;
const WALL_PANEL = 0x5e4530;
const WALL_TRIM = 0x7d5a33;
const ROOM = 0x1a0f0a;
const CHAIR_SEAT = 0x5a1d24;
/* Lifted from 0x241823. At near-black the chair arms read as dark bars hooked
   across the upholstery instead of as part of the chair. */
const CHAIR_FRAME = 0x3a2318;

/*
  Real denominations, not one colour per group.

  Every chip on the table used to be one of three flat saturated colours, which
  is what made a stack read as a bright plastic blob: a real stack is several
  denominations and the colour changes every few chips. These are the standard
  house values, and `setChipStack` assigns them per column by size so a big
  holding shows high denominations and a short one does not.
*/
const CHIP_DENOMINATIONS = [
  { value: 1, color: 0xd8d2c2 },
  { value: 5, color: 0x8e1f28 },
  { value: 25, color: 0x14663a },
  { value: 100, color: 0x14161c },
  { value: 500, color: 0x4b2569 },
  { value: 1000, color: 0x9a7a2c },
] as const;
/* Pot and committed-bet piles keep an identifiable tint so a player can still
   tell their own bet from the pot at a glance. */
const CHIP_BET_BIAS = 2;
const CHIP_POT_BIAS = 4;

/** `#rrggbb` for a palette constant, so canvas drawing shares the same source. */
function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** One action's visible duration, in milliseconds. */
const ACTION_MS = 620;

/**
 * How much larger the community cards are than a hole card.
 *
 * The board is the one object at the table that every seat must be able to read,
 * and it is also the worst placed: from the two seats at the ends of the oval it
 * lies 1.6 m away and is seen at 18 degrees off the felt, which resolves to about
 * twenty pixels of card and no legible index at all. Hole cards have neither
 * problem -- they are half a metre away and much steeper.
 *
 * Every VR poker room oversizes its community cards for exactly this reason.
 * It is the one lever available that does not move the board off the table's
 * centre mark, which is where a dealer lays it and where it has to stay.
 */
const BOARD_CARD_SCALE = 1.5;

interface TableSceneResources {
  readonly ledger: SceneResourceLedger;
  readonly cardGeometry: BufferGeometry;
  /** The same card with its near corner bent up; see `applySeat`. */
  readonly peekedCardGeometry: BufferGeometry;
  readonly cardMaterial: MeshBasicMaterial;
  readonly cardBackMaterial: MeshLambertMaterial;
  readonly chipGeometry: BufferGeometry;
  /** The chip's contrasting edge spots, instanced alongside the body. */
  readonly chipEdgeGeometry: BufferGeometry;
  chipEdgeMaterial(): MeshLambertMaterial;
  chipMaterial(): MeshLambertMaterial;
  cardFaceMaterial(code: string): MeshBasicMaterial;
  markerMaterial(label: "D" | "SB" | "BB", color: number): MeshBasicMaterial;
  /** Tiled surface maps for the felt, the carpet, and the panelled walls. */
  surfaceTexture(kind: "felt" | "carpet" | "wall", repeatX: number, repeatY: number): Texture | null;
  surfaceTextureEstimateMiB(): number;
  potPlaqueMaterial(label: string, kind: "main" | "side"): MeshBasicMaterial;
  cardTextureEstimateMiB(): number;
}

function createTableSceneResources(): TableSceneResources {
  const ledger = createSceneResourceLedger();
  const track = <T extends { dispose(): void }>(resource: T): T => ledger.track(resource);
  const faceMaterials = new Map<string, MeshBasicMaterial>();
  const markerMaterials = new Map<string, MeshBasicMaterial>();
  const potPlaqueMaterials = new Map<string, MeshBasicMaterial>();
  const cardFaceMaterial = (code: string): MeshBasicMaterial => {
    const face = parsePublicCardFace(code);
    if (!face) return cardMaterial;
    const key = `${face.rank}${face.glyph}`;
    const cached = faceMaterials.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = PROCEDURAL_CARD_FACE_SIZE.width;
    canvas.height = PROCEDURAL_CARD_FACE_SIZE.height;
    const context = canvas.getContext("2d");
    if (!context) return cardMaterial;
    context.fillStyle = "#f8f1df";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#c7af83";
    context.lineWidth = 3;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    /*
      The index pair sits on the card's midline, not in its corners.

      A real card puts the index in two opposite corners, and the card stays
      readable because you hold it up. This board lies flat and is read at as
      little as 18 degrees off the felt from the seats at the ends of the oval,
      and that projection crushes the card's far edge hardest -- which is
      precisely where a corner index lives. Moving the pair inboard to the
      horizontal midline puts both copies in the least compressed band of the
      card.

      It is still drawn twice, 180 degrees apart, and a point reflection through
      the card's centre maps one onto the other. That is the property that
      matters: it is why a card lying on a table has no wrong way up, and it is
      what stopped two earlier attempts at a single large centre index from
      rendering upside down.
    */
    context.fillStyle = face.red ? "#b83232" : "#1f2933";
    const middle = canvas.height / 2;
    const drawIndex = () => {
      context.textAlign = "center";
      context.font = "700 56px Georgia, serif";
      context.fillText(face.rank, canvas.width * 0.30, middle - 4);
      context.font = "42px Georgia, serif";
      context.fillText(face.glyph, canvas.width * 0.30, middle + 42);
    };
    drawIndex();
    context.save();
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
    drawIndex();
    context.restore();
    const texture = track(new CanvasTexture(canvas));
    texture.generateMipmaps = PROCEDURAL_CARD_FACE_USE_MIPMAPS;
    texture.minFilter = LinearFilter;
    const material = track(new MeshBasicMaterial({ map: texture }));
    faceMaterials.set(key, material);
    return material;
  };
  const cardMaterial = track(new MeshBasicMaterial({ color: 0xf3ede0 }));
  /*
    One canvas per surface kind, cloned per repeat. A three.js Texture owns its
    own wrap/repeat, so two surfaces that need different tiling cannot share one
    Texture object -- but they can and do share the decoded canvas, which is
    where the memory actually is.
  */
  const surfaceCanvases = new Map<string, HTMLCanvasElement>();
  let surfaceTextureCount = 0;
  const surfaceTexture = (
    kind: "felt" | "carpet" | "wall",
    repeatX: number,
    repeatY: number,
  ): Texture | null => {
    let canvas = surfaceCanvases.get(kind);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = SURFACE_TEXTURE_SIZE;
      canvas.height = SURFACE_TEXTURE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return null;
      if (kind === "felt") drawFeltTexture(context, hexCss(FELT));
      else if (kind === "carpet") {
        drawCarpetTexture(context, hexCss(CARPET), hexCss(CARPET_PATTERN), hexCss(CARPET_ACCENT));
      } else drawWallTexture(context, hexCss(WALL), hexCss(WALL_PANEL), hexCss(WALL_TRIM));
      surfaceCanvases.set(kind, canvas);
    }
    const texture = track(new CanvasTexture(canvas));
    /*
      Tag the texel data sRGB. A CanvasTexture defaults to no colour space, so
      the renderer treats an 0x14512e baize as *linear* 0.08/0.32/0.18 and
      lights it as if it were roughly 0x63a97e -- which is why the felt kept
      coming out mint however dark a green it was given, and why the flat-tinted
      printed lines on top of it looked darker than the cloth they are printed
      on. Two rounds of hue adjustment were chasing this one flag.
    */
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = 4;
    surfaceTextureCount += 1;
    return texture;
  };
  const markerMaterial = (label: "D" | "SB" | "BB", color: number): MeshBasicMaterial => {
    const cached = markerMaterials.get(label);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = PROCEDURAL_TABLE_MARKER_SIZE.width;
    canvas.height = PROCEDURAL_TABLE_MARKER_SIZE.height;
    const context = canvas.getContext("2d");
    if (!context) return track(new MeshBasicMaterial({ color }));
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#f8f1df";
    context.lineWidth = 3;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = "#12201c";
    context.textAlign = "center";
    context.font = label === "D" ? "700 34px Inter, sans-serif" : "700 20px Inter, sans-serif";
    context.fillText(label, canvas.width / 2, label === "D" ? 44 : 39);
    const texture = track(new CanvasTexture(canvas));
    texture.generateMipmaps = PROCEDURAL_CARD_FACE_USE_MIPMAPS;
    texture.minFilter = LinearFilter;
    const material = track(new MeshBasicMaterial({ map: texture }));
    markerMaterials.set(label, material);
    return material;
  };
  const potPlaqueMaterial = (label: string, kind: "main" | "side"): MeshBasicMaterial => {
    const key = `${kind}:${label}`;
    const cached = potPlaqueMaterials.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) return track(new MeshBasicMaterial({ color: kind === "main" ? 0xd8b45a : 0x78a9e8 }));
    const accent = kind === "main" ? "#f6d36d" : "#9bc8ff";
    context.fillStyle = "#0b1512";
    context.fillRect(2, 8, canvas.width - 4, canvas.height - 16);
    context.strokeStyle = accent;
    context.lineWidth = 3;
    context.strokeRect(3.5, 9.5, canvas.width - 7, canvas.height - 19);
    context.fillStyle = accent;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 30px Inter, Arial, sans-serif";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 1);
    const texture = track(new CanvasTexture(canvas));
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    const material = track(new MeshBasicMaterial({ map: texture, transparent: true }));
    potPlaqueMaterials.set(key, material);
    return material;
  };
  return {
    ledger,
    cardGeometry: track(tableMeshGeometry("card")),
    peekedCardGeometry: track(tableMeshGeometry("card/peeked")),
    cardMaterial,
    cardBackMaterial: track(new MeshLambertMaterial({ color: 0x8d2733 })),
    chipGeometry: track(tableMeshGeometry("chip/body")),
    chipEdgeGeometry: track(tableMeshGeometry("chip/edge")),
    /* White materials tinted per instance: `setChipStack` writes a real
       denomination colour per chip, so the material must not impose one. */
    chipMaterial: () => track(new MeshLambertMaterial({ color: 0xffffff })),
    chipEdgeMaterial: () => track(new MeshLambertMaterial({ color: 0xffffff })),
    cardFaceMaterial,
    markerMaterial,
    potPlaqueMaterial,
    surfaceTexture,
    surfaceTextureEstimateMiB: () => (surfaceCanvases.size * surfaceTextureBytes()) / 1024 / 1024,
    cardTextureEstimateMiB: () => (
      (faceMaterials.size * proceduralCardFaceBytes()
        + markerMaterials.size * proceduralTableMarkerBytes()
        + potPlaqueMaterials.size * 256 * 80 * 4)
      / 1024 / 1024
    ),
  };
}

export function createTableScene(
  canvas: HTMLCanvasElement,
  initial: TableSceneState,
  callbacks?: SceneFrameCallbacks,
): TableSceneHandle {
  const mountedAt = performance.now();
  const frameTelemetry = createSceneFrameTelemetry(mountedAt);
  const resources = createTableSceneResources();
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(new Color(ROOM), 1);
  /*
    Filmic tone mapping, and light intensities that mean something.

    three.js point lights are physical: intensity falls off as 1/d^2, so the
    pendant at 8.5 delivered roughly five times full exposure to a felt 1.3 m
    below it. Everything under the light clipped, and a dark green baize came out
    as pale mint no matter what hue it was given -- two passes were spent
    adjusting the colour of a surface whose problem was exposure.

    ACES rolls the highlights off instead of clipping them, which is what lets
    the table hold a pool of warm light and still read as green cloth, and what
    keeps a white chip from turning into a white blob.
  */
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  /*
    Fog from 4 m crushed the rear wall to near-black by the time it was 10 m
    away, which is what made the ±32° room wings read as an empty void rather
    than a room -- the independent review's third blocker. The wall is unlit
    MeshBasicMaterial, so fog was the only thing darkening it. Starting further
    out keeps the architecture legible while still separating depth.
  */
  scene.fog = new Fog(ROOM, 9, 34);

  const camera = new PerspectiveCamera(52, 16 / 9, 0.05, 45);

  buildRoom(scene, resources);
  // Hero-relative seat order mapped onto the ring from wherever the hero sits.
  const poses = seatPoses(6, initial.heroStationIndex ?? 0);
  const table = buildTable(playerStations(), resources);
  scene.add(table);

  /*
    Lighting: a warm pendant key low over the felt, a cool rim from behind the
    far seats to separate bodies from the wall, and a dim ambient. The key sits
    closer and brighter than v1 so the felt is visibly the lit centre of a darker
    room -- that pool-of-light contrast is most of what makes a card room read as
    a card room. Still Lambert, still no shadow maps, so the frame budget holds.
  */
  /*
    A warm neutral ambient, not plum.

    The v2 room lit everything with a 0x2a2233 plum fill, which was invisible
    against a charcoal felt and a purple carpet and became glaring the moment the
    room turned warm: it pushed the red carpet to magenta and put a violet cast
    on every skin tone. A card room's fill is bounced light off timber.
  */
  /*
    The ambient's *colour* is the multiplier, not just its intensity. A
    0x271d15 fill at 1.35 delivered about 0.20 of light, so every Lambert
    surface it was the only light on -- the entire room past the pendant's
    5 m reach -- came out at a twentieth of its own albedo and the panelled
    walls rendered as flat black. A warm near-white at a low intensity is the
    same warmth and actually lights something.
  */
  scene.add(new AmbientLight(0xffe8cc, 0.55));
  /*
    The key drops from 15 to 8.5. At 15 with quadratic falloff 1.3 m above the
    cloth the felt's own texture was clipping to near-white in the middle of the
    table -- a green baize that read as a lit lime panel. Baize is a dark surface
    that a pendant *pools* on; it never becomes the brightest thing in the room.
  */
  const key = new PointLight(0xffd9a0, 6.2, 5.2, 2);
  key.position.set(0, 2.05, -0.15);
  scene.add(key);
  const rim = new PointLight(0x8fb0e8, 3.2, 11, 2);
  rim.position.set(0, 2.3, -3.1);
  scene.add(rim);
  /*
    A soft front fill on the far seats. With only a key over the felt and a rim
    from behind, the opponents' faces and clothing sat in shadow and every torso
    read as the same dark shape regardless of its outfit colour.
  */
  const seatFill = new PointLight(0xffe1b8, 2.4, 4.2, 2);
  seatFill.position.set(0, 1.55, 0.55);
  scene.add(seatFill);
  const warmFill = new PointLight(0xffb066, 2.0, 9, 2);
  warmFill.position.set(2.6, 1.9, 1.4);
  scene.add(warmFill);
  /*
    A house light grazing the rear wall. Without it the room's architecture is
    lit by ambient alone and has no gradient, so the panelling, the chair rail
    and the sconces all sit at one flat value and the wall reads as a backdrop
    photograph rather than a surface behind the table.
  */
  const roomLight = new PointLight(0xffcf9a, 8.0, 16, 2);
  roomLight.position.set(0, 3.1, -4.2);
  scene.add(roomLight);

  // Keep the six physical chairs stable. A player leaving must hide their
  // chair/body, never cause every surviving identity to slide one chair over.
  /*
    The dealer. One figure, house-dressed, at the far long side -- never dealt a
    hand and never one of the six seats.
  */
  const dealerPose = dealerStation();
  const dealer = buildDealer("#d8ab86", resources.ledger);
  dealer.root.position.set(...dealerPose.position);
  dealer.root.rotation.y = dealerPose.facing;
  scene.add(dealer.root);
  scene.add((() => {
    const stool = buildChair(CHAIR_SEAT, CHAIR_FRAME, resources.ledger);
    stool.position.set(...dealerPose.position);
    stool.rotation.y = dealerPose.facing;
    stool.scale.setScalar(0.94);
    return stool;
  })());

  const seatViews = new Map<string, { pose: SeatPose; view: SeatView }>();
  for (const [index, seat] of initial.seats.entries()) {
    const pose = poses[index];
    if (!pose) continue;
    const view = buildSeat(pose, resources, seat.id, seat.isHero || index === 0);
    scene.add(view.root);
    seatViews.set(seat.id, { pose, view });
  }

  const potChips = new Group();
  scene.add(potChips);

  /*
    The board sits on the table's own centre mark, not 0.16 m back toward the
    dealer. With the hero seated at a real seat rather than standing where the
    dealer stands, a board pushed to the far side of the felt was both further
    away and more steeply foreshortened than it needed to be -- and the centre
    medallion it should be sitting on was left conspicuously bare.
  */
  const board = new Group();
  board.position.set(...TABLE_ANCHORS.board);
  /*
    Square to the table, on the centre mark, which is where a dealer puts it.

    An earlier pass rotated the row to face the hero and lifted it toward them,
    because from the two seats at the ends of the oval a long-axis row
    foreshortens badly. That bought readability by putting the board somewhere no
    card room puts it, and it read as the board belonging to one player. The
    oversized card carries the readability instead.
  */
  scene.add(board);

  const buttonMarker = buildTableMarker("D", 0xf3ede0, resources);
  const smallBlindMarker = buildTableMarker("SB", 0x78a9e8, resources);
  const bigBlindMarker = buildTableMarker("BB", 0xd8b45a, resources);
  const turnIndicator = buildTurnIndicator(resources);
  scene.add(buttonMarker, smallBlindMarker, bigBlindMarker, turnIndicator);

  let state = initial;
  let disposed = false;
  let hasRendered = false;
  let suspended = callbacks?.startSuspended ?? false;
  // Action timing is per seat, so two seats can act in sequence without one
  // resetting the other's animation.
  const actionTiming = createSceneActionTimingState();

  let cameraViewportWidth = canvas.clientWidth || 1366;
  let cameraViewportHeight = canvas.clientHeight || 768;
  let cameraCurrent = cameraPose(initial.cameraPan, initial.heroStationIndex ?? 0, camera.aspect);
  let cameraTarget = cameraCurrent;
  let cameraLastFrameMs = mountedAt;
  let cameraMoving = false;

  const applyCamera = (pose = cameraCurrent) => {
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(...pose.position);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  };

  const setCameraTarget = (next: TableSceneState, snap: boolean) => {
    cameraTarget = cameraPose(next.cameraPan, next.heroStationIndex ?? 0, camera.aspect);
    if (snap) {
      cameraCurrent = cameraTarget;
      cameraMoving = false;
      applyCamera();
      return;
    }
    cameraLastFrameMs = performance.now();
    cameraMoving = !sameCameraPose(cameraCurrent, cameraTarget);
    if (!cameraMoving) applyCamera();
  };

  const advanceCamera = (nowMs: number) => {
    const previousCameraFrameMs = cameraLastFrameMs;
    cameraLastFrameMs = nowMs;
    if (!cameraMoving) return;
    // Renderer-local visual smoothing only. The authoritative pan value was
    // already committed by the DOM input; this cannot alter game state.
    const alpha = cameraInterpolationAlpha(previousCameraFrameMs, nowMs);
    cameraCurrent = interpolateCameraPose(cameraCurrent, cameraTarget, alpha);
    if (sameCameraPose(cameraCurrent, cameraTarget, 0.001)) {
      cameraCurrent = cameraTarget;
      cameraMoving = false;
    }
    applyCamera();
    if (!cameraMoving) {
      // The lifecycle cannot infer a renderer-local interpolation endpoint.
      // Hand it the settled state so a completed pan stops requesting frames.
      lifecycle?.update({
        suspended,
        reducedMotion: state.reducedMotion,
        needsAnimation: needsAnimation(state),
      });
    }
  };

  let lifecycle: ReturnType<typeof createSceneRenderLifecycle> | null = null;
  const drawFrame = (nowMs: number) => {
    try {
      advanceCamera(nowMs);
      for (const entry of seatViews.values()) entry.view.root.visible = false;
      const activeIds = new Set(state.seats.map((seat) => seat.id));
      for (const seat of state.seats) {
        let entry = seatViews.get(seat.id);
        if (!entry) {
          // A table move may replace a departed identity. Reuse that vacant
          // physical chair rather than dropping the newly seated player.
          const retired = [...seatViews.entries()].find(([id]) => !activeIds.has(id));
          if (retired) {
            seatViews.delete(retired[0]);
            entry = retired[1];
            seatViews.set(seat.id, entry);
          } else {
            const used = new Set([...seatViews.values()].map((value) => value.pose));
            const pose = poses.find((candidate) => !used.has(candidate));
            if (pose) {
              const view = buildSeat(pose, resources, seat.id, seat.isHero);
              scene.add(view.root);
              entry = { pose, view };
              seatViews.set(seat.id, entry);
            }
          }
        }
        if (!entry) continue;
        entry.view.root.visible = true;
        applySeat(
          entry.view,
          entry.pose,
          seat,
          nowMs,
          actionTiming.startedAt,
          state.reducedMotion,
          state.transition,
          resources,
          state.heroPeeked === true,
        );
      }
      placeMarker(buttonMarker, state.buttonPlayerId, seatViews);
      placeMarker(smallBlindMarker, state.smallBlindPlayerId, seatViews);
      placeMarker(bigBlindMarker, state.bigBlindPlayerId, seatViews);
      placeTurnIndicator(turnIndicator, state.seats, seatViews);
      setPotLanes(potChips, state.pots, state.pot, resources);
      for (const lane of potChips.children) {
        const plaque = lane.getObjectByName("pot-amount-plaque");
        if (plaque) plaque.lookAt(camera.position);
      }
      setBoardCards(board, state.boardCards, state.publicBoardCardCodes, resources);
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      frameTelemetry.record(nowMs, performance.now() - renderStartedAt);
      if (!hasRendered) {
        hasRendered = true;
        callbacks?.onFirstFrame();
      }
    } catch {
      lifecycle?.update({ suspended: true, reducedMotion: true, needsAnimation: false });
      callbacks?.onFrameFailure();
    }
  };
  lifecycle = createSceneRenderLifecycle(drawFrame);
  const needsAnimation = (next: TableSceneState) => (
    (!next.reducedMotion
      && next.transition?.action !== undefined
      && (next.transition?.progress ?? 1) < 1)
    || cameraMoving
  );
  const stateSignature = (next: TableSceneState) => JSON.stringify(next);

  const handle: TableSceneHandle = {
    update(next) {
      const previous = state;
      if (stateSignature(previous) === stateSignature(next)) return;
      state = next;
      reconcileSceneActionTiming(
        actionTiming,
        previous.seats,
        next.seats,
        next.transition,
        performance.now(),
        ACTION_MS,
      );
      const snapCamera = next.reducedMotion || (next.cameraMotion ?? "full") !== "full";
      setCameraTarget(next, snapCamera);
      /*
        With motion reduced the scene is not animated: it is drawn once per
        state change, at the end state of every action. Nothing moves, and the
        player still sees where every card and chip ended up. This is also why
        the model's easing is clamped -- progress 1 is a legal input.
      */
      lifecycle?.update({ suspended, reducedMotion: next.reducedMotion, needsAnimation: needsAnimation(next) });
    },
    resize(width, height) {
      if (disposed || width <= 0 || height <= 0) return;
      // Cap the device pixel ratio: a 4K display at DPR 2 quadruples fragment
      // cost for no visible gain at this level of detail.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      cameraViewportWidth = width;
      cameraViewportHeight = height;
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      // Direction A's compact fit is aspect-aware but bounded in the pure
      // contract.  A resize therefore recomputes the same authoritative pose.
      setCameraTarget(state, state.reducedMotion || (state.cameraMotion ?? "full") !== "full");
      if (!suspended) {
        lifecycle?.update({
          suspended,
          reducedMotion: state.reducedMotion,
          needsAnimation: needsAnimation(state),
        });
      }
    },
    suspend() {
      suspended = true;
      // Do not count a hidden/minimized interval as a camera-animation frame.
      // The first resumed frame must continue from the visible pose instead of
      // consuming elapsed wall time and snapping to the target.
      cameraLastFrameMs = performance.now();
      lifecycle?.update({ suspended, reducedMotion: state.reducedMotion, needsAnimation: false });
    },
    resume() {
      if (disposed) return;
      suspended = false;
      cameraLastFrameMs = performance.now();
      lifecycle?.update({ suspended, reducedMotion: state.reducedMotion, needsAnimation: needsAnimation(state) });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle?.dispose();
      resources.ledger.dispose();
      renderer.dispose();
    },
    stats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      // Public card faces are local 96×136 RGBA canvases with mipmaps disabled.
      // The cache is bounded by the 52 canonical rank/suit pairs, so this is an
      // exact decoded-byte estimate instead of treating every texture as unknown.
      textureEstimateMiB: resources.cardTextureEstimateMiB() + resources.surfaceTextureEstimateMiB(),
      resources: resources.ledger.counts().resources,
      running: lifecycle?.isRunning() ?? false,
      ...frameTelemetry.snapshot(),
      renderer: readRendererName(renderer),
      objects: {
        boardCardCodes: board.children.map((card) => publicObjectCode(card)),
        // `potChips` now owns lane groups, so diagnostics must count their
        // physical chip meshes rather than reporting the number of lanes.
        potChipCount: potChips.children.reduce((total, lane) => (
          total + chipStackCount(lane.getObjectByName("pot-chip-stack") as Group | undefined)
        ), 0),
        potLanes: potChips.children.map((lane) => ({
          id: String(lane.userData.publicPotId ?? ""),
          amount: Number(lane.userData.publicPotAmount ?? 0),
          chipCount: chipStackCount(lane.getObjectByName("pot-chip-stack") as Group | undefined),
        })),
        seats: state.seats.map((seat) => {
          const view = seatViews.get(seat.id)?.view;
          return {
            id: seat.id,
            stackChipCount: chipStackCount(view?.stackChips),
            betChipCount: chipStackCount(view?.betChips),
          };
        }),
        markers: {
          button: publicObjectPlayerId(buttonMarker),
          smallBlind: publicObjectPlayerId(smallBlindMarker),
          bigBlind: publicObjectPlayerId(bigBlindMarker),
        },
        actingPlayerId: publicObjectPlayerId(turnIndicator),
      },
    }),
  };

  applyCamera();
  handle.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  if (!suspended) {
    handle.resume();
  }
  return handle;
}

function readRendererName(renderer: WebGLRenderer): string | null {
  try {
    const context = renderer.getContext();
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      const unmasked = context.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      if (typeof unmasked === "string" && unmasked.length > 0) return unmasked;
    }
    return String(context.getParameter(context.RENDERER));
  } catch {
    return null;
  }
}

interface SeatView {
  readonly root: Group;
  readonly body: Group;
  readonly arm: Object3D;
  readonly cards: Group;
  /** The hero's own hand, shown only while they hold their cards up. */
  readonly hand: Object3D;
  readonly betChips: Group;
  readonly stackChips: Group;
}



/**
 * A panelled wall that takes the pendant light rather than ignoring it.
 *
 * The walls were `MeshBasicMaterial`, i.e. unlit -- which is why the room read
 * as a flat painted backdrop and why the far corners had no falloff. Lambert
 * plus the panel texture gives the architecture a value gradient away from the
 * table, which is what actually makes a dark room feel like a room.
 */
function wallMaterial(
  bundle: TableSceneResources,
  repeatX: number,
  repeatY: number,
): MeshLambertMaterial {
  const material = bundle.ledger.track(new MeshLambertMaterial({ color: WALL }));
  const texture = bundle.surfaceTexture("wall", repeatX, repeatY);
  if (texture) {
    material.map = texture;
    material.color.setHex(0xffffff);
  }
  return material;
}

function buildRoom(scene: Scene, bundle: TableSceneResources): void {
  const resources = bundle.ledger;
  /*
    A warm carpet rather than near-black. At 0x141a17 the foreground floor -- a
    real 2 m of room between the hero's seat and the near rail, and up to 30% of
    a 1920x1080 frame -- resolved as an unlit void, which is exactly the failure
    Direction A's environment framing forbids. This is still dark enough to keep
    the felt dominant.
  */
  const floorMaterial = resources.track(new MeshLambertMaterial({ color: CARPET }));
  const carpetTexture = bundle.surfaceTexture("carpet", 13, 13);
  if (carpetTexture) {
    floorMaterial.map = carpetTexture;
    floorMaterial.color.setHex(0xffffff);
  }
  const floor = new Mesh(resources.track(new PlaneGeometry(26, 26)), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  /*
    A plain border inlay under the table, in the carpet's own figure colour. The
    three concentric rings that used to stand in for a pattern are gone: the
    carpet is genuinely figured now, and stacking flat discs on top of a
    patterned floor only produced visible banding.
  */
  const inlay = new Mesh(
    resources.track(new CircleGeometry(3.1, 48)),
    resources.track(new MeshLambertMaterial({ color: CARPET_PATTERN })),
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.set(0, 0.002, -0.2);
  scene.add(inlay);

  // A continuous emissive-looking rear wall creates Direction A's intentional
  // horizon instead of letting the fixed 52-degree lens resolve extra height
  // as an unlit void on wide native windows.
  const horizon = new Mesh(
    // At the approved ±32° seated look limit, a 22 m rear plane ended before
    // the edge of the frustum and exposed a black void. The wide continuous
    // architectural wall keeps both room wings present without moving the
    // table, seats, or camera laterally.
    resources.track(new PlaneGeometry(36, 7.4)),
    wallMaterial(bundle, 14, 3),
  );
  horizon.position.set(0, 3.4, -6.5);
  scene.add(horizon);

  // The eye-level cove is an intentional architectural horizon, not a HUD
  // overlay. Its elevated world position resolves at Direction A's 18–28%
  // horizon band with the fixed −16° seated gaze, while the physical
  // wall/floor junction remains naturally lower in the room.
  const horizonBand = new Mesh(
    resources.track(new PlaneGeometry(36, 0.10)),
    // Dimmed from full brass. Unlit at 0xc9a227 the cove was a fluorescent
    // stripe across the room and the brightest thing in a frame whose subject
    // is a table 1 m away.
    resources.track(new MeshBasicMaterial({ color: 0x7d6220 })),
  );
  horizonBand.position.set(0, 1.1, -6.47);
  scene.add(horizonBand);

  /*
    Side walls so the ±32° wings terminate in architecture instead of nothing.
    Looking left or right previously showed only floor and a single distant
    table silhouette, which is why the wings read as an unlit void. These are
    the same procedural shell the decision doc allows at M1 -- no M3 assets.
  */
  for (const side of [-1, 1]) {
    const sideWall = new Mesh(
      resources.track(new PlaneGeometry(13, 7.4)),
      wallMaterial(bundle, 5, 3),
    );
    sideWall.position.set(side * 9.5, 3.4, -1.6);
    sideWall.rotation.y = side * -Math.PI / 2;
    scene.add(sideWall);
    const sideCove = new Mesh(
      resources.track(new PlaneGeometry(13, 0.10)),
      resources.track(new MeshBasicMaterial({ color: 0x7d6220 })),
    );
    sideCove.position.set(side * 9.47, 1.1, -1.6);
    sideCove.rotation.y = side * -Math.PI / 2;
    scene.add(sideCove);
  }

  /*
    The five flat bay planes are gone. They existed to stop the rear wall reading
    as one blank card, and the panelled wall texture now does that job at the
    right scale -- with them still in place they sat *on top of* the panelling as
    five oversized blank rectangles, which is exactly the artefact they were
    added to prevent.

    Wall sconces replace them: small warm plates at head height, which is what
    actually tells you a dark room is a room someone lit on purpose.
  */
  const sconceGeometry = resources.track(new PlaneGeometry(0.16, 0.30));
  const sconceMaterial = resources.track(new MeshBasicMaterial({ color: 0xa8813f }));
  for (const x of [-9.5, -5.7, -1.9, 1.9, 5.7, 9.5]) {
    const sconce = new Mesh(sconceGeometry, sconceMaterial);
    sconce.position.set(x, 1.62, -6.44);
    scene.add(sconce);
  }

  // A few distant tables so the room has depth beyond this one. Low-poly and
  // unlit-adjacent: they exist to be seen past, not looked at.
  //
  // Pushed wide and back off the forward arc. At (-4.4,-5.2)/(4.6,-5.8) they
  // projected directly behind the two near-side opponents, so a background
  // table appeared to grow out of a player's shoulder at recenter. These sit
  // outside the seated frame at recenter and populate the room wings instead.
  for (const [x, z] of [
    [-7.6, -6.4],
    [7.9, -6.8],
    [0, -8.6],
    // Two more sit inside the ±32° wings specifically, so looking left or right
    // reveals other tables rather than empty floor.
    [-6.9, -1.9],
    [7.2, -2.3],
  ] as const) {
    const distant = new Group();
    const top = new Mesh(
      resources.track(new CylinderGeometry(0.88, 0.88, 0.09, 18)),
      resources.track(new MeshLambertMaterial({ color: FELT_EDGE })),
    );
    top.position.y = TABLE_HEIGHT;
    distant.add(top);
    const base = new Mesh(
      resources.track(new CylinderGeometry(0.26, 0.36, TABLE_HEIGHT, 10)),
      resources.track(new MeshLambertMaterial({ color: RAIL })),
    );
    base.position.y = TABLE_HEIGHT / 2;
    distant.add(base);
    distant.position.set(x, 0, z);
    scene.add(distant);
  }
}

/**
 * The table, assembled from the Blender-authored meshes.
 *
 * Three zones, outward from the middle: printed felt (centre medallion,
 * racetrack betting line, one play zone per seat), the hard ledge ring carrying
 * each seat's inlaid medallion, and the padded rail with its metal trim bead.
 * That silhouette is what makes the table read as a modern card-room table
 * rather than a felt oval with a border, and every dimension comes from the
 * same constants the composition solver uses.
 *
 * The authored geometry has the felt plane at y=0, so the whole assembly is
 * placed by one `TABLE_HEIGHT` offset and nothing here re-derives a height.
 */
function buildTable(stations: readonly Station[], scene: TableSceneResources): Group {
  const resources = scene.ledger;
  const group = new Group();
  group.position.y = TABLE_HEIGHT;

  const zone = (name: TableMeshName, color: number, name3d: string): Mesh => {
    const mesh = new Mesh(
      resources.track(tableMeshGeometry(name)),
      resources.track(new MeshLambertMaterial({ color })),
    );
    mesh.name = name3d;
    group.add(mesh);
    return mesh;
  };

  /*
    The baize is textured, not a flat fill. An unbroken green plane 2.3 m across
    is the single largest surface in the frame and, without a weave, reads as
    painted plastic -- which was most of what made the previous felt look wrong
    whatever hue it was given. The tile repeats about every 12 cm of table, close
    to the real scale of the cloth.
  */
  const felt = zone("table/felt", 0xffffff, "table-felt");
  const feltMaterial = felt.material as MeshLambertMaterial;
  const feltTexture = scene.surfaceTexture("felt", TABLE_WIDTH / 0.12, TABLE_DEPTH / 0.12);
  if (feltTexture) feltMaterial.map = feltTexture;
  else feltMaterial.color.setHex(FELT);
  zone("table/print", FELT_PRINT, "table-print");
  zone("table/ledge", LEDGE, "table-ledge");
  zone("table/rail", RAIL, "table-rail");
  zone("table/trim", BRASS, "table-trim");
  zone("table/pedestal", PEDESTAL, "table-pedestal");

  /*
    Per-seat printed graphics. One geometry and one material each, cloned to the
    six stations, so six play zones plus six inlays cost two draw calls rather
    than twelve: the printed felt is decoration and must not eat the budget the
    players and their chips need.
  */
  const playZoneGeometry = resources.track(tableMeshGeometry("table/play-zone"));
  const inlayGeometry = resources.track(tableMeshGeometry("table/seat-inlay"));
  const printMaterial = resources.track(new MeshLambertMaterial({ color: FELT_PRINT }));
  /* Aged bronze, not the trim's bright brass: six unlit-bright discs sitting on
     the ledge around the table drew the eye harder than the cards did. */
  const inlayMaterial = resources.track(new MeshLambertMaterial({ color: 0x8a6b32 }));
  const playZones = new InstancedMesh(playZoneGeometry, printMaterial, stations.length);
  const inlays = new InstancedMesh(inlayGeometry, inlayMaterial, stations.length);
  playZones.name = "table-play-zones";
  inlays.name = "table-seat-inlays";
  const placement = new Matrix4();
  const rotation = new Matrix4();
  stations.forEach((station, index) => {
    rotation.makeRotationY(station.facing);
    placement.copy(rotation).setPosition(
      station.feltPosition[0],
      0,
      station.feltPosition[2],
    );
    playZones.setMatrixAt(index, placement);
    const ledge = stationLedgeAnchor(station);
    placement.copy(rotation).setPosition(ledge[0], 0, ledge[2]);
    inlays.setMatrixAt(index, placement);
  });
  playZones.instanceMatrix.needsUpdate = true;
  inlays.instanceMatrix.needsUpdate = true;
  group.add(playZones, inlays);
  return group;
}

function buildTableMarker(
  label: "D" | "SB" | "BB",
  color: number,
  resources: TableSceneResources,
): Mesh {
  /*
    A real dealer button is about 50 mm across -- roughly a chip and a half, and
    smaller than a playing card. At 90 mm these read as dinner plates: the big
    blind's disc was wider than the two hole cards it sat on top of.
  */
  const marker = new Mesh(
    resources.ledger.track(new CylinderGeometry(0.028, 0.028, 0.009, 16)),
    resources.markerMaterial(label, color),
  );
  return marker;
}

function placeMarker(
  marker: Mesh,
  playerId: string | undefined,
  seatViews: ReadonlyMap<string, { pose: SeatPose; view: SeatView }>,
): void {
  const pose = playerId === undefined ? undefined : seatViews.get(playerId)?.pose;
  marker.visible = Boolean(pose);
  marker.userData.publicPlayerId = pose ? playerId : null;
  if (!pose) return;
  /*
    Beside the owner's cards, in the owner's own frame.

    Offsetting by the sign of the world x put the marker on the *table's* left
    or right rather than the seat's, so for seats on the far side it landed
    between the cards and, for the seats nearest the middle, on top of them.
    0.135 m along the seat's local right is inside their printed play zone and
    clear of both hole cards, whichever way the seat faces.
  */
  const right = [Math.cos(pose.facing), -Math.sin(pose.facing)] as const;
  marker.position.set(
    pose.feltPosition[0] + right[0] * 0.135,
    TABLE_HEIGHT + 0.012,
    pose.feltPosition[2] + right[1] * 0.135,
  );
}

/**
 * A warm chair-light identifies the actor without a cropped floor-only ring.
 */
function buildTurnIndicator(resources: TableSceneResources): Mesh {
  const indicator = new Mesh(
    // Sized and placed to sit exactly on the felt's own printed bet circle.
    resources.ledger.track(new TorusGeometry(BET_CIRCLE_RADIUS + 0.004, 0.006, 6, 28)),
    resources.ledger.track(new MeshBasicMaterial({ color: 0xf0c473 })),
  );
  indicator.name = "active-turn-indicator";
  indicator.rotation.x = Math.PI / 2;
  indicator.visible = false;
  return indicator;
}

function placeTurnIndicator(
  indicator: Mesh,
  seats: readonly SceneSeatState[],
  seatViews: ReadonlyMap<string, { pose: SeatPose; view: SeatView }>,
): void {
  const acting = seats.find((seat) => seat.acting && !seat.folded);
  // The camera is the hero, so a floor ring at their own chair expands into a
  // huge, detached foreground torus when the seated view moves closer. Hero
  // turn state is instead owned by the visible action band and live DOM; keep
  // the physical chair-ring cue for opponents where it is readable in-world.
  if (acting?.isHero) {
    indicator.visible = false;
    indicator.userData.publicPlayerId = null;
    return;
  }
  const position = turnIndicatorPositionForPlayer(
    acting?.id,
    (playerId) => seatViews.get(playerId)?.pose,
  );
  indicator.visible = Boolean(position);
  indicator.userData.publicPlayerId = position ? acting?.id ?? null : null;
  if (!position) return;
  /*
    On the felt at the actor's own betting lane, not at their chair.

    The chair position at table height put the ring *inside the body* -- a gold
    band sliced across the acting player's torso. Dropping it to the floor instead
    would hide it behind the table at the v2 seated gaze. The player's felt anchor
    is the one place that is both unambiguously theirs and always visible, and it
    is where a real dealer's attention is anyway.
  */
  const pose = acting?.id === undefined ? undefined : seatViews.get(acting.id)?.pose;
  const lane = pose?.feltPosition ?? position;
  indicator.position.set(lane[0], TABLE_HEIGHT + 0.004, lane[2]);
}

/**
 * A seated opponent: chair plus a character built from `characterModel`'s
 * proportions and tinted from that identity's appearance.
 *
 * The body used to be four primitives in fixed colours, which is what made every
 * seat the same grey block with the same egg head. It is now a real per-identity
 * character -- gendered body family, face preset, hair style, hair colour sampled
 * on a continuous gradient, outfit, and height -- while staying primitive-built
 * so no asset pipeline or licensed mesh is involved.
 */
function buildSeat(
  pose: SeatPose,
  resources: TableSceneResources,
  playerId: string,
  isHero = false,
): SeatView {
  const root = new Group();
  root.position.set(...pose.position);
  root.rotation.y = pose.facing;

  /*
    The chair belongs to the body group, not the seat root, so hiding an
    occupant hides their chair with them.

    The hero's seat gets no body and no chair at all. The camera is at the
    hero's eyes, 0.10 m behind their own station, so a character built there is
    *inside the lens*: the near plane slices through it and what reaches the
    frame is the inside of a skull and a shoulder floating across the view. It
    looked exactly like sitting on top of another player, which is what it was.
    The hero's own cards and chips still belong to this seat -- only the body
    the camera is standing in is omitted.
  */
  const body = new Group();
  // The gesture code leans the body and reaches an arm. With no character there
  // is still an arm handle, just an empty one, so every gesture stays a no-op on
  // the hero rather than a null check at each call site.
  let arm: Object3D = new Group();
  if (!isHero) {
    body.add(buildChair(CHAIR_SEAT, CHAIR_FRAME, resources.ledger));
    const character = buildCharacter(describeOpponentCharacter(playerId), resources.ledger);
    body.add(character.root);
    arm = character.arms;
  }
  root.add(body);

  const cards = new Group();
  root.add(cards);
  /*
    Only the hero ever squeezes a card in view, so only the hero's seat pays for
    a hand. An opponent's peek is not public information and is not shown.
  */
  const hand: Object3D = isHero
    ? new Mesh(
      resources.ledger.track(tableMeshGeometry("hand/peek")),
      resources.ledger.track(new MeshLambertMaterial({ color: 0xd8ab86 })),
    )
    : new Group();
  hand.visible = false;
  root.add(hand);
  const betChips = new Group();
  root.add(betChips);
  const stackChips = new Group();
  root.add(stackChips);

  return { root, body, arm, cards, hand, betChips, stackChips };
}

function applySeat(
  view: SeatView,
  pose: SeatPose,
  seat: SceneSeatState,
  nowMs: number,
  startedAt: Map<number, number>,
  reducedMotion: boolean,
  transition: TableSceneState["transition"],
  resources: TableSceneResources,
  peeked: boolean,
): void {
  const started = startedAt.get(seat.seat) ?? nowMs;
  const localProgress = reducedMotion
    ? 1
    : Math.min(1, (nowMs - started) / ACTION_MS);
  const progress = transition?.action === seat.action && transition?.playerIds.includes(seat.id)
    ? transition?.progress ?? localProgress
    : localProgress;

  /*
    The hero has no body, because the camera is the hero.
    Drawing one put a torso and a head directly in front of the lens -- the
    player was looking at the back of their own skull. Their cards and chips
    still render: those are on the felt, where the player can see them.
  */
  view.body.visible = !seat.isHero;

  // Two cards per seat, laid where the model says.
  while (view.cards.children.length < 2) {
    const card = new Mesh(resources.cardGeometry, resources.cardBackMaterial);
    view.cards.add(card);
  }
  // Seat groups are rotated to face the table; convert the model's table-space
  // point into this seat's local frame so cards land on the felt, not beside
  // the chair.  The inverse rotation is part of the tested composition model.
  const worldToLocal = (world: readonly [number, number, number]) =>
    seatLocalPoint(pose, world);

  const folded = seat.folded || transition?.foldedPlayerIds.includes(seat.id) === true;
  const gesture = sceneGestureFor(seat.action, progress, seat.acting, folded);
  view.cards.visible = !folded || progress < 1;
  /*
    The hero is an ordinary seat now.

    Under the old open-arc model the hero sat where the dealer stands, so their
    hole cards needed their own foreground anchor, an upward tilt and a solved
    scale to stay legible -- which is precisely the "floating card UI" the owner
    objected to. Seated properly at a station, their cards rest on the felt in
    front of them exactly like everyone else's, and the -24 degree gaze reads them
    without any special case. Only the body stays hidden, because the camera is
    their eyes.
  */
  /*
    Face down unless someone is looking at them.

    Every hand on the table lies face down, including the hero's -- that is what
    a poker table looks like, and it is the only arrangement in which a hand is
    actually private. `peeked` is the squeeze: the geometry swaps for the
    corner-bent card, the faces turn up, and a hand appears over them for as long
    as the player holds. Release and they are cardboard again.
  */
  const squeezing = seat.isHero && peeked && !folded;
  view.cards.children.forEach((card, index) => {
    const target = folded
      ? muckedCardPosition(pose, progress)
      : gesture.cardMotion === "deal"
        ? dealtCardPosition(pose, progress)
        : pose.feltPosition;
    const local = seatLocalPoint(pose, target);
    card.position.set(local[0] + (index === 0 ? -0.055 : 0.055), local[1], local[2]);
    card.rotation.x = 0;
    card.scale.setScalar(1);
    const mesh = card as Mesh;
    const code = seat.publicCardCodes?.[index];
    mesh.geometry = squeezing ? resources.peekedCardGeometry : resources.cardGeometry;
    mesh.material = code ? resources.cardFaceMaterial(code) : resources.cardBackMaterial;
  });
  view.hand.visible = squeezing;
  if (squeezing) {
    const local = seatLocalPoint(pose, pose.feltPosition);
    /*
      Behind the right-hand card, not on top of it. The hand comes from the
      player, so the wrist is nearer them (local -Z) and the fingers reach across
      the card toward the middle of the table; the thumb is then at the near
      corner, which is the corner the peeked mesh bends up. Placed forward of the
      cards instead, it sat in the middle of the pair like a glove someone had
      dropped there.
    */
    /*
      Outboard of the card it is lifting, not on top of it. A seat's local +X is
      screen *left* from that seat's own camera -- the station frame is the
      mirror of the view frame -- so the authored bend, which is at the card's
      +X/near corner, is the near-left corner on screen. Sitting the hand at the
      cards' centre covered one of the two faces the squeeze exists to reveal.
    */
    view.hand.position.set(local[0] + 0.112, local[1] + 0.004, local[2] - 0.042);
    view.hand.rotation.y = -0.42;
  }

  // The acting seat leans in; a folded one sits back. This is the turn signal,
  // and it is a body doing something rather than a rectangle oscillating.
  view.body.position.z = gesture.bodyLean;
  view.arm.position.z = 0.22 + gesture.armReach;

  const betChips = chipCountForAmount(seat.bet);
  setChipStack(view.betChips, betChips, CHIP_BET_BIAS, resources);
  if (betChips > 0) {
    const local = seatLocalPoint(pose, chipPositionForGesture(pose, gesture.chipMotion, progress));
    view.betChips.position.set(local[0], local[1], local[2]);
  }

  setChipStack(view.stackChips, chipCountForAmount(seat.stack), 0, resources);
  const stackLocal = seatLocalPoint(pose, [
    pose.feltPosition[0] * 0.86,
    TABLE_HEIGHT,
    pose.feltPosition[2] * 0.86,
  ] as const);
  view.stackChips.position.set(stackLocal[0] + 0.16, stackLocal[1], stackLocal[2]);
}

function chipPositionForGesture(
  pose: SeatPose,
  motion: ReturnType<typeof sceneGestureFor>["chipMotion"],
  progress: number,
): readonly [number, number, number] {
  switch (motion) {
    case "call": return callChipPosition(pose, progress);
    case "raise": return raiseChipPosition(pose, progress);
    case "all-in": return allInChipPosition(pose, progress);
    case "bet":
    case "collect": return betChipPosition(pose, progress);
    default: return betChipPosition(pose, 1);
  }
}

/** Exponential camera smoothing for one visible renderer frame. */
export function cameraInterpolationAlpha(previousFrameMs: number, frameMs: number): number {
  return 1 - Math.exp(-Math.max(0, frameMs - previousFrameMs) / 135);
}

function interpolateCameraPose(
  from: ReturnType<typeof cameraPose>,
  to: ReturnType<typeof cameraPose>,
  alpha: number,
): ReturnType<typeof cameraPose> {
  const t = Math.min(1, Math.max(0, alpha));
  const lerp = (left: number, right: number) => left + (right - left) * t;
  return {
    position: [
      lerp(from.position[0], to.position[0]),
      lerp(from.position[1], to.position[1]),
      lerp(from.position[2], to.position[2]),
    ],
    target: [
      lerp(from.target[0], to.target[0]),
      lerp(from.target[1], to.target[1]),
      lerp(from.target[2], to.target[2]),
    ],
    yaw: lerp(from.yaw, to.yaw),
    fov: lerp(from.fov, to.fov),
  };
}

function sameCameraPose(
  left: ReturnType<typeof cameraPose>,
  right: ReturnType<typeof cameraPose>,
  tolerance = 0,
): boolean {
  const close = (first: number, second: number) => Math.abs(first - second) <= tolerance;
  return close(left.position[0], right.position[0])
    && close(left.position[1], right.position[1])
    && close(left.position[2], right.position[2])
    && close(left.target[0], right.target[0])
    && close(left.target[1], right.target[1])
    && close(left.target[2], right.target[2])
    && close(left.fov, right.fov);
}

const MAX_RENDERED_CHIPS = 18;
/**
 * Chips per column before a new one starts beside it; see `setChipStack`.
 *
 * Eight, not twelve. A twelve-high column is 44 mm of chip on a 48 mm base and
 * still reads as a single squat cylinder rather than a stack, and it meant a
 * whole pot sat in one column. Eight breaks every holding worth looking at into
 * two or three columns, which is both what players actually do and what makes
 * the size of a holding readable across the table.
 */
const CHIPS_PER_COLUMN = 8;
/** Slightly wider than the 0.035 chip radius so columns read as separate. */
const CHIP_COLUMN_PITCH = 0.052;
/*
  Pot plaque offsets from its lane origin; see `setPotLanes`. Solved against the
  projected far-rail band at all six native targets: this clears the centre
  seat's nameplate by 3.3% of viewport height centre-to-centre while staying
  behind the hero cards at z=0.50 and clear of an 18-chip pile.
*/
const POT_PLAQUE_HEIGHT = 0.03;
const POT_PLAQUE_FORWARD = 0.20;
const POT_PLAQUE_SIZE = [0.22, 0.058] as const;

/**
 * Repeated casino chips are one physical stack, not one draw call per chip.
 * The scene keeps the public count and full vertical stack geometry, but an
 * instanced mesh prevents a safe-frame camera retreat from regressing the
 * approved draw-call budget by bringing more existing stacks into view.
 */
function setChipStack(group: Group, count: number, bias: number, resources: TableSceneResources): void {
  let stack = group.getObjectByName("instanced-chip-stack") as InstancedMesh | undefined;
  let spots = group.getObjectByName("instanced-chip-spots") as InstancedMesh | undefined;
  if (!stack || !spots) {
    stack = new InstancedMesh(
      resources.chipGeometry,
      resources.chipMaterial(),
      MAX_RENDERED_CHIPS,
    );
    stack.name = "instanced-chip-stack";
    /*
      The edge spots are a second instanced mesh sharing the body's matrices.
      They are what makes a stack read as chips at the seated distance -- an
      unbroken cylinder of one colour reads as a rod -- and one extra draw call
      per stack is well inside the approved budget.
    */
    spots = new InstancedMesh(
      resources.chipEdgeGeometry,
      resources.chipEdgeMaterial(),
      MAX_RENDERED_CHIPS,
    );
    spots.name = "instanced-chip-spots";
    group.add(stack, spots);
  }
  const renderedCount = Math.min(MAX_RENDERED_CHIPS, Math.max(0, count));
  const matrix = new Matrix4();
  const body = new Color();
  const inlay = new Color();
  const cream = new Color(0xf4efe2);
  /*
    Real players break a deep holding into several short columns rather than one
    tottering tower. An 18-chip single column stood 0.22 m tall and read as a
    blue rod; this lays them out in columns of CHIPS_PER_COLUMN, growing sideways
    and then back, which is both believable and much easier to judge at a glance.
  */
  for (let index = 0; index < renderedCount; index += 1) {
    const column = Math.floor(index / CHIPS_PER_COLUMN);
    const height = index % CHIPS_PER_COLUMN;
    /*
      Hand-stacked chips are never perfectly clocked. A small deterministic yaw
      per chip breaks the edge spots out of a vertical stripe and gives the
      stack the spiralled look a real one has, at no cost -- it is the same
      matrix that was already being written.
    */
    matrix.makeRotationY(((index * 37) % 360) * (Math.PI / 180));
    matrix.setPosition(
      (column % 3) * CHIP_COLUMN_PITCH,
      height * 0.0037,
      Math.floor(column / 3) * CHIP_COLUMN_PITCH,
    );
    stack.setMatrixAt(index, matrix);
    spots.setMatrixAt(index, matrix);
    /*
      One denomination per column, descending. A player racks their highest
      chips into the back column and works down, so a deep stack shows blacks
      and purples behind greens and reds -- which is both what a real table looks
      like and the only cue at this distance for how big a holding is beyond
      counting columns. `bias` shifts the whole run so a committed bet and the
      pot stay distinguishable from a player's own stack.
    */
    const denomination = CHIP_DENOMINATIONS[
      Math.min(CHIP_DENOMINATIONS.length - 1, bias + column)
    ];
    body.setHex(denomination.color);
    stack.setColorAt(index, body);
    inlay.copy(body).lerp(cream, 0.78);
    spots.setColorAt(index, inlay);
  }
  stack.count = renderedCount;
  stack.instanceMatrix.needsUpdate = true;
  if (stack.instanceColor) stack.instanceColor.needsUpdate = true;
  stack.computeBoundingSphere();
  spots.count = renderedCount;
  spots.instanceMatrix.needsUpdate = true;
  if (spots.instanceColor) spots.instanceColor.needsUpdate = true;
  spots.computeBoundingSphere();
  group.userData.publicChipCount = renderedCount;
}

function chipStackCount(group: Group | undefined): number {
  return Number(group?.userData.publicChipCount ?? 0);
}

/** Main pot plus explicit side-pot lanes; generated from the redacted snapshot only. */
function setPotLanes(
  group: Group,
  pots: TableSceneState["pots"],
  aggregate: number,
  resources: TableSceneResources,
): void {
  const publicPots = pots && pots.length > 0
    ? pots
    : [{ id: "main", kind: "main" as const, amount: aggregate }];
  while (group.children.length < publicPots.length) {
    const lane = new Group();
    const chips = new Group();
    chips.name = "pot-chip-stack";
    const plaque = new Mesh(
      resources.ledger.track(new PlaneGeometry(...POT_PLAQUE_SIZE)),
      resources.potPlaqueMaterial("POT 0", "main"),
    );
    plaque.name = "pot-amount-plaque";
    /*
      In front of the pile and low, not floating above it. Raised to y=0.16 the
      billboard projected into the same screen band as the far rail -- the
      centre opponent's nameplate sat directly behind "POT 200" at every target.
      Sitting it toward the hero puts it clearly below the far seats and keeps it
      clear of the pile itself, which can be 18 chips (0.22 m) tall.
    */
    plaque.position.set(0, POT_PLAQUE_HEIGHT, POT_PLAQUE_FORWARD);
    lane.add(chips, plaque);
    group.add(lane);
  }
  while (group.children.length > publicPots.length) group.remove(group.children[group.children.length - 1]);
  group.children.forEach((lane, index) => {
    const pot = publicPots[index];
    const anchor = pot.kind === "main" ? TABLE_ANCHORS.mainPot : TABLE_ANCHORS.sidePot(index - 1);
    lane.position.set(...anchor);
    lane.userData.publicPotId = pot.id;
    lane.userData.publicPotAmount = pot.amount;
    const chips = lane.getObjectByName("pot-chip-stack") as Group | undefined;
    const plaque = lane.getObjectByName("pot-amount-plaque") as Mesh | undefined;
    if (!chips || !plaque) return;
    setChipStack(chips, chipCountForAmount(pot.amount), pot.kind === "main" ? CHIP_POT_BIAS : CHIP_POT_BIAS - 1, resources);
    plaque.visible = pot.amount > 0;
    plaque.material = resources.potPlaqueMaterial(potPlaqueLabel(pot.kind, pot.amount), pot.kind);
    /*
      Just clear of the top of its own pile, not floating above the table.

      At 0.16 + 12 mm a chip the label hung in mid-air over the far felt with
      daylight under it, which is what made it read as a HUD overlay pasted into
      the scene rather than a marker sitting on the table. Riding the pile keeps
      it attached to the thing it labels while still never being buried by it.
    */
    plaque.position.y = 0.055 + Math.min(0.06, chipStackCount(chips) * 0.006);
  });
}

function potPlaqueLabel(kind: "main" | "side", amount: number): string {
  const prefix = kind === "main" ? "POT" : "SIDE";
  if (amount >= 10_000) return `${prefix} ${(amount / 1_000).toFixed(amount % 1_000 === 0 ? 0 : 1)}K`;
  if (amount >= 1_000) return `${prefix} ${(amount / 1_000).toFixed(1)}K`;
  return `${prefix} ${Math.max(0, Math.round(amount))}`;
}

function setBoardCards(
  group: Group,
  count: number,
  codes: readonly string[] = [],
  resources: TableSceneResources,
): void {
  while (group.children.length < count) {
    const card = new Mesh(resources.cardGeometry, resources.cardMaterial);
    card.position.x = (group.children.length - 2) * 0.105 * BOARD_CARD_SCALE;
    card.scale.setScalar(BOARD_CARD_SCALE);
    group.add(card);
  }
  while (group.children.length > count) {
    group.remove(group.children[group.children.length - 1]);
  }
  group.children.forEach((card, index) => {
    (card as Mesh).material = resources.cardFaceMaterial(codes[index] ?? "");
    (card as Mesh).userData.publicCode = codes[index] ?? null;
  });
}

function publicObjectCode(object: Object3D): string | null {
  return typeof object.userData.publicCode === "string" ? object.userData.publicCode : null;
}

function publicObjectPlayerId(object: Object3D): string | null {
  return typeof object.userData.publicPlayerId === "string" ? object.userData.publicPlayerId : null;
}
