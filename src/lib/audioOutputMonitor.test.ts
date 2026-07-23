import { describe, expect, it, vi } from "vitest";
import {
  AudioOutputDeviceMonitor,
  trackedOutputAvailability,
  type AudioOutputDescriptor,
} from "./audioOutputMonitor";

describe("tracked audio output availability", () => {
  const speakers = {
    kind: "audiooutput",
    deviceId: "speakers-1",
  };

  it("matches only an exact audio-output device ID", () => {
    expect(
      trackedOutputAvailability(
        [
          speakers,
          { kind: "audioinput", deviceId: "headset-1" },
        ],
        "speakers-1",
      ),
    ).toBe(true);
    expect(
      trackedOutputAvailability([speakers], "headset-1"),
    ).toBe(false);
    expect(
      trackedOutputAvailability(
        [{ kind: "audioinput", deviceId: "headset-1" }],
        "headset-1",
      ),
    ).toBe(false);
  });

  it("returns unknown without a tracked selection", () => {
    expect(trackedOutputAvailability([speakers], null)).toBe("unknown");
    expect(trackedOutputAvailability([speakers], "")).toBe("unknown");
  });

  it("reports removal and return from devicechange", async () => {
    const harness = deviceSource([speakers]);
    const dispatch = vi.fn();
    const monitor = new AudioOutputDeviceMonitor(
      harness.source,
      () => "speakers-1",
      dispatch,
    );

    monitor.start();
    await flush();
    harness.devices = [];
    harness.change();
    await flush();
    harness.devices = [speakers];
    harness.change();
    await flush();

    expect(dispatch.mock.calls).toEqual([
      [{ type: "output-availability", available: true }],
      [{ type: "output-availability", available: false }],
      [{ type: "output-availability", available: true }],
    ]);
  });

  it("deduplicates unchanged availability", async () => {
    const harness = deviceSource([speakers]);
    const dispatch = vi.fn();
    const monitor = new AudioOutputDeviceMonitor(
      harness.source,
      () => "speakers-1",
      dispatch,
    );

    monitor.start();
    await flush();
    harness.change();
    harness.change();
    await flush();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not infer removal from failed enumeration", async () => {
    const harness = deviceSource([speakers]);
    const dispatch = vi.fn();
    const monitor = new AudioOutputDeviceMonitor(
      harness.source,
      () => "speakers-1",
      dispatch,
    );
    monitor.start();
    await flush();
    harness.reject = true;

    const result = await monitor.refresh();

    expect(result).toBe("unknown");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("ignores a late result after stop", async () => {
    let resolveDevices:
      | ((devices: readonly AudioOutputDescriptor[]) => void)
      | undefined;
    const source = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn(
        () =>
          new Promise<readonly AudioOutputDescriptor[]>((resolve) => {
            resolveDevices = resolve;
          }),
      ),
    };
    const dispatch = vi.fn();
    const monitor = new AudioOutputDeviceMonitor(
      source,
      () => "speakers-1",
      dispatch,
    );

    monitor.start();
    monitor.stop();
    resolveDevices?.([speakers]);
    await flush();

    expect(dispatch).not.toHaveBeenCalled();
    expect(source.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

function deviceSource(initial: readonly AudioOutputDescriptor[]) {
  let listener: (() => void) | undefined;
  const harness = {
    devices: [...initial] as AudioOutputDescriptor[],
    reject: false,
    source: {
      addEventListener: vi.fn(
        (_type: "devicechange", next: () => void) => {
          listener = next;
        },
      ),
      removeEventListener: vi.fn(
        (_type: "devicechange", next: () => void) => {
          if (listener === next) listener = undefined;
        },
      ),
      enumerateDevices: vi.fn(async () => {
        if (harness.reject) throw new Error("permission/device failure");
        return harness.devices;
      }),
    },
    change() {
      listener?.();
    },
  };
  return harness;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

