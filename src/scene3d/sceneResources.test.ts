import { describe, expect, it } from "vitest";
import { createSceneResourceLedger } from "./sceneResources";

describe("scene resource ledger", () => {
  it("disposes every unique renderer-local allocation exactly once", () => {
    const ledger = createSceneResourceLedger();
    let geometry = 0;
    let material = 0;
    const shared = { dispose: () => { geometry += 1; } };
    ledger.track(shared);
    ledger.track(shared);
    ledger.track({ dispose: () => { material += 1; } });
    expect(ledger.counts()).toEqual({ resources: 2, disposed: false });

    ledger.dispose();
    ledger.dispose();
    expect({ geometry, material }).toEqual({ geometry: 1, material: 1 });
    expect(ledger.counts()).toEqual({ resources: 0, disposed: true });
  });

  it("immediately releases an allocation received after disposal", () => {
    const ledger = createSceneResourceLedger();
    ledger.dispose();
    let releases = 0;
    ledger.track({ dispose: () => { releases += 1; } });
    expect(releases).toBe(1);
  });

  it("does not retain allocations across a 100-mount disposal soak", () => {
    let releases = 0;
    for (let mount = 0; mount < 100; mount += 1) {
      const ledger = createSceneResourceLedger();
      ledger.track({ dispose: () => { releases += 1; } });
      ledger.track({ dispose: () => { releases += 1; } });
      ledger.dispose();
      expect(ledger.counts()).toEqual({ resources: 0, disposed: true });
    }
    expect(releases).toBe(200);
  });
});
