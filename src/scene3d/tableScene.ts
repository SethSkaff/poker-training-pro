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
  CylinderGeometry,
  Color,
  Fog,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import {
  allInChipPosition,
  betChipPosition,
  cameraPose,
  callChipPosition,
  chipCountForAmount,
  dealtCardPosition,
  muckedCardPosition,
  raiseChipPosition,
  seatPoses,
  TABLE_HEIGHT,
  TABLE_RADIUS,
  turnIndicatorPositionForPlayer,
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
  readonly boardCards: number;
  /** The table's discrete camera control, -2..2. */
  readonly cameraPan: number;
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
  cardTextureEstimateMiB(): number;
}

function createTableSceneResources(): TableSceneResources {
  const ledger = createSceneResourceLedger();
  const track = <T extends { dispose(): void }>(resource: T): T => ledger.track(resource);
  const faceMaterials = new Map<string, MeshBasicMaterial>();
  const markerMaterials = new Map<string, MeshBasicMaterial>();
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
  return {
    ledger,
    cardGeometry: track(new BoxGeometry(0.09, 0.005, 0.13)),
    cardMaterial,
    cardBackMaterial: track(new MeshLambertMaterial({ color: 0x8d2733 })),
    chipGeometry: track(new CylinderGeometry(0.035, 0.035, 0.011, 12)),
    chipMaterial: (color) => track(new MeshLambertMaterial({ color })),
    cardFaceMaterial,
    markerMaterial,
    cardTextureEstimateMiB: () => (
      (faceMaterials.size * proceduralCardFaceBytes() + markerMaterials.size * proceduralTableMarkerBytes())
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
  scene.fog = new Fog(ROOM, 4, 16);

  const camera = new PerspectiveCamera(52, 16 / 9, 0.1, 60);

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
  potChips.position.set(0, TABLE_HEIGHT, 0.18);
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

  const applyCamera = () => {
    const pose = cameraPose(state.cameraPan);
    camera.position.set(...pose.position);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  };

  let lifecycle: ReturnType<typeof createSceneRenderLifecycle> | null = null;
  const drawFrame = (nowMs: number) => {
    try {
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
        );
      }
      placeMarker(buttonMarker, state.buttonPlayerId, seatViews);
      placeMarker(smallBlindMarker, state.smallBlindPlayerId, seatViews);
      placeMarker(bigBlindMarker, state.bigBlindPlayerId, seatViews);
      placeTurnIndicator(turnIndicator, state.seats, seatViews);
      setChipStack(potChips, chipCountForAmount(state.pot), 0xd8b45a, resources);
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
    !next.reducedMotion
    && next.transition?.action !== undefined
    && (next.transition?.progress ?? 1) < 1
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
      applyCamera();
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
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
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
      lifecycle?.update({ suspended, reducedMotion: state.reducedMotion, needsAnimation: false });
    },
    resume() {
      if (disposed) return;
      suspended = false;
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
        potChipCount: potChips.children.length,
        seats: state.seats.map((seat) => {
          const view = seatViews.get(seat.id)?.view;
          return {
            id: seat.id,
            stackChipCount: view?.stackChips.children.length ?? 0,
            betChipCount: view?.betChips.children.length ?? 0,
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

function buildRoom(scene: Scene, resources: SceneResourceLedger): void {
  const floor = new Mesh(
    resources.track(new PlaneGeometry(26, 26)),
    resources.track(new MeshLambertMaterial({ color: 0x141a17 })),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // A few distant tables so the room has depth beyond this one. Low-poly and
  // unlit-adjacent: they exist to be seen past, not looked at.
  for (const [x, z] of [
    [-4.4, -5.2],
    [4.6, -5.8],
    [-6.2, -1.4],
    [6.4, -2.2],
  ] as const) {
    const distant = new Group();
    const top = new Mesh(
      resources.track(new CylinderGeometry(1.1, 1.1, 0.09, 18)),
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
  const felt = new Mesh(
    resources.track(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.1, 42)),
    resources.track(new MeshLambertMaterial({ color: FELT })),
  );
  felt.position.y = TABLE_HEIGHT - 0.05;
  group.add(felt);

  const rail = new Mesh(
    resources.track(new TorusGeometry(TABLE_RADIUS, 0.075, 10, 44)),
    resources.track(new MeshLambertMaterial({ color: RAIL })),
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = TABLE_HEIGHT;
  group.add(rail);

  const pedestal = new Mesh(
    resources.track(new CylinderGeometry(0.34, 0.52, TABLE_HEIGHT - 0.1, 14)),
    resources.track(new MeshLambertMaterial({ color: 0x1a1210 })),
  );
  pedestal.position.y = (TABLE_HEIGHT - 0.1) / 2;
  group.add(pedestal);
  return group;
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
  marker.position.set(...pose.feltPosition);
  marker.position.y = TABLE_HEIGHT + 0.014;
}

/**
 * One durable halo identifies the actor. It lives at floor level around the
 * occupied chair, so it is readable in a still scene without obscuring cards
 * or the character's face; this is intentionally not an animated pulse.
 */
function buildTurnIndicator(resources: TableSceneResources): Mesh {
  const indicator = new Mesh(
    resources.ledger.track(new TorusGeometry(0.28, 0.018, 6, 24)),
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
  const position = turnIndicatorPositionForPlayer(
    acting?.id,
    (playerId) => seatViews.get(playerId)?.pose,
  );
  indicator.visible = Boolean(position);
  indicator.userData.publicPlayerId = position ? acting?.id ?? null : null;
  if (!position) return;
  indicator.position.set(...position);
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
  const worldToLocal = (world: readonly [number, number, number]) => {
    // Seat groups are rotated to face the table; convert the model's table-space
    // point into this seat's local frame so cards land on the felt, not beside
    // the chair.
    const [wx, wy, wz] = world;
    const dx = wx - pose.position[0];
    const dz = wz - pose.position[2];
    const cos = Math.cos(-pose.facing);
    const sin = Math.sin(-pose.facing);
    return [dx * cos - dz * sin, wy, dx * sin + dz * cos] as const;
  };

  const folded = seat.folded || transition?.foldedPlayerIds.includes(seat.id) === true;
  const gesture = sceneGestureFor(seat.action, progress, seat.acting, folded);
  view.cards.visible = !folded || progress < 1;
  view.cards.children.forEach((card, index) => {
    const target = folded
      ? muckedCardPosition(pose, progress)
      : gesture.cardMotion === "deal"
        ? dealtCardPosition(pose, progress)
        : pose.feltPosition;
    const local = worldToLocal(target);
    card.position.set(local[0] + (index === 0 ? -0.055 : 0.055), local[1], local[2]);
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
    const local = worldToLocal(chipPositionForGesture(pose, gesture.chipMotion, progress));
    view.betChips.position.set(local[0], local[1], local[2]);
  }

  setChipStack(view.stackChips, chipCountForAmount(seat.stack), 0x4a7fcf, resources);
  const stackLocal = worldToLocal([
    pose.feltPosition[0] * 0.86,
    TABLE_HEIGHT,
    pose.feltPosition[2] * 0.86,
  ]);
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

/** Grow or shrink a chip pile in place, reusing meshes rather than rebuilding. */
function setChipStack(group: Group, count: number, color: number, resources: TableSceneResources): void {
  while (group.children.length < count) {
    const chip = new Mesh(resources.chipGeometry, resources.chipMaterial(color));
    chip.position.y = group.children.length * 0.012;
    group.add(chip);
  }
  while (group.children.length > count) {
    group.remove(group.children[group.children.length - 1]);
  }
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
