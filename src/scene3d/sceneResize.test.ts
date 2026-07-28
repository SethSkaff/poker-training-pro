import { describe, expect, it } from "vitest";
import { observeSceneResize } from "./sceneResize";

describe("scene resize ownership", () => {
  it("resizes immediately, follows container changes, and disconnects once", () => {
    let callback: (() => void) | undefined;
    let observed: object | undefined;
    let disconnects = 0;
    let resizes = 0;
    const target = {};
    const stop = observeSceneResize(target, () => { resizes += 1; }, (next) => {
      callback = next;
      return {
        observe: (entry) => { observed = entry; },
        disconnect: () => { disconnects += 1; },
      };
    });
    expect({ resizes, observed }).toEqual({ resizes: 1, observed: target });
    callback?.();
    expect(resizes).toBe(2);
    stop();
    stop();
    expect(disconnects).toBe(1);
  });

  it("keeps immediate size behavior without an observer fallback", () => {
    let resizes = 0;
    const stop = observeSceneResize({}, () => { resizes += 1; }, () => null);
    expect(resizes).toBe(1);
    stop();
  });
});
