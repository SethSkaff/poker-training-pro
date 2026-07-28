/// <reference types="vite/client" />

type DesktopLifecycleEvent =
  | { kind: "window-minimized"; minimized: boolean }
  | { kind: "window-focus"; focused: boolean }
  | { kind: "system-suspend"; suspended: boolean }
  | { kind: "screen-lock"; locked: boolean }
  | { kind: "session-end" }
  | { kind: "before-quit" };

interface DesktopPrepareCloseRequest {
  requestId: number;
  cause: "close" | "lifecycle";
  report: (state: { hasUnsavedScoredProgress: boolean }) => Promise<unknown>;
}

interface Window {
  desktop?: import("./lib/durablePersistence").DesktopPersistenceBridge & {
    getVersion: () => Promise<string>;
    getAppInfo: () => Promise<import("./lib/creditsData").DesktopAppInfo>;
    readBundledDocument: (
      id: import("./lib/creditsData").BundledDocumentId,
    ) => Promise<
      | { ok: true; id: string; text: string }
      | { ok: false; error: string }
    >;
    openFolder: (
      target: "save" | "log",
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    quit: () => Promise<void>;
    /** Present only in the isolated packaged lifecycle smoke. */
    testLifecycleWindow?: (
      action: "minimize" | "restore",
    ) => Promise<{ ok: boolean }>;
    /** Present only in the packaged WebGL fallback audit. */
    forceWebGl2Failure?: true;
    setFullscreen: (fullscreen: boolean) => Promise<boolean>;
    getSafeModeState: () => Promise<{
      readonly available: boolean;
      readonly active: boolean;
      readonly reason?:
        | "repeated-startup-failures"
        | "repeated-renderer-failures";
      readonly failureCount: number;
      readonly recoveryMarkerRecovered: boolean;
    }>;
    onLifecycleEvent?: (
      listener: (event: DesktopLifecycleEvent) => void,
    ) => () => void;
    onPrepareClose?: (
      listener: (request: DesktopPrepareCloseRequest) => void,
    ) => () => void;
  };
}
