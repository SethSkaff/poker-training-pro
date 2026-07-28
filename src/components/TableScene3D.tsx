import { useEffect, useRef } from "react";
import {
  createTableScene,
  probeWebGl2,
  type SceneSeatState,
  type TableSceneHandle,
  type TableSceneState,
} from "../scene3d/tableScene";
import {
  startSceneAttempt,
  type SceneAvailability,
  type WebGlProbeResult,
} from "../scene3d/sceneAvailability";

/**
 * Mounts the 3D table behind the DOM table (E09-001 M1).
 *
 * Three rules hold this component in place, and none of them may be relaxed
 * without a new decision record:
 *
 *  1. **The canvas is decorative.** It is `aria-hidden` and never focusable.
 *     The DOM table above it stays mounted and remains the accessibility and
 *     interaction surface, so screen readers, keyboards, controllers, and every
 *     existing audit see exactly what they saw before.
 *  2. **It renders state, it never owns it.** Everything drawn arrives as
 *     props derived from the same scenario the DOM layer renders.
 *  3. **It yields.** Without WebGL2 it renders nothing and the CSS table is the
 *     whole picture; while hidden or paused it stops its loop, because the
 *     packaged lifecycle audit proves this app drops to zero frames when
 *     minimized and a stray rAF would regress that.
 */
export interface TableScene3DProps {
  readonly seats: readonly SceneSeatState[];
  readonly pot: number;
  readonly boardCards: number;
  readonly cameraPan: number;
  readonly reducedMotion: boolean;
  /** True while the table is paused or the window is away. */
  readonly suspended: boolean;
  /** Reports actual usable rendering, never just the player's preference. */
  readonly onAvailabilityChange?: (availability: SceneAvailability) => void;
  /** Production factories remain injectable to test lifecycle ownership. */
  readonly runtime?: {
    readonly probe: (canvas: HTMLCanvasElement) => WebGlProbeResult;
    readonly create: typeof createTableScene;
  };
}

export function TableScene3D({
  seats,
  pot,
  boardCards,
  cameraPan,
  reducedMotion,
  suspended,
  onAvailabilityChange,
  runtime,
}: TableScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<TableSceneHandle | null>(null);

  const state: TableSceneState = {
    seats,
    pot,
    boardCards,
    cameraPan,
    reducedMotion,
  };
  const stateRef = useRef(state);
  stateRef.current = state;
  const reportRef = useRef(onAvailabilityChange);
  reportRef.current = onAvailabilityChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sceneRuntime = runtime ?? { probe: probeWebGl2, create: createTableScene };
    let terminal = false;
    const attempt = startSceneAttempt({
      canvas,
      state: stateRef.current,
      probe: sceneRuntime.probe,
      startSuspended: suspended,
      create: (target, nextState, callbacks) => {
        const created = sceneRuntime.create(target, nextState, callbacks);
        // A reduced-motion draw can fail synchronously during construction.
        // Do not publish that disposed handle to later update effects.
        if (!terminal) sceneRef.current = created;
        return created;
      },
      onAvailability: (availability) => {
        terminal ||= availability.status === "failed" || availability.status === "lost" || availability.status === "disposed";
        if (terminal) sceneRef.current = null;
        reportRef.current?.(availability);
      },
    });
    /* F05 owns recovery. Until then, context loss restores the full DOM table. */
    const contextLost = () => attempt.contextLost();
    canvas.addEventListener("webglcontextlost", contextLost);
    const handle = sceneRef.current;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      handle?.resize(parent.clientWidth, parent.clientHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("webglcontextlost", contextLost);
      attempt.dispose();
      if (sceneRef.current === handle) sceneRef.current = null;
    };
  }, [runtime]);

  useEffect(() => {
    sceneRef.current?.update(state);
    // `state` is rebuilt each render; the scene diffs it internally.
  });

  useEffect(() => {
    if (suspended) sceneRef.current?.suspend();
    else sceneRef.current?.resume();
  }, [suspended]);

  return (
    <canvas
      ref={canvasRef}
      className="table-scene-3d"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}

export default TableScene3D;
