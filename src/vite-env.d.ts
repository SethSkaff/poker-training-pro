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
    quit: () => Promise<void>;
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
