/// <reference types="vite/client" />

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
  };
}
