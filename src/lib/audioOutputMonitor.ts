import type { AudioFocusEvent } from "./audioFocusPolicy";

export type TrackedOutputAvailability = boolean | "unknown";

export interface AudioOutputDescriptor {
  readonly deviceId: string;
  readonly kind: string;
}

/**
 * Exact-ID matching is the only portable signal strong enough to call a
 * previously selected output unavailable. An absent selection is unknown,
 * not disconnected.
 */
export function trackedOutputAvailability(
  devices: readonly AudioOutputDescriptor[],
  trackedDeviceId: string | null | undefined,
): TrackedOutputAvailability {
  if (!trackedDeviceId) return "unknown";
  return devices.some(
    (device) =>
      device.kind === "audiooutput" &&
      device.deviceId === trackedDeviceId,
  );
}

export interface AudioDeviceChangeSource {
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
  enumerateDevices(): Promise<readonly AudioOutputDescriptor[]>;
}

/**
 * Watches a selected output without requesting media permission. The monitor
 * reports only conclusive exact-ID availability changes and treats enumeration
 * errors as unknown.
 */
export class AudioOutputDeviceMonitor {
  private started = false;
  private generation = 0;
  private lastReported: boolean | undefined;

  constructor(
    private readonly source: AudioDeviceChangeSource,
    private readonly trackedDeviceId: () => string | null | undefined,
    private readonly dispatch: (event: AudioFocusEvent) => void,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.source.addEventListener("devicechange", this.handleDeviceChange);
    void this.refresh();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    this.source.removeEventListener("devicechange", this.handleDeviceChange);
  }

  async refresh(): Promise<TrackedOutputAvailability> {
    const requestGeneration = ++this.generation;
    let devices: readonly AudioOutputDescriptor[];
    try {
      devices = await this.source.enumerateDevices();
    } catch {
      return "unknown";
    }
    if (!this.started || requestGeneration !== this.generation) {
      return "unknown";
    }

    const availability = trackedOutputAvailability(
      devices,
      this.trackedDeviceId(),
    );
    if (
      availability !== "unknown" &&
      availability !== this.lastReported
    ) {
      this.lastReported = availability;
      this.dispatch({
        type: "output-availability",
        available: availability,
      });
    }
    return availability;
  }

  private readonly handleDeviceChange = (): void => {
    void this.refresh();
  };
}

