import { useEffect, useRef } from "react";
import {
  createTableScene,
  supportsWebGl2,
  type SceneSeatState,
  type TableSceneHandle,
  type TableSceneState,
} from "../scene3d/tableScene";

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
}

export function TableScene3D({
  seats,
  pot,
  boardCards,
  cameraPan,
  reducedMotion,
  suspended,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A device without WebGL2, or one where context creation is refused, keeps
    // the CSS table and loses nothing it had before.
    if (!supportsWebGl2()) return;

    let handle: TableSceneHandle | null = null;
    try {
      handle = createTableScene(canvas, stateRef.current);
    } catch {
      // A driver that accepts the probe and then fails to build the scene must
      // not take the table down with it.
      return;
    }
    sceneRef.current = handle;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      handle?.resize(parent.clientWidth, parent.clientHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      sceneRef.current = null;
      handle?.dispose();
    };
  }, []);

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
