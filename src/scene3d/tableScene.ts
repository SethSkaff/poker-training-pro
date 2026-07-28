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
  CylinderGeometry,
  Color,
  Fog,
  Group,
  IcosahedronGeometry,
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
  betChipPosition,
  cameraPose,
  chipCountForAmount,
  dealtCardPosition,
  muckedCardPosition,
  seatPoses,
  TABLE_HEIGHT,
  TABLE_RADIUS,
  type SeatActionKind,
  type SeatPose,
} from "./tableSceneModel";
import type { SceneFrameCallbacks, WebGlProbeResult } from "./sceneAvailability";

export interface SceneSeatState {
  readonly id: string;
  readonly seat: number;
  readonly stack: number;
  readonly bet: number;
  readonly folded: boolean;
  readonly acting: boolean;
  readonly isHero: boolean;
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
  readonly tier?: "local" | "regional" | "national" | "championship";
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
    running: boolean;
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

export function createTableScene(
  canvas: HTMLCanvasElement,
  initial: TableSceneState,
  callbacks?: SceneFrameCallbacks,
): TableSceneHandle {
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

  buildRoom(scene);
  const table = buildTable();
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
    const view = buildSeat(pose);
    scene.add(view.root);
    seatViews.set(seat.id, { pose, view });
  }

  const potChips = new Group();
  potChips.position.set(0, TABLE_HEIGHT, 0.18);
  scene.add(potChips);

  const board = new Group();
  board.position.set(0, TABLE_HEIGHT + 0.004, -0.16);
  scene.add(board);

  let state = initial;
  let running = false;
  let frame = 0;
  let disposed = false;
  let hasRendered = false;
  let suspended = callbacks?.startSuspended ?? false;
  // Action timing is per seat, so two seats can act in sequence without one
  // resetting the other's animation.
  const actionStartedAt = new Map<number, number>();
  const lastAction = new Map<number, SeatActionKind | undefined>();

  const applyCamera = () => {
    const pose = cameraPose(state.cameraPan);
    camera.position.set(...pose.position);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  };

  const drawFrame = (nowMs: number) => {
    try {
      for (const entry of seatViews.values()) entry.view.root.visible = false;
      for (const seat of state.seats) {
        const entry = seatViews.get(seat.id);
        if (!entry) continue;
        entry.view.root.visible = true;
        applySeat(entry.view, entry.pose, seat, nowMs, actionStartedAt, state.reducedMotion);
      }
      setChipStack(potChips, chipCountForAmount(state.pot), 0xd8b45a);
      setBoardCards(board, state.boardCards);
      renderer.render(scene, camera);
      if (!hasRendered) {
        hasRendered = true;
        callbacks?.onFirstFrame();
      }
    } catch {
      running = false;
      cancelAnimationFrame(frame);
      callbacks?.onFrameFailure();
    }
  };

  const loop = () => {
    if (!running || disposed) return;
    frame = requestAnimationFrame(loop);
    drawFrame(performance.now());
  };

  const handle: TableSceneHandle = {
    update(next) {
      const previous = state;
      state = next;
      for (const seat of next.seats) {
        if (lastAction.get(seat.seat) !== seat.action) {
          lastAction.set(seat.seat, seat.action);
          actionStartedAt.set(seat.seat, performance.now());
        }
      }
      applyCamera();
      /*
        With motion reduced the scene is not animated: it is drawn once per
        state change, at the end state of every action. Nothing moves, and the
        player still sees where every card and chip ended up. This is also why
        the model's easing is clamped -- progress 1 is a legal input.
      */
      if (next.reducedMotion) {
        if (running) {
          running = false;
          cancelAnimationFrame(frame);
        }
        if (!suspended) drawFrame(performance.now());
        return;
      }
      if (!suspended && !running && previous.reducedMotion !== false) {
        handle.resume();
      }
    },
    resize(width, height) {
      if (disposed || width <= 0 || height <= 0) return;
      // Cap the device pixel ratio: a 4K display at DPR 2 quadruples fragment
      // cost for no visible gain at this level of detail.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      if (!running && !suspended) drawFrame(performance.now());
    },
    suspend() {
      suspended = true;
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    },
    resume() {
      if (disposed) return;
      suspended = false;
      if (state.reducedMotion) {
        drawFrame(performance.now());
        return;
      }
      if (running) return;
      running = true;
      frame = requestAnimationFrame(loop);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(frame);
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else if (material) material.dispose();
      });
      renderer.dispose();
    },
    stats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      running,
    }),
  };

  applyCamera();
  handle.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  if (!suspended) {
    if (!initial.reducedMotion) handle.resume();
    else drawFrame(performance.now());
  }
  return handle;
}

interface SeatView {
  readonly root: Group;
  readonly body: Group;
  readonly arm: Object3D;
  readonly cards: Group;
  readonly betChips: Group;
  readonly stackChips: Group;
}

function buildRoom(scene: Scene): void {
  const floor = new Mesh(
    new PlaneGeometry(26, 26),
    new MeshLambertMaterial({ color: 0x141a17 }),
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
      new CylinderGeometry(1.1, 1.1, 0.09, 18),
      new MeshLambertMaterial({ color: 0x10493a }),
    );
    top.position.y = TABLE_HEIGHT;
    distant.add(top);
    const base = new Mesh(
      new CylinderGeometry(0.26, 0.36, TABLE_HEIGHT, 10),
      new MeshLambertMaterial({ color: RAIL }),
    );
    base.position.y = TABLE_HEIGHT / 2;
    distant.add(base);
    distant.position.set(x, 0, z);
    scene.add(distant);
  }
}

function buildTable(): Group {
  const group = new Group();
  const felt = new Mesh(
    new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.1, 42),
    new MeshLambertMaterial({ color: FELT }),
  );
  felt.position.y = TABLE_HEIGHT - 0.05;
  group.add(felt);

  const rail = new Mesh(
    new TorusGeometry(TABLE_RADIUS, 0.075, 10, 44),
    new MeshLambertMaterial({ color: RAIL }),
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = TABLE_HEIGHT;
  group.add(rail);

  const pedestal = new Mesh(
    new CylinderGeometry(0.34, 0.52, TABLE_HEIGHT - 0.1, 14),
    new MeshLambertMaterial({ color: 0x1a1210 }),
  );
  pedestal.position.y = (TABLE_HEIGHT - 0.1) / 2;
  group.add(pedestal);
  return group;
}

/**
 * A seated body: chair, torso, head, and one arm that reaches for the felt.
 *
 * Low-poly on purpose. The brief accepts stylised bodies and explicitly does
 * not require photorealism -- what it requires is that a body exists, occupies
 * a chair, and performs the physical actions of poker.
 */
function buildSeat(pose: SeatPose): SeatView {
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
    new BoxGeometry(0.5, 0.08, 0.46),
    new MeshLambertMaterial({ color: 0x2b1d17 }),
  );
  chair.position.y = 0.44;
  body.add(chair);
  const chairBack = new Mesh(
    new BoxGeometry(0.5, 0.52, 0.08),
    new MeshLambertMaterial({ color: 0x33241c }),
  );
  chairBack.position.set(0, 0.72, -0.2);
  body.add(chairBack);

  const torso = new Mesh(
    new CylinderGeometry(0.19, 0.23, 0.52, 10),
    new MeshLambertMaterial({ color: 0x3d4b63 }),
  );
  torso.position.y = 0.78;
  body.add(torso);

  const head = new Mesh(
    new IcosahedronGeometry(0.125, 1),
    new MeshLambertMaterial({ color: 0xc79a76 }),
  );
  head.position.y = 1.13;
  body.add(head);

  const arm = new Mesh(
    new BoxGeometry(0.1, 0.1, 0.42),
    new MeshLambertMaterial({ color: 0x3d4b63 }),
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

const CARD_GEOMETRY = new BoxGeometry(0.09, 0.005, 0.13);
const CARD_MATERIAL = new MeshBasicMaterial({ color: 0xf3ede0 });
const CARD_BACK_MATERIAL = new MeshLambertMaterial({ color: 0x8d2733 });
const CHIP_GEOMETRY = new CylinderGeometry(0.035, 0.035, 0.011, 12);

function applySeat(
  view: SeatView,
  pose: SeatPose,
  seat: SceneSeatState,
  nowMs: number,
  startedAt: Map<number, number>,
  reducedMotion: boolean,
): void {
  const started = startedAt.get(seat.seat) ?? nowMs;
  const progress = reducedMotion
    ? 1
    : Math.min(1, (nowMs - started) / ACTION_MS);

  /*
    The hero has no body, because the camera is the hero.
    Drawing one put a torso and a head directly in front of the lens -- the
    player was looking at the back of their own skull. Their cards and chips
    still render: those are on the felt, where the player can see them.
  */
  view.body.visible = !seat.isHero;

  // Two cards per seat, laid where the model says.
  while (view.cards.children.length < 2) {
    const card = new Mesh(CARD_GEOMETRY, CARD_BACK_MATERIAL);
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

  view.cards.visible = !seat.folded || progress < 1;
  view.cards.children.forEach((card, index) => {
    const target = seat.folded
      ? muckedCardPosition(pose, progress)
      : seat.action === "deal"
        ? dealtCardPosition(pose, progress)
        : pose.feltPosition;
    const local = worldToLocal(target);
    card.position.set(local[0] + (index === 0 ? -0.055 : 0.055), local[1], local[2]);
  });

  // The acting seat leans in; a folded one sits back. This is the turn signal,
  // and it is a body doing something rather than a rectangle oscillating.
  const lean = seat.acting ? 0.06 : seat.folded ? -0.04 : 0;
  view.body.position.z = lean;
  view.arm.position.z = 0.22 + (seat.action === "bet" || seat.action === "all-in" ? 0.16 * progress : 0);

  const betChips = chipCountForAmount(seat.bet);
  setChipStack(view.betChips, betChips, 0xcf4a3c);
  if (betChips > 0) {
    const local = worldToLocal(betChipPosition(pose, seat.action === "bet" ? progress : 1));
    view.betChips.position.set(local[0], local[1], local[2]);
  }

  setChipStack(view.stackChips, chipCountForAmount(seat.stack), 0x4a7fcf);
  const stackLocal = worldToLocal([
    pose.feltPosition[0] * 0.86,
    TABLE_HEIGHT,
    pose.feltPosition[2] * 0.86,
  ]);
  view.stackChips.position.set(stackLocal[0] + 0.16, stackLocal[1], stackLocal[2]);
}

/** Grow or shrink a chip pile in place, reusing meshes rather than rebuilding. */
function setChipStack(group: Group, count: number, color: number): void {
  while (group.children.length < count) {
    const chip = new Mesh(CHIP_GEOMETRY, new MeshLambertMaterial({ color }));
    chip.position.y = group.children.length * 0.012;
    group.add(chip);
  }
  while (group.children.length > count) {
    group.remove(group.children[group.children.length - 1]);
  }
}

function setBoardCards(group: Group, count: number): void {
  while (group.children.length < count) {
    const card = new Mesh(CARD_GEOMETRY, CARD_MATERIAL);
    card.position.x = (group.children.length - 2) * 0.105;
    group.add(card);
  }
  while (group.children.length > count) {
    group.remove(group.children[group.children.length - 1]);
  }
}
