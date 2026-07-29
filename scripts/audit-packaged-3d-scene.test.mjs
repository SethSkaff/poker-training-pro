import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCase } from "./audit-packaged-3d-scene.mjs";

function normalResult(overrides = {}) {
  const ready = {
    diagnostics: {
      availability: "ready",
      frameCount: 3,
      renderer: "ANGLE test renderer",
      contextLosses: 0,
      lastContextLossTrusted: null,
      lastContextLossDefaultPrevented: null,
      drawCalls: 7,
      triangles: 240,
      textures: 0,
      textureEstimateMiB: 0,
      resources: 12,
      firstFrameMs: 12,
      frameP50Ms: 8,
      frameP95Ms: 16,
      qualityTier: "unconfigured",
    },
    scene: "ready",
    tableCount: 1,
    seatCount: 6,
    liveRegionCount: 2,
    canvas: true,
    ariaHidden: "true",
    tabIndex: "-1",
    tableOpacity: 1,
    canvasVisible: true,
    composition: {
      surfaceTransparent: true,
      surfaceRestored: false,
      duplicateFurnitureFaded: true,
      readableHudMounted: true,
    },
  };
  return {
    kind: "webgl2",
    before: ready,
    fatal: [],
    interaction: { cameraMoved: true, heroAction: true, presentationSkips: 1, completedHand: { completed: true } },
    publicBeats: [
      ["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5],
    ].map(([street, boardCards]) => {
      const boardCardCodes = ["2♣", "7♦", "T♥", "J♠", "Q♣"].slice(0, boardCards);
      const seats = [{ id: "hero", stack: 0, bet: 0 }];
      return {
      street,
      boardCards,
      boardCardCodes,
      scenePot: 0,
      seats,
      markerPlayerIds: { button: null, smallBlind: null, bigBlind: null },
      actingPlayerId: null,
      sceneObjects: {
        boardCardCodes: [...boardCardCodes],
        potChipCount: 0,
        seats: [{ id: "hero", stackChipCount: 0, betChipCount: 0 }],
        markers: { button: null, smallBlind: null, bigBlind: null },
        actingPlayerId: null,
      },
      unrevealedOpponentFaceCount: 0,
      screenshotBytes: 100,
      screenshotPngBase64: "fixture",
      };
    }),
    lifecycle: {
      minimizedStart: { diagnostics: { ...ready.diagnostics, suspended: true, running: false } },
      minimized: { diagnostics: { ...ready.diagnostics, suspended: true, running: false } },
    },
    recovery: {
      attempts: [1, 2, 3].map((contextLosses) => ({
        loss: { supported: true, mechanism: "WEBGL_lose_context" },
        restore: { supported: true },
        fallback: { ...ready, scene: "fallback", composition: { ...ready.composition, surfaceTransparent: false, surfaceRestored: true }, diagnostics: { ...ready.diagnostics, availability: "lost", lastContextLossTrusted: true, lastContextLossDefaultPrevented: true } },
        restored: { ...ready, diagnostics: { ...ready.diagnostics, contextLosses } },
      })),
    },
    ...overrides,
  };
}

test("scene package audit accepts a classified normal and recovered scene", () => {
  assert.doesNotThrow(() => assertCase(normalResult()));
});

test("scene package audit rejects frames advancing while minimized", () => {
  const result = normalResult();
  result.lifecycle.minimized.diagnostics.frameCount = 4;
  assert.throws(() => assertCase(result), /rendered while minimized/);
});

test("scene package audit measures the freeze after native minimize has settled", () => {
  const result = normalResult();
  result.before.diagnostics.frameCount = 2;
  result.lifecycle.beforeMinimize = {
    diagnostics: { ...result.before.diagnostics, frameCount: 3 },
  };
  result.lifecycle.minimizedStart = {
    diagnostics: { ...result.before.diagnostics, suspended: true, running: false, frameCount: 4 },
  };
  result.lifecycle.minimized.diagnostics.frameCount = 4;
  assert.doesNotThrow(() => assertCase(result));
});

test("scene package audit rejects an unclassified forced fallback", () => {
  const fallback = normalResult().before;
  assert.throws(() => assertCase({
    kind: "forced-webgl-failure",
    before: { ...fallback, forceFlag: true, scene: "fallback", diagnostics: { ...fallback.diagnostics, availability: "idle" } },
    fatal: [],
    interaction: { cameraMoved: true, heroAction: true, presentationSkips: 0, completedHand: { completed: true } },
  }), /Unclassified scene diagnostics/);
});

test("scene package audit rejects a budget excess", () => {
  const result = normalResult();
  result.before.diagnostics.drawCalls = 151;
  assert.throws(() => assertCase(result), /budget exceeded/);
});

test("scene package audit rejects an invisible ready canvas", () => {
  const result = normalResult();
  result.before.canvasVisible = false;
  assert.throws(() => assertCase(result), /did not become ready/);
});

test("scene package audit rejects a ready canvas hidden under DOM furniture", () => {
  const result = normalResult();
  result.before.composition.surfaceTransparent = false;
  assert.throws(() => assertCase(result), /scene composition did not reveal/);
});

test("scene package audit rejects a fatal renderer event", () => {
  const result = normalResult();
  result.fatal = [{ kind: "console-error", description: "WebGL context failed" }];
  assert.throws(() => assertCase(result), /Fatal renderer event/);
});

test("scene package audit rejects an incomplete normal telemetry snapshot", () => {
  const result = normalResult();
  result.before.diagnostics.frameP50Ms = null;
  assert.throws(() => assertCase(result), /Incomplete scene diagnostics/);
});

test("scene package audit rejects resource growth across repeated context recovery", () => {
  const result = normalResult();
  result.recovery.attempts[2].restored.diagnostics.resources += 1;
  assert.throws(() => assertCase(result), /stable scene resources/);
});

test("scene package audit rejects an unmounted fallback DOM during recovery", () => {
  const result = normalResult();
  result.recovery.attempts[1].fallback.seatCount = 0;
  assert.throws(() => assertCase(result), /Context loss did not restore DOM fallback/);
});

test("scene package audit rejects a synthetic context-loss event", () => {
  const result = normalResult();
  result.recovery.attempts[0].fallback.diagnostics.lastContextLossTrusted = false;
  assert.throws(() => assertCase(result), /Context loss did not restore DOM fallback/);
});

test("scene package audit rejects a loss whose browser default was not prevented", () => {
  const result = normalResult();
  result.recovery.attempts[0].fallback.diagnostics.lastContextLossDefaultPrevented = false;
  assert.throws(() => assertCase(result), /Context loss did not restore DOM fallback/);
});

test("scene package audit rejects incomplete public street captures", () => {
  const result = normalResult();
  result.publicBeats.pop();
  assert.throws(() => assertCase(result), /public street captures were incomplete/);
});

test("scene package audit rejects a wrong public board count", () => {
  const result = normalResult();
  result.publicBeats[1].boardCards = 2;
  assert.throws(() => assertCase(result), /public street captures were incomplete/);
});

test("scene package audit rejects an unrevealed opponent card face at a public beat", () => {
  const result = normalResult();
  result.publicBeats[0].unrevealedOpponentFaceCount = 1;
  assert.throws(() => assertCase(result), /unrevealed opponent card/);
});

test("scene package audit rejects physical cards that diverge from the mounted DOM", () => {
  const result = normalResult();
  result.publicBeats[2].sceneObjects.boardCardCodes[3] = "A♠";
  assert.throws(() => assertCase(result), /Physical board or pot did not match/);
});

test("scene package audit rejects a physical marker assigned to a different DOM seat", () => {
  const result = normalResult();
  result.publicBeats[0].sceneObjects.markers.button = "villain";
  assert.throws(() => assertCase(result), /Physical markers or acting object did not match/);
});

test("scene package audit rejects renderer diagnostics that expose seat card identities", () => {
  const result = normalResult();
  result.publicBeats[0].sceneObjects.seats[0].cardCodes = ["A♠", "K♦"];
  assert.throws(() => assertCase(result), /Renderer object diagnostics leaked seat card identities/);
});

test("scene package audit requires the forced fallback to capture every public street", () => {
  const result = normalResult({
    kind: "forced-webgl-failure",
    before: {
      ...normalResult().before,
      forceFlag: true,
      scene: "fallback",
      diagnostics: { ...normalResult().before.diagnostics, availability: "failed", reason: "blocked" },
    },
  });
  result.publicBeats.pop();
  assert.throws(() => assertCase(result), /public street captures were incomplete/);
});

test("scene package audit rejects a minimize sample that has not suspended", () => {
  const result = normalResult();
  result.lifecycle.minimizedStart.diagnostics.suspended = false;
  result.lifecycle.minimizedStart.diagnostics.running = true;
  assert.throws(() => assertCase(result), /rendered while minimized/);
});
