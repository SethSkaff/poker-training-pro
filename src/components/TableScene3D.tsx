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
import { createSceneRecoverySession } from "../scene3d/sceneRecovery";
import { observeSceneResize } from "../scene3d/sceneResize";
import { installSceneDiagnosticsBridge } from "../scene3d/sceneDiagnostics";
import type { SceneCameraMotion, SceneCameraView } from "../scene3d/tableSceneModel";

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
  readonly cameraView?: SceneCameraView;
  readonly cameraMotion?: SceneCameraMotion;
  readonly reducedMotion: boolean;
  /** True while the table is paused or the window is away. */
  readonly suspended: boolean;
  /** The complete public snapshot; scalar props remain DOM-parity guards. */
  readonly snapshot?: TableSceneState;
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
  cameraView,
  cameraMotion,
  reducedMotion,
  suspended,
  snapshot,
  onAvailabilityChange,
  runtime,
}: TableScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<TableSceneHandle | null>(null);

  const state: TableSceneState = snapshot ?? {
    seats,
    pot,
    boardCards,
    cameraPan,
    cameraView,
    cameraMotion,
    reducedMotion,
  };
  const stateRef = useRef(state);
  stateRef.current = state;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const reportRef = useRef(onAvailabilityChange);
  reportRef.current = onAvailabilityChange;
  const availabilityRef = useRef<SceneAvailability>({ status: "idle" });
  const contextLossCountRef = useRef(0);
  // Audit provenance only: a browser-generated loss must not be confused with
  // a synthetic Event dispatched by a test harness.
  const lastContextLossTrustedRef = useRef<boolean | null>(null);
  const lastContextLossDefaultPreventedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!window.desktop?.sceneDiagnosticsEnabled) return;
    return installSceneDiagnosticsBridge(window, () => {
      const stats = sceneRef.current?.stats();
      return {
        // This is intentionally renderer/public-lifecycle metadata only. It
        // cannot expose cards, engine state, player decisions, or controls.
        availability: availabilityRef.current.status,
        ...(availabilityRef.current.reason ? { reason: availabilityRef.current.reason } : {}),
        suspended: suspendedRef.current,
        contextLosses: contextLossCountRef.current,
        lastContextLossTrusted: lastContextLossTrustedRef.current,
        lastContextLossDefaultPrevented: lastContextLossDefaultPreventedRef.current,
        qualityTier: "unconfigured" as const,
        ...(stats ?? {
          drawCalls: 0,
          triangles: 0,
          textures: 0,
          textureEstimateMiB: 0,
          resources: 0,
          running: false,
          frameCount: 0,
          firstFrameMs: null,
          frameP50Ms: null,
          frameP95Ms: null,
          renderer: null,
          objects: {
            boardCardCodes: [],
            potChipCount: 0,
            seats: [],
            markers: { button: null, smallBlind: null, bigBlind: null },
            actingPlayerId: null,
          },
        }),
      };
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sceneRuntime = runtime ?? { probe: probeWebGl2, create: createTableScene };
    // The packaged fallback audit needs to exercise the same availability path
    // as a real blocked context before three.js is constructed. This flag is
    // injected only by Electron main for that isolated audit; production users
    // always receive the actual canvas probe.
    const probe = window.desktop?.forceWebGl2Failure
      ? () => "blocked" as const
      : sceneRuntime.probe;
    let recoverable = true;
    const recovery = createSceneRecoverySession({
      latestState: () => stateRef.current,
      canRecover: () => recoverable,
      create: (nextState) => {
        let publishScene = true;
        return startSceneAttempt({
          canvas,
          state: nextState,
          probe,
          startSuspended: suspendedRef.current,
          create: (target, currentState, callbacks) => {
            const created = sceneRuntime.create(target, currentState, callbacks);
            if (publishScene) sceneRef.current = created;
            return created;
          },
          onAvailability: (availability) => {
            availabilityRef.current = availability;
            if (availability.status === "failed" || availability.status === "disposed") {
              recoverable = false;
              publishScene = false;
            }
            if (availability.status === "failed" || availability.status === "lost" || availability.status === "disposed") {
              sceneRef.current = null;
            }
            reportRef.current?.(availability);
          },
        });
      },
    });
    const contextLost = (event: Event) => {
      // Preventing the browser default is valid only while this mounted host is
      // actively rebuilding on webglcontextrestored. Otherwise the DOM fallback
      // remains authoritative and receives a normal unrecoverable loss.
      if (recovery.contextLost()) {
        contextLossCountRef.current += 1;
        lastContextLossTrustedRef.current = event.isTrusted;
        event.preventDefault();
        lastContextLossDefaultPreventedRef.current = event.defaultPrevented;
      }
    };
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      sceneRef.current?.resize(parent.clientWidth, parent.clientHeight);
    };
    const contextRestored = () => {
      recovery.contextRestored();
      resize();
    };
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    window.addEventListener("resize", resize);
    const parent = canvas.parentElement;
    const stopResizeObserver = parent
      ? observeSceneResize(parent, resize, (callback) => (
        typeof ResizeObserver === "undefined" ? null : new ResizeObserver(callback)
      ))
      : () => undefined;

    return () => {
      window.removeEventListener("resize", resize);
      stopResizeObserver();
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      recovery.dispose();
      sceneRef.current = null;
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
