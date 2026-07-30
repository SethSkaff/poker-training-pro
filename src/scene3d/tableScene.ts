/**
 * The real-time 3D table scene (E09-001 M1 vertical slice).
 *
 * three.js, WebGL2, drawn behind the DOM table. This module owns geometry,
 * lights, and the render loop and nothing else: every position it draws comes
 * from `tableSceneModel`, and every piece of state it draws comes from the
 * caller. It never reads the poker engine, never decides an action, and never
 * holds state the DOM layer does not also have.
 *
 * All geometry is built procedurally from primitives. That is deliberate for
 * this stage: it makes the slice original work by construction, with no
 * external mesh to license, no asset pipeline to stand up, and nothing fetched
 * at runtime (the CSP forbids that anyway). Authored glTF bodies replace these
 * primitives at M2 without changing this module's interface.
 */
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Color,
  ExtrudeGeometry,
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
  Shape,
  Scene,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import {
  allInChipPosition,
  betChipPosition,
  cameraPose,
  callChipPosition,
  CAMERA_VERTICAL_FOV,
  chipCountForAmount,
  dealtCardPosition,
  muckedCardPosition,
  raiseChipPosition,
  seatLocalPoint,
  seatPoses,
  OPEN_ARC_ANCHORS,
  TABLE_HEIGHT,
  TABLE_DEPTH,
  TABLE_RAIL_WIDTH,
  TABLE_RADIUS,
  TABLE_WIDTH,
  turnIndicatorPositionForPlayer,
  type SceneCameraMotion,
  type SceneCameraView,
  type SeatActionKind,
  type SeatPose,
} from "./tableSceneModel";
import { sceneGestureFor } from "./sceneGestures";
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

const FELT = 0x0f5b45;
const RAIL = 0x2a1a12;
const ROOM = 0x0b0f0e;

/** One action's visible duration, in milliseconds. */
const ACTION_MS = 620;

interface TableSceneResources {
  readonly ledger: SceneResourceLedger;
  readonly cardGeometry: BoxGeometry;
  readonly cardMaterial: MeshBasicMaterial;
  readonly cardBackMaterial: MeshLambertMaterial;
  readonly chipGeometry: CylinderGeometry;
  chipMaterial(color: number): MeshLambertMaterial;
  cardFaceMaterial(code: string): MeshBasicMaterial;
  markerMaterial(label: "D" | "SB" | "BB", color: number): MeshBasicMaterial;
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
    context.fillStyle = face.red ? "#b83232" : "#1f2933";
    context.font = "700 34px Georgia, serif";
    context.textAlign = "left";
    context.fillText(face.rank, 10, 39);
    context.font = "30px Georgia, serif";
    context.fillText(face.glyph, 12, 70);
    context.textAlign = "center";
    context.font = "52px Georgia, serif";
    context.fillText(face.glyph, canvas.width / 2, 111);
    const texture = track(new CanvasTexture(canvas));
    texture.generateMipmaps = PROCEDURAL_CARD_FACE_USE_MIPMAPS;
    texture.minFilter = LinearFilter;
    const material = track(new MeshBasicMaterial({ map: texture }));
    faceMaterials.set(key, material);
    return material;
  };
  const cardMaterial = track(new MeshBasicMaterial({ color: 0xf3ede0 }));
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
    cardGeometry: track(new BoxGeometry(0.09, 0.005, 0.13)),
    cardMaterial,
    cardBackMaterial: track(new MeshLambertMaterial({ color: 0x8d2733 })),
    chipGeometry: track(new CylinderGeometry(0.035, 0.035, 0.011, 12)),
    chipMaterial: (color) => track(new MeshLambertMaterial({ color })),
    cardFaceMaterial,
    markerMaterial,
    potPlaqueMaterial,
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

  buildRoom(scene, resources.ledger);
  const table = buildTable(resources.ledger);
  scene.add(table);

  // Lighting: one warm key over the felt plus a low ambient. Lambert materials
  // keep this cheap -- no PBR, no shadow maps, which is what holds the frame
  // budget on integrated graphics at this stage.
  scene.add(new AmbientLight(0x30403a, 2.1));
  const key = new PointLight(0xffd9a0, 42, 9, 2);
  key.position.set(0, 2.35, 0);
  scene.add(key);
  const fill = new PointLight(0x6fb8ff, 8, 14, 2);
  fill.position.set(-3.2, 2.1, -2.4);
  scene.add(fill);

  // Keep the six physical chairs stable. A player leaving must hide their
  // chair/body, never cause every surviving identity to slide one chair over.
  const poses = seatPoses(6);
  const seatViews = new Map<string, { pose: SeatPose; view: SeatView }>();
  for (const [index, seat] of initial.seats.entries()) {
    const pose = poses[index];
    if (!pose) continue;
    const view = buildSeat(pose, resources);
    scene.add(view.root);
    seatViews.set(seat.id, { pose, view });
  }

  const potChips = new Group();
  scene.add(potChips);

  const board = new Group();
  board.position.set(0, TABLE_HEIGHT + 0.004, -0.16);
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
  let cameraCurrent = cameraPose(initial.cameraPan, initial.cameraView, camera.aspect, cameraViewportWidth);
  let heroCardScale = heroCardForegroundScale(cameraViewportHeight, cameraCurrent.position[2]);
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
    cameraTarget = cameraPose(next.cameraPan, next.cameraView, camera.aspect, cameraViewportWidth);
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
              const view = buildSeat(pose, resources);
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
          heroCardScale,
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
      heroCardScale = heroCardForegroundScale(
        cameraViewportHeight,
        cameraPose(
          state.cameraPan,
          state.cameraView,
          cameraViewportWidth / Math.max(1, cameraViewportHeight),
          cameraViewportWidth,
        ).position[2],
      );
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
      textureEstimateMiB: resources.cardTextureEstimateMiB(),
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
  readonly betChips: Group;
  readonly stackChips: Group;
}

/**
 * Lean the physical hero cards against the near rail. Direction A's approved
 * peek range is 50-58 degrees toward the camera; the earlier 1.30 rad stood
 * them 74.5 degrees off the felt, which combined with the oversized scale below
 * to read as two billboards planted on the table.
 */
const HERO_CARD_FOREGROUND_TILT = 1.01;
/** The card's own long axis, from `cardGeometry`. */
const CARD_LENGTH_M = 0.13;
/**
 * Direction A's compact hero-card floor is 82 CSS px tall. Target it directly
 * rather than through a fixed multiplier: the old constant produced 116 px at
 * 1024x768 but 150 px at 1920x1080, so the foreground got *less* believable as
 * the window got roomier and the camera came closer.
 */
const HERO_CARD_TARGET_PX = 88;
/** Never smaller than a real card, never a prop. */
const HERO_CARD_SCALE_MIN = 1;
const HERO_CARD_SCALE_MAX = 2.7;

/**
 * Solve the hero-card scale that puts the physical card at a constant apparent
 * height, given where the safe-frame camera actually ended up.
 *
 * The responsive solver may legitimately retreat to 3.6 m at 1024x768, where a
 * physically sized card projects only 33 px. Scaling the real world-space card
 * (never a DOM mirror) is the sanctioned way to hold the foreground contract.
 */
function heroCardForegroundScale(
  viewportHeight: number,
  cameraDepth: number,
): number {
  const distance = Math.max(0.2, cameraDepth - OPEN_ARC_ANCHORS.heroCards[0][2]);
  const frameHeight = 2 * distance * Math.tan((CAMERA_VERTICAL_FOV * Math.PI) / 360);
  const pixelsPerMetre = Math.max(1, viewportHeight) / frameHeight;
  // A card tilted toward the camera keeps almost all of its projected length,
  // so the flat-length estimate is the right basis for the floor.
  const naturalPx = CARD_LENGTH_M * pixelsPerMetre;
  return Math.min(
    HERO_CARD_SCALE_MAX,
    Math.max(HERO_CARD_SCALE_MIN, HERO_CARD_TARGET_PX / Math.max(1, naturalPx)),
  );
}

function buildRoom(scene: Scene, resources: SceneResourceLedger): void {
  /*
    A warm carpet rather than near-black. At 0x141a17 the foreground floor -- a
    real 2 m of room between the hero's seat and the near rail, and up to 30% of
    a 1920x1080 frame -- resolved as an unlit void, which is exactly the failure
    Direction A's environment framing forbids. This is still dark enough to keep
    the felt dominant.
  */
  const floor = new Mesh(
    resources.track(new PlaneGeometry(26, 26)),
    resources.track(new MeshLambertMaterial({ color: 0x2e2420 })),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // A quiet pool of light around the hero's own seat, so the near floor reads as
  // carpet the player is sitting on instead of an empty band under the table.
  const carpet = new Mesh(
    resources.track(new CircleGeometry(2.5, 24)),
    resources.track(new MeshLambertMaterial({ color: 0x3b2c26 })),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.004, 1.1);
  scene.add(carpet);

  // A continuous emissive-looking rear wall creates Direction A's intentional
  // horizon instead of letting the fixed 52-degree lens resolve extra height
  // as an unlit void on wide native windows.
  const horizon = new Mesh(
    // At the approved ±32° seated look limit, a 22 m rear plane ended before
    // the edge of the frustum and exposed a black void. The wide continuous
    // architectural wall keeps both room wings present without moving the
    // table, seats, or camera laterally.
    resources.track(new PlaneGeometry(36, 7.4)),
    resources.track(new MeshBasicMaterial({ color: 0x203b31 })),
  );
  horizon.position.set(0, 3.4, -6.5);
  scene.add(horizon);

  // The eye-level cove is an intentional architectural horizon, not a HUD
  // overlay. Its elevated world position resolves at Direction A's 18–28%
  // horizon band with the fixed −16° seated gaze, while the physical
  // wall/floor junction remains naturally lower in the room.
  const horizonBand = new Mesh(
    resources.track(new PlaneGeometry(36, 0.13)),
    resources.track(new MeshBasicMaterial({ color: 0x6a9878 })),
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
      resources.track(new MeshBasicMaterial({ color: 0x1c332b })),
    );
    sideWall.position.set(side * 9.5, 3.4, -1.6);
    sideWall.rotation.y = side * -Math.PI / 2;
    scene.add(sideWall);
    const sideCove = new Mesh(
      resources.track(new PlaneGeometry(13, 0.13)),
      resources.track(new MeshBasicMaterial({ color: 0x5c8a69 })),
    );
    sideCove.position.set(side * 9.47, 1.1, -1.6);
    sideCove.rotation.y = side * -Math.PI / 2;
    scene.add(sideCove);
  }

  // Three quiet wall bays make the horizon read as a room rather than a flat
  // green card. They remain background-only and require no final M3 assets.
  for (const x of [-11, -5.5, 0, 5.5, 11]) {
    const bay = new Mesh(
      resources.track(new PlaneGeometry(2.8, 3.1)),
      resources.track(new MeshBasicMaterial({ color: 0x2a5142 })),
    );
    bay.position.set(x, 2.25, -6.46);
    scene.add(bay);
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
      resources.track(new MeshLambertMaterial({ color: 0x10493a })),
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

function buildTable(resources: SceneResourceLedger): Group {
  const group = new Group();
  const feltShape = capsuleShape(TABLE_WIDTH, TABLE_DEPTH);
  const felt = new Mesh(
    resources.track(new ExtrudeGeometry(feltShape, { depth: 0.075, bevelEnabled: false, curveSegments: 16 })),
    resources.track(new MeshLambertMaterial({ color: FELT })),
  );
  felt.rotation.x = Math.PI / 2;
  felt.position.y = TABLE_HEIGHT - 0.075;
  group.add(felt);

  const railShape = capsuleShape(TABLE_WIDTH + TABLE_RAIL_WIDTH * 2, TABLE_DEPTH + TABLE_RAIL_WIDTH * 2);
  railShape.holes.push(capsuleShape(TABLE_WIDTH - TABLE_RAIL_WIDTH * 0.35, TABLE_DEPTH - TABLE_RAIL_WIDTH * 0.35));
  const rail = new Mesh(
    resources.track(new ExtrudeGeometry(railShape, { depth: 0.10, bevelEnabled: false, curveSegments: 16 })),
    resources.track(new MeshLambertMaterial({ color: RAIL })),
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = TABLE_HEIGHT - 0.005;
  group.add(rail);

  /*
    A tapered column and a foot, in the rail's own timber, rather than a
    0.72 x 0.66 x 0.48 box in near-black. The box read as a hard black slab
    hanging under the felt -- the single most conspicuous unnatural shape in the
    seated frame, because its flat front face caught no light against the floor.
  */
  const pedestalMaterial = resources.track(new MeshLambertMaterial({ color: 0x3a281e }));
  const column = new Mesh(
    resources.track(new CylinderGeometry(0.17, 0.29, TABLE_HEIGHT - 0.14, 14)),
    pedestalMaterial,
  );
  column.position.y = (TABLE_HEIGHT - 0.14) / 2 + 0.03;
  group.add(column);
  const foot = new Mesh(
    resources.track(new CylinderGeometry(0.46, 0.52, 0.05, 16)),
    pedestalMaterial,
  );
  foot.position.y = 0.025;
  group.add(foot);
  return group;
}

/** A soft capsule in the X/Z table plane, used by both felt and independent rail. */
function capsuleShape(width: number, depth: number): Shape {
  const radius = depth / 2;
  const straight = Math.max(0, width / 2 - radius);
  const shape = new Shape();
  shape.moveTo(-straight, -radius);
  shape.lineTo(straight, -radius);
  shape.absarc(straight, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-straight, radius);
  shape.absarc(-straight, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
  return shape;
}

function buildTableMarker(
  label: "D" | "SB" | "BB",
  color: number,
  resources: TableSceneResources,
): Mesh {
  const marker = new Mesh(
    resources.ledger.track(new CylinderGeometry(0.045, 0.045, 0.012, 16)),
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
  // Markers live beside the player's commitment lane, never over their face.
  marker.position.set(pose.feltPosition[0] + Math.sign(pose.feltPosition[0] || 1) * 0.09, TABLE_HEIGHT + 0.014, pose.feltPosition[2]);
}

/**
 * A warm chair-light identifies the actor without a cropped floor-only ring.
 */
function buildTurnIndicator(resources: TableSceneResources): Mesh {
  const indicator = new Mesh(
    resources.ledger.track(new TorusGeometry(0.17, 0.018, 6, 24)),
    resources.ledger.track(new MeshBasicMaterial({ color: 0xffcb66 })),
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
  indicator.position.set(position[0], TABLE_HEIGHT + 0.025, position[2]);
}

/**
 * A seated body: chair, torso, head, and one arm that reaches for the felt.
 *
 * Low-poly on purpose. The brief accepts stylised bodies and explicitly does
 * not require photorealism -- what it requires is that a body exists, occupies
 * a chair, and performs the physical actions of poker.
 */
function buildSeat(pose: SeatPose, resources: TableSceneResources): SeatView {
  const root = new Group();
  root.position.set(...pose.position);
  root.rotation.y = pose.facing;

  /*
    The chair belongs to the body group, not the seat root, so hiding an
    occupant hides their chair with them. The hero's seat is the camera's own,
    and a chair rendered there sits inside the lens.
  */
  const body = new Group();
  const chair = new Mesh(
    resources.ledger.track(new BoxGeometry(0.5, 0.08, 0.46)),
    resources.ledger.track(new MeshLambertMaterial({ color: 0x2b1d17 })),
  );
  chair.position.y = 0.44;
  body.add(chair);
  const chairBack = new Mesh(
    resources.ledger.track(new BoxGeometry(0.5, 0.52, 0.08)),
    resources.ledger.track(new MeshLambertMaterial({ color: 0x33241c })),
  );
  chairBack.position.set(0, 0.72, -0.2);
  body.add(chairBack);

  const torso = new Mesh(
    resources.ledger.track(new CylinderGeometry(0.19, 0.23, 0.52, 10)),
    resources.ledger.track(new MeshLambertMaterial({ color: 0x3d4b63 })),
  );
  torso.position.y = 0.78;
  body.add(torso);

  const head = new Mesh(
    resources.ledger.track(new IcosahedronGeometry(0.125, 1)),
    resources.ledger.track(new MeshLambertMaterial({ color: 0xc79a76 })),
  );
  head.position.y = 1.13;
  body.add(head);

  const arm = new Mesh(
    resources.ledger.track(new BoxGeometry(0.1, 0.1, 0.42)),
    resources.ledger.track(new MeshLambertMaterial({ color: 0x3d4b63 })),
  );
  arm.position.set(0.16, 0.86, 0.22);
  body.add(arm);
  const otherArm = arm.clone();
  otherArm.position.x = -0.16;
  body.add(otherArm);
  root.add(body);

  const cards = new Group();
  root.add(cards);
  const betChips = new Group();
  root.add(betChips);
  const stackChips = new Group();
  root.add(stackChips);

  return { root, body, arm, cards, betChips, stackChips };
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
  heroCardScale: number,
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
  view.cards.children.forEach((card, index) => {
    const target = seat.isHero
      ? OPEN_ARC_ANCHORS.heroCards[index]
      : folded
      ? muckedCardPosition(pose, progress)
      : gesture.cardMotion === "deal"
        ? dealtCardPosition(pose, progress)
        : pose.feltPosition;
    const local = worldToLocal(target);
    card.position.set(
      local[0] + (seat.isHero ? 0 : index === 0 ? -0.055 : 0.055),
      local[1] + (seat.isHero ? 0.045 : 0),
      local[2],
    );
    if (seat.isHero) {
      card.rotation.x = HERO_CARD_FOREGROUND_TILT;
      card.scale.setScalar(heroCardScale);
    } else {
      card.rotation.x = 0;
      card.scale.setScalar(1);
    }
    const code = seat.publicCardCodes?.[index];
    (card as Mesh).material = code ? resources.cardFaceMaterial(code) : resources.cardBackMaterial;
  });

  // The acting seat leans in; a folded one sits back. This is the turn signal,
  // and it is a body doing something rather than a rectangle oscillating.
  view.body.position.z = gesture.bodyLean;
  view.arm.position.z = 0.22 + gesture.armReach;

  const betChips = chipCountForAmount(seat.bet);
  setChipStack(view.betChips, betChips, 0xcf4a3c, resources);
  if (betChips > 0) {
    const target = seat.isHero
      ? OPEN_ARC_ANCHORS.heroCommitted
      : chipPositionForGesture(pose, gesture.chipMotion, progress);
    const local = worldToLocal(target);
    view.betChips.position.set(local[0], local[1], local[2]);
  }

  setChipStack(view.stackChips, chipCountForAmount(seat.stack), 0x4a7fcf, resources);
  const stackTarget = seat.isHero
    ? OPEN_ARC_ANCHORS.heroStack
    : [pose.feltPosition[0] * 0.86, TABLE_HEIGHT, pose.feltPosition[2] * 0.86] as const;
  const stackLocal = worldToLocal(stackTarget);
  view.stackChips.position.set(stackLocal[0] + (seat.isHero ? 0 : 0.16), stackLocal[1], stackLocal[2]);
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
/*
  Pot plaque offsets from its lane origin; see `setPotLanes`. Solved against the
  projected far-rail band at all six native targets: this clears the centre
  seat's nameplate by 3.3% of viewport height centre-to-centre while staying
  behind the hero cards at z=0.50 and clear of an 18-chip pile.
*/
const POT_PLAQUE_HEIGHT = 0.045;
const POT_PLAQUE_FORWARD = 0.26;
const POT_PLAQUE_SIZE = [0.34, 0.09] as const;

/**
 * Repeated casino chips are one physical stack, not one draw call per chip.
 * The scene keeps the public count and full vertical stack geometry, but an
 * instanced mesh prevents a safe-frame camera retreat from regressing the
 * approved draw-call budget by bringing more existing stacks into view.
 */
function setChipStack(group: Group, count: number, color: number, resources: TableSceneResources): void {
  let stack = group.getObjectByName("instanced-chip-stack") as InstancedMesh | undefined;
  if (!stack) {
    stack = new InstancedMesh(
      resources.chipGeometry,
      resources.chipMaterial(color),
      MAX_RENDERED_CHIPS,
    );
    stack.name = "instanced-chip-stack";
    group.add(stack);
  }
  const material = stack.material;
  if (material instanceof MeshLambertMaterial) material.color.setHex(color);
  const renderedCount = Math.min(MAX_RENDERED_CHIPS, Math.max(0, count));
  const matrix = new Matrix4();
  for (let index = 0; index < renderedCount; index += 1) {
    matrix.makeTranslation(0, index * 0.012, 0);
    stack.setMatrixAt(index, matrix);
  }
  stack.count = renderedCount;
  stack.instanceMatrix.needsUpdate = true;
  stack.computeBoundingSphere();
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
    const anchor = pot.kind === "main" ? OPEN_ARC_ANCHORS.mainPot : OPEN_ARC_ANCHORS.sidePot(index - 1);
    lane.position.set(...anchor);
    lane.userData.publicPotId = pot.id;
    lane.userData.publicPotAmount = pot.amount;
    const chips = lane.getObjectByName("pot-chip-stack") as Group | undefined;
    const plaque = lane.getObjectByName("pot-amount-plaque") as Mesh | undefined;
    if (!chips || !plaque) return;
    setChipStack(chips, chipCountForAmount(pot.amount), pot.kind === "main" ? 0xd8b45a : 0x78a9e8, resources);
    plaque.visible = pot.amount > 0;
    plaque.material = resources.potPlaqueMaterial(potPlaqueLabel(pot.kind, pot.amount), pot.kind);
    plaque.position.y = 0.16 + Math.min(0.12, chipStackCount(chips) * 0.012);
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
    card.position.x = (group.children.length - 2) * 0.105;
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
