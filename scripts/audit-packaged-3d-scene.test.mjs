import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assertCase,
  assertForcedFallbackRunoutParity,
} from "./audit-packaged-3d-scene.mjs";

const electronMainSource = readFileSync(resolve("electron/main.cjs"), "utf8");

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
    pauseMenu: false,
    motion: { reducedMotion: false, rootCamera: "full", tableCamera: "full" },
    composition: {
      surfaceTransparent: true,
      surfaceRestored: false,
      duplicateFurnitureFaded: true,
      // Conditionally mounted DOM duplicates (opponent cards, seat bet, dealer
      // badge) must also contribute no ready-mode paint.
      conditionalDuplicatesFaded: true,
      readableHudMounted: true,
    },
  };
  return {
    kind: "webgl2",
    motionMode: "full",
    before: ready,
    fatal: [],
    interaction: {
      cameraMoved: true,
      heroAction: true,
      presentationSkips: 1,
      cameraInputParity: {
        agreed: true,
        routes: ["pointer", "keyboard", "gamepad"].map((via) => ({
          via, left: "-2", center: "0", right: "2", canvasFocused: false,
        })),
      },
      completedHand: { completed: true },
      heroDecisionStates: [
        { state: "unpeeked", peeked: false, screenshotBytes: 100, screenshotPngBase64: "fixture" },
        { state: "peeked", peeked: true, screenshotBytes: 100, screenshotPngBase64: "fixture" },
      ],
    },
    opponentActions: {
      stills: ["fold", "check", "call", "bet", "raise", "all-in"].map((action) => ({
        action,
        playerId: `villain-${action}`,
        label: action.toUpperCase(),
        stack: 1000,
        bet: 0,
        plaqueVisible: true,
        screenshotBytes: 100,
        screenshotPngBase64: "fixture",
      })),
      capturedActions: ["fold", "check", "call", "bet", "raise", "all-in"],
      missingActions: [],
      heroActions: 7,
      handsObserved: 4,
    },
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
      potLanes: [{ kind: "main", amount: 0 }],
      seats,
      markerPlayerIds: { button: null, smallBlind: null, bigBlind: null },
      actingPlayerId: null,
      sceneObjects: {
        boardCardCodes: [...boardCardCodes],
        potChipCount: 0,
        potLanes: [{ id: "main-0", amount: 0, chipCount: 0 }],
        seats: [{ id: "hero", stackChipCount: 0, betChipCount: 0 }],
        markers: { button: null, smallBlind: null, bigBlind: null },
        actingPlayerId: null,
      },
      unrevealedOpponentFaceCount: 0,
      screenshotBytes: 100,
      screenshotPngBase64: "fixture",
      };
    }),
    compositionMatrix: ["1024x768", "1100x720", "1280x720", "1366x768", "1920x1080", "2560x1080"].map((viewport) => ({
      ...ready,
      viewport,
      nativeWindow: {
        outerWidth: Number(viewport.split("x")[0]),
        outerHeight: Number(viewport.split("x")[1]),
        compactHeightMediaActive: Number(viewport.split("x")[1]) <= 800,
      },
      screenshotBytes: 100,
      screenshotPngBase64: "fixture",
      ...(["1366x768", "1920x1080"].includes(viewport) ? {
        silentReview: {
          durationMs: 5_000,
          screenshotBytes: 100,
          screenshotPngBase64: "fixture",
        },
      } : {}),
      panFrames: ["recenter", "left", "right"].map((pose) => ({
        pose,
        screenshotBytes: 100,
        screenshotPngBase64: "fixture",
      })),
    })),
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

test("scene package audit accepts two physical side-pot lanes from the deterministic runner", () => {
  const result = normalResult({
    sceneAuditSeed: "scene-side-pot-0",
    sidePotCapture: {
      handId: "fixture:hand-5",
      potLanes: [
        { kind: "main", amount: 1800 },
        { kind: "side", amount: 900 },
        { kind: "side", amount: 450 },
      ],
      sceneObjects: {
        potLanes: [
          { id: "main-0", amount: 1800, chipCount: 13 },
          { id: "side-1", amount: 900, chipCount: 12 },
          { id: "side-2", amount: 450, chipCount: 11 },
        ],
      },
      screenshotBytes: 100,
      screenshotPngBase64: "fixture",
    },
  });
  assert.doesNotThrow(() => assertCase(result));
});

test("scene package audit rejects a side-pot lane whose physical amount diverges from DOM", () => {
  const result = normalResult({
    sceneAuditSeed: "scene-side-pot-0",
    sidePotCapture: {
      handId: "fixture:hand-5",
      potLanes: [
        { kind: "main", amount: 1800 },
        { kind: "side", amount: 900 },
        { kind: "side", amount: 450 },
      ],
      sceneObjects: {
        potLanes: [
          { id: "main-0", amount: 1800, chipCount: 13 },
          { id: "side-1", amount: 899, chipCount: 12 },
          { id: "side-2", amount: 450, chipCount: 11 },
        ],
      },
      screenshotBytes: 100,
      screenshotPngBase64: "fixture",
    },
  });
  assert.throws(() => assertCase(result), /Physical two-side-pot lanes did not match/);
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
    motionMode: "full",
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

test("scene package audit rejects an incomplete scene-ready composition matrix", () => {
  const result = normalResult();
  result.compositionMatrix.pop();
  assert.throws(() => assertCase(result), /composition matrix was incomplete/);
});

test("scene package audit rejects a viewport-emulated composition capture", () => {
  const result = normalResult();
  result.compositionMatrix[0].nativeWindow.outerHeight = 920;
  result.compositionMatrix[0].nativeWindow.compactHeightMediaActive = false;
  assert.throws(() => assertCase(result), /composition matrix was incomplete/);
});

test("native audit sizing remains inaccessible to ordinary packaged launches", () => {
  assert.match(
    electronMainSource,
    /const auditWindowSize = lifecycleSmokeEnabled \? parseAuditWindowSize\(process\.argv\) : null;/,
  );
});

test("native audit forwards only an allowlisted deterministic scene seed to preload", () => {
  assert.match(
    electronMainSource,
    /const auditSceneSeed = lifecycleSmokeEnabled \? parseAuditSceneSeed\(process\.argv\) : null;/,
  );
  assert.match(
    electronMainSource,
    /\.\.\.\(auditSceneSeed \? \[`--ptp-scene-audit-seed=\$\{auditSceneSeed\}`\] : \[\]\),/,
  );
});

test("scene audit preserves a distinct durable report for each run", () => {
  const source = readFileSync(resolve("scripts/audit-packaged-3d-scene.mjs"), "utf8");
  assert.match(
    source,
    /packaged-3d-scene-audit-\$\{result\.kind\}-\$\{result\.motionMode\}-\$\{result\.sceneAuditSeed\}\.json/,
  );
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

test("scene package audit establishes resource stability from the first rebuilt scene", () => {
  const result = normalResult();
  for (const attempt of result.recovery.attempts) attempt.restored.diagnostics.resources += 3;
  assert.doesNotThrow(() => assertCase(result));
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

/*
  The regression this guards: `.opponent-cards` carries an `animation ... both`
  whose keyframed opacity outranks the ready-mode `opacity: 0`, so DOM card
  duplicates painted over the physical scene while the audit sampled only the
  three unanimated selectors and reported a clean composition.
*/
/*
 * Blocker: the forced-fallback path proved only its initial preflop capture,
 * because its presentation queue could advance between CDP samples. The in-page
 * recorder makes the whole runout comparable, so these gate that comparison.
 */
function runoutRecord(street, boardCardCodes, overrides = {}) {
  return {
    handId: "seed:hand-1",
    street,
    boardCards: boardCardCodes.length,
    boardCardCodes,
    scenePot: 400,
    potLanes: [{ kind: "main", amount: 400 }],
    seats: [{ id: "hero", stack: 900, bet: 0 }, { id: "villain", stack: 700, bet: 0 }],
    unrevealedOpponentFaceCount: 0,
    ...overrides,
  };
}

function runoutPair() {
  const streets = [
    ["preflop", []],
    ["flop", ["2♣", "7♦", "T♥"]],
    ["turn", ["2♣", "7♦", "T♥", "J♠"]],
    ["river", ["2♣", "7♦", "T♥", "J♠", "Q♣"]],
  ];
  return [
    { kind: "webgl2", publicRunout: streets.map(([street, codes]) => runoutRecord(street, codes)) },
    { kind: "forced-webgl-failure", publicRunout: streets.map(([street, codes]) => runoutRecord(street, codes)) },
  ];
}

test("forced fallback runout parity accepts identical public streets", () => {
  const outcome = assertForcedFallbackRunoutParity(runoutPair());
  assert.deepEqual(outcome, { compared: true, streets: ["preflop", "flop", "turn", "river"] });
});

test("forced fallback runout parity rejects a missing street", () => {
  const [webgl, forced] = runoutPair();
  forced.publicRunout = forced.publicRunout.filter((record) => record.street !== "turn");
  assert.throws(
    () => assertForcedFallbackRunoutParity([webgl, forced]),
    /did not reach every public street WebGL reached/,
  );
});

test("forced fallback runout parity rejects a divergent public street", () => {
  const [webgl, forced] = runoutPair();
  forced.publicRunout = forced.publicRunout.map((record) =>
    record.street === "river" ? { ...record, potLanes: [{ kind: "main", amount: 401 }] } : record,
  );
  assert.throws(
    () => assertForcedFallbackRunoutParity([webgl, forced]),
    /Forced fallback public river did not match normal WebGL/,
  );
});

test("forced fallback runout parity is skipped for a single-kind invocation", () => {
  const [webgl] = runoutPair();
  assert.deepEqual(
    assertForcedFallbackRunoutParity([webgl]),
    { compared: false, reason: "single-kind invocation" },
  );
});

test("scene package audit rejects camera input routes that disagree", () => {
  const result = normalResult();
  result.interaction.cameraInputParity = {
    agreed: false,
    routes: result.interaction.cameraInputParity.routes.map((route) =>
      route.via === "gamepad" ? { ...route, right: "1" } : route,
    ),
  };
  assert.throws(
    () => assertCase(result),
    /did not reach identical scene-camera states/,
  );
});

test("scene package audit rejects a camera input route that focused the decorative canvas", () => {
  const result = normalResult();
  result.interaction.cameraInputParity = {
    ...result.interaction.cameraInputParity,
    routes: result.interaction.cameraInputParity.routes.map((route) =>
      route.via === "keyboard" ? { ...route, canvasFocused: true } : route,
    ),
  };
  assert.throws(
    () => assertCase(result),
    /did not reach identical scene-camera states/,
  );
});

test("scene package audit rejects a missing terminal opponent-action still", () => {
  const result = normalResult();
  result.opponentActions = {
    ...result.opponentActions,
    stills: result.opponentActions.stills.filter((still) => still.action !== "check"),
    capturedActions: ["fold", "call", "bet", "raise", "all-in"],
    missingActions: ["check"],
  };
  assert.throws(() => assertCase(result), /Terminal opponent-action stills were incomplete/);
});

/*
 * 'all-in' comes from the `scene-side-pot-0` capped-lane fixture. A
 * runner-showdown-3 run cannot produce an opponent all-in without shoving the
 * hero's whole stack, which busts the hero out and destroys the live table the
 * lifecycle and recovery proofs need, so only the side-pot invocation is held to
 * all six kinds.
 */
test("scene package audit accepts a runner-showdown run without an opponent all-in still", () => {
  const result = normalResult();
  result.opponentActions = {
    ...result.opponentActions,
    stills: result.opponentActions.stills.filter((still) => still.action !== "all-in"),
  };
  assert.doesNotThrow(() => assertCase(result));
});

test("scene package audit requires the all-in still on the side-pot invocation", () => {
  const result = normalResult({ sceneAuditSeed: "scene-side-pot-0" });
  result.opponentActions = {
    ...result.opponentActions,
    stills: result.opponentActions.stills.filter((still) => still.action !== "all-in"),
  };
  assert.throws(() => assertCase(result), /Terminal opponent-action stills were incomplete/);
});

test("scene package audit rejects an opponent-action still whose seat plaque was not readable", () => {
  const result = normalResult();
  result.opponentActions.stills = result.opponentActions.stills.map((still) =>
    still.action === "raise" ? { ...still, plaqueVisible: false } : still,
  );
  assert.throws(() => assertCase(result), /Terminal opponent raise still was unusable/);
});

test("scene package audit rejects a conditionally mounted DOM duplicate that still paints", () => {
  const result = normalResult();
  result.before.composition.conditionalDuplicatesFaded = false;
  assert.throws(
    () => assertCase(result),
    /did not reveal 3D furniture while retaining the DOM HUD/,
  );
});

test("scene package audit rejects a matrix capture whose DOM duplicates still paint", () => {
  const result = normalResult();
  // The fixture shares one `composition` object across `before` and every
  // matrix capture, so this capture needs its own copy to isolate the failure.
  result.compositionMatrix[0].composition = {
    ...result.compositionMatrix[0].composition,
    conditionalDuplicatesFaded: false,
  };
  assert.throws(() => assertCase(result), /composition matrix was incomplete/);
});

test("scene package audit accepts a forced fallback with its required initial public capture", () => {
  const result = normalResult({
    kind: "forced-webgl-failure",
    before: {
      ...normalResult().before,
      forceFlag: true,
      scene: "fallback",
      composition: {
        ...normalResult().before.composition,
        surfaceTransparent: false,
        surfaceRestored: true,
        duplicateFurnitureFaded: false,
      },
      diagnostics: { ...normalResult().before.diagnostics, availability: "failed", reason: "blocked" },
    },
  });
  result.publicBeats.pop();
  assert.doesNotThrow(() => assertCase(result));
});

test("scene package audit rejects a minimize sample that has not suspended", () => {
  const result = normalResult();
  result.lifecycle.minimizedStart.diagnostics.suspended = false;
  result.lifecycle.minimizedStart.diagnostics.running = true;
  assert.throws(() => assertCase(result), /rendered while minimized/);
});
