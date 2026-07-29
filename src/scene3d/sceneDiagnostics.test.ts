import { describe, expect, it } from "vitest";
import { createSceneFrameTelemetry, installSceneDiagnosticsBridge } from "./sceneDiagnostics";

describe("scene diagnostics bridge", () => {
  it("publishes only the latest read-only diagnostic snapshot", () => {
    const host: Record<string, unknown> = {};
    let frames = 2;
    const remove = installSceneDiagnosticsBridge(host, () => ({
      availability: "ready" as const,
      frameCount: frames,
      running: true,
    }));

    const bridge = host.__ptpSceneDiagnostics as { snapshot(): unknown };
    expect(bridge.snapshot()).toEqual({
      availability: "ready",
      frameCount: 2,
      running: true,
    });
    frames = 3;
    expect(bridge.snapshot()).toEqual({
      availability: "ready",
      frameCount: 3,
      running: true,
    });
    expect(Object.keys(bridge)).toEqual(["snapshot"]);

    remove();
    expect(host.__ptpSceneDiagnostics).toBeUndefined();
  });

  it("does not remove a newer scene host during old-effect cleanup", () => {
    const host: Record<string, unknown> = {};
    const first = installSceneDiagnosticsBridge(host, () => ({ availability: "loading" }));
    const second = installSceneDiagnosticsBridge(host, () => ({ availability: "ready" }));
    first();
    expect((host.__ptpSceneDiagnostics as { snapshot(): unknown }).snapshot()).toEqual({ availability: "ready" });
    second();
    expect(host.__ptpSceneDiagnostics).toBeUndefined();
  });
});

describe("scene frame telemetry", () => {
  it("keeps bounded render-duration percentiles without scheduling frames", () => {
    const telemetry = createSceneFrameTelemetry(100, 3);
    telemetry.record(108, 5);
    telemetry.record(118, 10);
    telemetry.record(138, 20);
    telemetry.record(178, 40);
    telemetry.record(198, 30);
    expect(telemetry.snapshot()).toEqual({
      frameCount: 5,
      firstFrameMs: 8,
      frameP50Ms: 30,
      frameP95Ms: 40,
    });
  });
});
