#!/usr/bin/env node
/**
 * Rendered-side flash/luminance evidence for the packaged Windows build.
 *
 * docs/motion-flash-accessibility-policy.md already gates the CSS/script
 * *source* for hazardous animation signatures. That gate explicitly cannot
 * "calculate rendered luminance, saturated-red chromaticity, ... or
 * browser/Electron timing behavior" — this script fills that gap by
 * launching the packaged app under CDP, screenshotting four deterministically
 * reachable high-motion moments, and running the WCAG-2.3.1-threshold
 * implementation in scripts/release/flash-luminance-analysis-lib.mjs over
 * the captured frames. It repeats the pass with the app's own Reduce Motion
 * setting enabled to verify the static/short-path fallbacks.
 *
 * This is an implementation of the WCAG 2.3.1 thresholds, not a certified
 * photosensitive-epilepsy analysis tool — see the doc comment at the top of
 * flash-luminance-analysis-lib.mjs for the exact formulas and the
 * simplifications this script makes versus the full standard.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem, version as osVersion } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import { assertNoFatalCdpEvents } from "./release/packaged-render-smoke-lib.mjs";
import { decodePng } from "./release/png-decode-lib.mjs";
import {
  FLASH_CEILING_PER_SECOND,
  GENERAL_FLASH_DARK_CEILING,
  GENERAL_FLASH_LUMINANCE_DELTA,
  RED_FLASH_COVERAGE_DELTA,
  RED_HUE_MAX_DEGREES,
  RED_MIN_SATURATION,
  RED_MIN_VALUE,
  SLIDING_WINDOW_MS,
  evaluateFlashSequence,
  summarizeFramePixels,
} from "./release/flash-luminance-analysis-lib.mjs";
import { assertValidatedTemporaryProfile, canonicalJson } from "./release/runtime-performance-profile-lib.mjs";
import { projectRoot } from "./release/shared.mjs";
import { assertSupportedNodeVersion } from "./runtime-version.mjs";

assertSupportedNodeVersion({ workflow: "Packaged flash capture" });

const DEFAULT_APP = join(projectRoot, "outputs", "next", "win-unpacked", "Poker Training Pro.exe");
const PROFILE_PREFIX = "poker-training-pro-flash-capture-";
const LAUNCH_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 8_000;
// Waiting for the *next hand* is not a navigation step. Once the hero folds,
// the remaining five opponents must play the hand out -- possibly across three
// more streets -- before the button-moved milestone appears, and this audit
// deliberately does not skip presentations because the animations are what it
// is here to photograph. The 12 s every other step gets was calibrated when a
// hand was 8-9 actions; after the E11-002 correction hands run 24-46, so this
// step alone needs its own allowance.
const HAND_TRANSITION_TIMEOUT_MS = 75_000;
// Waits for the betting round to advance -- the flop appearing, or the hero
// being asked again -- sit between the two: they need a full orbit of
// opponents but not a whole hand.
const GAME_PROGRESS_TIMEOUT_MS = 45_000;
const CAPTURE_INTERVAL_MS = 100;
// Every-Nth-pixel sampling for the per-frame luminance/red-coverage
// reduction (see flash-luminance-analysis-lib.mjs summarizeFramePixels).
// Trades precision for decode/compute speed across the run's many
// full-viewport captures; documented in the report's limitations.
const ANALYSIS_PIXEL_STRIDE = 3;
const JSON_OUTPUT = join(projectRoot, "work", "packaged-flash-luminance-analysis.json");
const SUMMARY_OUTPUT = join(projectRoot, "work", "packaged-flash-luminance-analysis.md");

// Each sequence is reached the same way the existing packaged input smoke
// (scripts/audit-packaged-input-smoke.mjs) reaches it, using the same
// production selectors that script already validates.
const SEQUENCE_PLAN = [
  {
    id: "title-menu",
    label: "Title/menu ambient loop (Play/Settings screen drift + light animation)",
    durationMs: 3_000,
  },
  {
    id: "mode-select",
    label: "Mode selection screen",
    durationMs: 2_000,
  },
  {
    id: "room-flythrough-start",
    label: "Room fly-through start",
    durationMs: 1_500,
  },
  {
    id: "dealt-hand",
    label: "First dealt hand with chip/card motion",
    durationMs: 2_000,
  },
  {
    id: "hero-wager-travel",
    label: "Hero call visibly travels chips toward the pot",
    durationMs: 900,
    requiredSignal: "chipTravel",
  },
  {
    id: "board-card-progression",
    label: "Flop cards enter the board one at a time",
    durationMs: 1_100,
    requiredSignal: "boardProgression",
    // Staged entry is the thing Reduce Motion removes. Requiring it in the
    // reduced-motion pass demanded the animation in the very pass that exists
    // to verify animations are suppressed: measured board counts were
    // [1,1,1,2,2,2,3,3] with full motion and [4,4,4,...] with it reduced --
    // the board complete before the burst began. Both are correct.
    motionDependentSignal: true,
  },
  {
    id: "hero-fold-state",
    label: "Hero fold is visible before the hand can resolve",
    durationMs: 900,
    requiredSignal: "heroFolded",
  },
  {
    id: "dealer-button-move",
    label: "Dealer button travels before the next hand posts blinds",
    durationMs: 900,
    requiredSignal: "dealerMove",
  },
];

export async function runPackagedFlashCapture(options = {}) {
  if (process.platform !== "win32") {
    throw new Error("The packaged flash capture currently supports Windows only.");
  }
  const appPath = resolve(options.appPath ?? DEFAULT_APP);
  const buildIdentity = await readBuildIdentity(appPath);
  const hostIdentity = readHostIdentity();

  const passes = [];
  for (const passDefinition of [
    { passId: "full-motion", reducedMotion: false },
    { passId: "reduced-motion", reducedMotion: true },
  ]) {
    passes.push(await runCapturePass(appPath, passDefinition));
  }

  const overallPass = passes.every((pass) => pass.pass);
  const allIntervals = passes
    .flatMap((pass) => pass.sequences)
    .map((sequence) => sequence.achievedMeanFrameIntervalMs)
    .filter((value) => typeof value === "number");
  const slowestAchievedIntervalMs = allIntervals.length ? Math.max(...allIntervals) : null;
  const impliedNyquistFlashCeilingPerSecond =
    slowestAchievedIntervalMs && slowestAchievedIntervalMs > 0
      ? round(500 / slowestAchievedIntervalMs, 2)
      : null;
  const report = {
    format: "poker-training-pro-packaged-flash-luminance-analysis",
    version: 1,
    capturedAt: new Date().toISOString(),
    scope: "single-host-rendered-capture",
    methodologyNote:
      "This is an implementation of the WCAG 2.3.1 thresholds (see the doc comment in scripts/release/flash-luminance-analysis-lib.mjs), not a certified photosensitive-epilepsy analysis tool.",
    build: buildIdentity,
    host: hostIdentity,
    captureConfig: {
      captureIntervalMs: CAPTURE_INTERVAL_MS,
      analysisPixelStride: ANALYSIS_PIXEL_STRIDE,
      ceilingFlashesPerSecond: FLASH_CEILING_PER_SECOND,
      slidingWindowMs: SLIDING_WINDOW_MS,
    },
    thresholds: {
      generalFlashLuminanceDelta: GENERAL_FLASH_LUMINANCE_DELTA,
      generalFlashDarkCeiling: GENERAL_FLASH_DARK_CEILING,
      redFlashCoverageDelta: RED_FLASH_COVERAGE_DELTA,
      redHueMaxDegrees: RED_HUE_MAX_DEGREES,
      redMinSaturation: RED_MIN_SATURATION,
      redMinValue: RED_MIN_VALUE,
    },
    sequencePlan: SEQUENCE_PLAN.map((sequence) => ({
      id: sequence.id,
      label: sequence.label,
      plannedDurationMs: sequence.durationMs,
    })),
    passes,
    overallPass,
    limitations: [
      "One rendered capture pass per motion setting on one host; this is not a low-spec, typical, or discrete-GPU hardware matrix, and it is not the recognized photosensitive-epilepsy analysis tool the release policy still requires before shipping a hazardous-if-wrong sequence.",
      "Frames are captured by repeatedly calling CDP Page.captureScreenshot on a fixed interval; timestamps reflect when each screenshot command was issued from Node, not a frame-accurate compositor capture, so very short (sub-interval) transitions can be missed or their timing smeared.",
      slowestAchievedIntervalMs !== null
        ? `On this host the achieved screenshot interval was well above the ${CAPTURE_INTERVAL_MS}ms request on the slower sequences (worst observed mean: ${slowestAchievedIntervalMs}ms/frame, i.e. roughly ${impliedNyquistFlashCeilingPerSecond} fps). By the Nyquist rate, that sequence's run can only reliably rule out flashing up to about half that frame rate; a "pass" on a sparsely-sampled sequence is weaker evidence than on a densely-sampled one, and should not be read as confidently ruling out sub-second flashing on its own. See each sequence's achievedMeanFrameIntervalMs.`
        : "Frame counts and achieved capture intervals are recorded per sequence; treat sparsely-sampled sequences as weaker evidence for ruling out fast flashing.",
      "The general-flash and red-flash detectors implement the WCAG 2.3.1 glossary definitions with documented simplifications (whole-captured-region area instead of a 341x256px sub-block scan; an HSV-based saturated-red approximation instead of the CIE chromaticity polygon; a 10-percentage-point red-coverage swing standing in for WCAG's undefined red-flash transition magnitude). See scripts/release/flash-luminance-analysis-lib.mjs.",
      `Per-frame luminance/red-coverage summaries sample every Nth pixel (stride ${ANALYSIS_PIXEL_STRIDE}, not every pixel) for decode/compute speed across the run's many full-viewport captures; this can under-count a hazard confined to a very small area.`,
      "Sequences are limited to what is deterministically reachable without gameplay randomness: the Play/Settings menu, mode selection, the start of the room fly-through, and the first dealt hand of a live tournament table. Later hands, other modes' presentation states, hover/focus transitions, and settings-screen motion are not covered by this run.",
      "The reduced-motion pass sets the app's own saved Reduce Motion setting (the mechanism this codebase actually reads; it does not currently read the operating-system prefers-reduced-motion media query). Testing the OS-level preference path remains a separate manual check per docs/motion-flash-accessibility-policy.md.",
    ],
  };
  await writeReportArtifacts(report);
  return report;
}

async function runCapturePass(appPath, { passId, reducedMotion }) {
  const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
  assertValidatedTempProfile(profile);
  const child = spawn(
    appPath,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
    ],
    {
      cwd: projectRoot,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  const output = captureBoundedOutput(child, 8_192);
  const navigationBudgetMs = SEQUENCE_PLAN.reduce((sum, seq) => sum + seq.durationMs + NAVIGATION_TIMEOUT_MS, 0);
  // The hand-transition wait is budgeted separately: it is the one step whose
  // length is set by how long a hand of poker takes, not by the renderer.
  const deadline =
    Date.now() + LAUNCH_TIMEOUT_MS + navigationBudgetMs +
    NAVIGATION_TIMEOUT_MS * 3 + HAND_TRANSITION_TIMEOUT_MS +
    GAME_PROGRESS_TIMEOUT_MS * 2;
  let cdp;
  const sequences = [];

  try {
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    assertNoFatalCdpEvents(cdp.takeFatalEvents());

    // A fresh isolated profile always starts at the real first-run setup
    // screen (the packaged app's authoritative save lives behind the
    // `window.desktop` bridge, not localStorage — see
    // src/lib/durablePersistence.ts). Walk it the same way the existing
    // packaged input smoke (scripts/audit-packaged-input-smoke.mjs) does, so
    // the reduced-motion pass exercises the app's real saved Reduce Motion
    // setting instead of a synthetic override.
    await waitForSelector(
      cdp,
      child,
      output,
      deadline,
      ".first-run-options label:nth-of-type(1) input[type=checkbox]",
      "first-run reduced-motion checkbox",
    );
    if (reducedMotion) {
      await clickSelector(cdp, ".first-run-options label:nth-of-type(1) input[type=checkbox]");
    }
    await clickSelectorWithText(cdp, "button", "Save and continue");

    // Sequence 1: title/menu ambient loop (Play/Settings screen).
    await waitForSelector(cdp, child, output, deadline, ".home-reference", "title/menu screen");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("title-menu"), reducedMotion));

    // Sequence 2: mode selection.
    await clickSelector(cdp, ".home-reference__hit--play");
    await delay(250);
    await clickIfPresent(cdp, "#play-chip-ack-title ~ .startup-gate__actions button");
    await waitForSelector(cdp, child, output, deadline, ".mode-stage", "mode selection screen");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("mode-select"), reducedMotion));

    // Sequence 3: room fly-through start (Normal mode -> live tournament arrival).
    await clickSelector(cdp, ".mode-stage__choice--normal");
    await clickSelectorWithText(cdp, "button", "Enter event");
    await waitForSelector(cdp, child, output, deadline, ".room-flight", "room fly-through");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("room-flythrough-start"), reducedMotion));
    // The capture burst above can outlast the flythrough's own auto-complete
    // timer (the flythrough is not paused for screenshotting), so the skip
    // control may already be gone by the time we get here; either path leads
    // to the live table next, so a missing skip button is not a failure.
    await clickIfPresent(cdp, ".room-flight__skip");

    // Sequence 4: first dealt hand (live tournament table, chip/card motion).
    await waitForSelector(cdp, child, output, deadline, ".poker-table", "live tournament table");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("dealt-hand"), reducedMotion));

    // Sequence 5: use an ordinary visible Call control, then observe the
    // renderer's public chip-travel token. This does not inject an engine
    // action or bypass the presentation queue: it is the same mouse path a
    // player uses. A call can legally be all-in; both outcomes still produce
    // a public wager and therefore the same travel affordance.
    await waitForSelector(cdp, child, output, deadline, ".action-dock", "first hero decision");
    await clickSelector(cdp, ".action-button--call");
    await waitForSelector(cdp, child, output, deadline, ".chip-travel", "hero wager chip travel");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("hero-wager-travel"), reducedMotion));

    // A flop is not guaranteed by the hero calling. That assumption held when
    // the pre-E11-002 policy almost never folded, so a called pot always saw
    // a board; the corrected policy folds 46% of the time facing a bet, and a
    // hand now frequently ends preflop with the blinds uncontested. Waiting
    // longer cannot fix that -- the event being waited for never happens -- so
    // this plays on, calling when asked, until a flop is actually dealt.
    await reachProgressiveFlop(cdp, child, output, deadline);
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("board-card-progression"), reducedMotion));

    // Let the public queue advance to the next real hero decision, then fold
    // through the normal player control. The capture starts while the folded
    // table state is visible and before a result strip can replace it.
    await waitForSelector(cdp, child, output, deadline, ".action-dock", "next hero decision after call", GAME_PROGRESS_TIMEOUT_MS);
    await clickSelector(cdp, ".action-button--fold");
    await waitForSelector(cdp, child, output, deadline, ".player-seat--hero.is-folded", "visible hero fold state");
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("hero-fold-state"), reducedMotion));

    // The hero remains seated after folding. Once the public hand settles,
    // the next hand starts with the button-moved milestone before blind posts.
    await waitForSelector(cdp, child, output, deadline, ".dealer-button-travel", "dealer button travel between hands", HAND_TRANSITION_TIMEOUT_MS);
    sequences.push(await captureAndAnalyzeSequence(cdp, sequenceById("dealer-button-move"), reducedMotion));

    assertNoFatalCdpEvents(cdp.takeFatalEvents());
  } finally {
    try {
      cdp?.close();
    } catch {
      // Exact process-tree termination remains authoritative.
    }
    let terminationError;
    let cleanupError;
    try {
      await terminateProcessTree(child);
    } catch (error) {
      terminationError = error;
    }
    try {
      await removeValidatedTempProfile(profile);
    } catch (error) {
      cleanupError = error;
    }
    if (terminationError || cleanupError) {
      throw new AggregateError(
        [terminationError, cleanupError].filter(Boolean),
        `Flash-capture pass "${passId}" cleanup failed.`,
      );
    }
  }

  return {
    passId,
    reducedMotionSetting: reducedMotion,
    sequences,
    pass: sequences.every((sequence) => sequence.pass),
  };
}

function sequenceById(id) {
  const sequence = SEQUENCE_PLAN.find((candidate) => candidate.id === id);
  if (!sequence) throw new Error(`Unknown sequence id: ${id}`);
  return sequence;
}

async function captureAndAnalyzeSequence(cdp, sequenceDefinition, reducedMotion = false) {
  const rawFrames = await captureBurst(cdp, sequenceDefinition.durationMs);
  const frames = rawFrames.map((rawFrame) => {
    const decoded = decodePng(Buffer.from(rawFrame.dataBase64, "base64"));
    const summary = summarizeFramePixels(decoded.pixels, decoded.width, decoded.height, {
      stride: ANALYSIS_PIXEL_STRIDE,
    });
    return {
      timestampMs: rawFrame.timestampMs,
      width: decoded.width,
      height: decoded.height,
      meanRelativeLuminance: round(summary.meanRelativeLuminance, 6),
      saturatedRedCoverage: round(summary.saturatedRedCoverage, 6),
    };
  });
  const evaluation = evaluateFlashSequence({ sequenceId: sequenceDefinition.id, frames });
  const perceptualSignals = summarizePerceptualSignals(rawFrames);
  const signalRequired = Boolean(
    sequenceDefinition.requiredSignal &&
      !(reducedMotion && sequenceDefinition.motionDependentSignal),
  );
  const signalPass = signalRequired
    ? perceptualSignals[sequenceDefinition.requiredSignal]?.observed === true
    : true;
  const achievedMeanFrameIntervalMs =
    frames.length > 1 ? round(evaluation.durationMs / (frames.length - 1), 1) : null;
  return {
    id: sequenceDefinition.id,
    label: sequenceDefinition.label,
    plannedDurationMs: sequenceDefinition.durationMs,
    plannedCaptureIntervalMs: CAPTURE_INTERVAL_MS,
    frameCount: frames.length,
    ...(sequenceDefinition.requiredSignal && !signalRequired
      ? { requiredSignalWaived: "reduced-motion suppresses this animation by design" }
      : {}),
    capturedDurationMs: evaluation.durationMs,
    // Actual achieved interval between screenshots, which on this host ran
    // well above the CAPTURE_INTERVAL_MS request (CDP round-trip + PNG
    // encode overhead). This bounds how fast a real flash could be and
    // still be reliably detected by this run — see the report's
    // limitations for the Nyquist-rate implication.
    achievedMeanFrameIntervalMs,
    frames,
    generalFlash: {
      maxPerSecond: evaluation.generalFlash.maxPerSecond,
      eventCount: evaluation.generalFlash.events.length,
      eventTimestampsMs: evaluation.generalFlash.events.map((event) => event.atMs),
      pass: evaluation.generalFlash.pass,
    },
    redFlash: {
      maxPerSecond: evaluation.redFlash.maxPerSecond,
      eventCount: evaluation.redFlash.events.length,
      eventTimestampsMs: evaluation.redFlash.events.map((event) => event.atMs),
      pass: evaluation.redFlash.pass,
    },
    perceptualSignals,
    pass: evaluation.pass && signalPass,
  };
}

// The previous run's achieved capture cadence (see docs/rendered-flash-
// luminance-analysis.md and work/packaged-flash-luminance-analysis.md) was
// far slower than the CAPTURE_INTERVAL_MS request on several sequences (up to
// ~1.4s/frame), driven by Chromium's Page.captureScreenshot encode time, not
// by this script's own PNG decode step (decode happens after the burst, off
// the capture-cadence critical path; see captureAndAnalyzeSequence). CDP's
// `optimizeForSpeed` capture flag asks Chromium to use a faster, lower-effort
// PNG encoder path instead of its default size-optimized one, trading file
// size for encode latency; the output remains a standard PNG that
// png-decode-lib.mjs's generic zlib-based decoder reads unchanged. Some
// Chromium builds may not accept the flag, so the first call each pass
// probes it and silently falls back to a plain capture if it errors.
let optimizeForSpeedSupported = true;

async function captureBurst(cdp, durationMs) {
  const frames = [];
  const start = Date.now();
  const maxFrames = Math.ceil(durationMs / CAPTURE_INTERVAL_MS) + 2;
  while (Date.now() - start < durationMs && frames.length < maxFrames) {
    const frameStart = Date.now();
    const shot = await captureScreenshotFast(cdp);
    frames.push({
      timestampMs: frameStart - start,
      dataBase64: shot.data,
      presentation: await readPresentationSignals(cdp),
    });
    const remaining = CAPTURE_INTERVAL_MS - (Date.now() - frameStart);
    if (remaining > 0) await delay(remaining);
  }
  if (frames.length < 2) {
    throw new Error("Flash capture burst produced fewer than two frames.");
  }
  return frames;
}

/**
 * Read only public DOM state alongside each rendered frame. The screenshot is
 * still the primary visual artifact; these signals make the resulting gate
 * fail if an otherwise-similar frame burst was captured after a transition
 * had already been replaced by its end state.
 */
async function readPresentationSignals(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const table = document.querySelector('.poker-table');
      if (!window.__ptpPerceptualTable && table) window.__ptpPerceptualTable = table;
      const chip = document.querySelector('.chip-travel');
      return {
        tableStable: Boolean(table && window.__ptpPerceptualTable === table),
        chipTravel: Boolean(chip),
        chipAnimationMs: chip instanceof HTMLElement
          ? Number.parseFloat(getComputedStyle(chip).animationDuration) * 1000
          : 0,
        heroFolded: Boolean(document.querySelector('.player-seat--hero.is-folded')),
        handResultVisible: Boolean(document.querySelector('.showdown-result-strip')),
        boardEntering: Boolean(document.querySelector('.board-card-entering')),
        communityCardCount: document.querySelectorAll('.community-cards .playing-card').length,
        dealerMoving: Boolean(document.querySelector('.dealer-button-travel')),
        dealerAnimationMs: (() => {
          const dealer = document.querySelector('.dealer-button-travel');
          return dealer instanceof HTMLElement
            ? Number.parseFloat(getComputedStyle(dealer).animationDuration) * 1000
            : 0;
        })(),
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? {};
}

function summarizePerceptualSignals(rawFrames) {
  const signals = rawFrames.map((frame) => frame.presentation ?? {});
  const chipTravelFrames = signals.filter((signal) => signal.chipTravel === true);
  const heroFoldedFrames = signals.filter((signal) => signal.heroFolded === true);
  return {
    tableStable: {
      observed: signals.length > 0 && signals.every((signal) => signal.tableStable === true),
    },
    chipTravel: {
      observed: chipTravelFrames.length > 0 && chipTravelFrames.some((signal) => signal.chipAnimationMs > 0),
      frameCount: chipTravelFrames.length,
      animationDurationsMs: chipTravelFrames.map((signal) => signal.chipAnimationMs),
    },
    heroFolded: {
      observed: heroFoldedFrames.length > 0 && heroFoldedFrames.some((signal) => signal.handResultVisible === false),
      frameCount: heroFoldedFrames.length,
    },
    boardProgression: {
      observed: signals.some((signal) => signal.boardEntering === true) &&
        new Set(signals.map((signal) => signal.communityCardCount).filter(Number.isFinite)).size >= 2,
      counts: signals.map((signal) => signal.communityCardCount),
    },
    dealerMove: {
      observed: signals.some((signal) => signal.dealerMoving === true && signal.dealerAnimationMs > 0),
      animationDurationsMs: signals
        .filter((signal) => signal.dealerMoving === true)
        .map((signal) => signal.dealerAnimationMs),
    },
  };
}

async function captureScreenshotFast(cdp) {
  if (optimizeForSpeedSupported) {
    try {
      return await cdp.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
      });
    } catch {
      optimizeForSpeedSupported = false;
    }
  }
  return cdp.send("Page.captureScreenshot", { format: "png" });
}

async function clickIfPresent(cdp, selector) {
  const point = await selectorPoint(cdp, selector);
  if (!point) return false;
  await mouseClick(cdp, point.x, point.y);
  await delay(180);
  return true;
}

/**
 * Plays forward until the flop is actually being dealt.
 *
 * The board-card-progression capture needs a real flop. Whether one arrives is
 * up to the table: after the E11-002 correction the field folds often enough
 * that a called pot regularly ends preflop. Rather than wait on an event that
 * may never occur in this hand, take the ordinary Call control whenever the
 * hero is asked and let the next hand run, bounded by hands and by the global
 * deadline. Every action here is the same mouse path a player uses.
 */
async function reachProgressiveFlop(cdp, child, output, deadline) {
  const maxHands = 12;
  for (let attempt = 0; attempt < maxHands; attempt += 1) {
    const localDeadline = Math.min(deadline, Date.now() + GAME_PROGRESS_TIMEOUT_MS);
    while (Date.now() < localDeadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Packaged app exited while waiting for a flop (code ${child.exitCode}): ${output.stderr.slice(-300)}`,
        );
      }
      const state = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          if (document.querySelector('.board-card-entering')) return 'flop';
          if (document.querySelector('.ceremony-board')) return 'ceremony';
          const call = document.querySelector('.action-button--call');
          const check = document.querySelector('.action-button--check');
          const button = call || check;
          if (button instanceof HTMLButtonElement && !button.disabled) {
            button.click();
            return 'acted';
          }
          return 'waiting';
        })()`,
        returnByValue: true,
      });
      const value = state.result?.value;
      if (value === 'flop') return;
      if (value === 'ceremony') {
        throw new Error(
          'The event ended before any flop was dealt, so the board-card progression could not be captured.',
        );
      }
      await delay(50);
    }
  }
  throw new Error(
    `No flop was dealt within ${maxHands} hands, so the board-card progression could not be captured.`,
  );
}

async function waitForSelector(cdp, child, output, deadline, selector, label, allowanceMs = NAVIGATION_TIMEOUT_MS + 4_000) {
  const localDeadline = Math.min(deadline, Date.now() + allowanceMs);
  while (Date.now() < localDeadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged app exited while waiting for ${label} (code ${child.exitCode}): ${output.stderr.slice(-300)}`,
      );
    }
    const found = await evaluateBoolean(cdp, `document.querySelector(${JSON.stringify(selector)}) !== null`);
    if (found) return;
    await delay(50);
  }
  // "Timed out waiting for X" is equally true of a crashed renderer, a
  // finished event, and a hand that simply never reached that state, and those
  // have nothing in common. Say which screen was actually up.
  let screen = "unavailable";
  try {
    const described = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const has = (s) => document.querySelector(s) !== null;
        return JSON.stringify({
          table: has('.poker-table'),
          ceremony: has('.ceremony-board'),
          flythrough: has('.room-flight'),
          arrival: has('.room-progress-overlay'),
          modeStage: has('.mode-stage'),
          home: has('.home-reference'),
          actionDock: has('.action-dock'),
          board: document.querySelectorAll('.board-card').length,
          loading: has('.scene-loading'),
        });
      })()`,
      returnByValue: true,
    });
    screen = String(described.result?.value ?? "unavailable");
  } catch {
    screen = "unavailable (the renderer did not answer)";
  }
  throw new Error(
    `Timed out waiting for ${label} (${selector}). On screen: ${screen}`,
  );
}

async function clickSelector(cdp, selector) {
  const point = await selectorPoint(cdp, selector);
  if (!point) throw new Error(`Click target not found or not clickable: ${selector}`);
  await mouseClick(cdp, point.x, point.y);
  await delay(180);
}

async function clickSelectorWithText(cdp, selector, exactText) {
  const point = await selectorPoint(cdp, selector, exactText);
  if (!point) throw new Error(`Click target not found: ${selector} with text "${exactText}"`);
  await mouseClick(cdp, point.x, point.y);
  await delay(180);
}

async function selectorPoint(cdp, selector, exactText) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const target = candidates.find((element) => {
        if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
        return ${exactText === undefined ? "true" : `(element.textContent || '').trim() === ${JSON.stringify(exactText)}`};
      });
      if (!(target instanceof HTMLElement)) return null;
      const box = target.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function evaluateBoolean(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return result.result?.value === true;
}

async function readBuildIdentity(appPath) {
  const [exeMetadata] = await Promise.all([stat(appPath)]);
  return {
    executable: {
      fileName: basename(appPath),
      sizeBytes: exeMetadata.size,
      sha256: await sha256File(appPath),
    },
  };
}

function readHostIdentity() {
  const cpuList = cpus();
  const identity = {
    platform: platform(),
    osRelease: osRelease(),
    osVersion: osVersion(),
    architecture: arch(),
    logicalCpuCount: cpuList.length,
    cpuModels: [...new Set(cpuList.map((cpu) => cpu.model.trim()))].sort(),
    totalMemoryBytes: totalmem(),
    nodeVersion: process.versions.node,
  };
  return {
    ...identity,
    anonymousFingerprintSha256: createHash("sha256").update(canonicalJson(identity)).digest("hex"),
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function writeReportArtifacts(report) {
  await mkdir(join(projectRoot, "work"), { recursive: true });
  const lines = [
    "# Packaged rendered flash/luminance analysis",
    "",
    `- Scope: one host, ${report.passes.length} capture passes (${report.capturedAt})`,
    `- Method: implementation of the WCAG 2.3.1 thresholds (see scripts/release/flash-luminance-analysis-lib.mjs) — not a certified analysis tool.`,
    `- Build: ${report.build.executable.fileName} (${report.build.executable.sha256.slice(0, 12)})`,
    `- Host: ${report.host.osVersion}, ${report.host.logicalCpuCount} logical CPUs`,
    `- Overall result: ${report.overallPass ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const pass of report.passes) {
    lines.push(`## Pass: ${pass.passId} (reducedMotion=${pass.reducedMotionSetting})`, "");
    lines.push("| Sequence | Frames | Achieved ms/frame | General flash/s (max) | Red flash/s (max) | Result |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const sequence of pass.sequences) {
      lines.push(
        `| ${sequence.label} | ${sequence.frameCount} | ${sequence.achievedMeanFrameIntervalMs ?? "n/a"} | ${sequence.generalFlash.maxPerSecond} | ${sequence.redFlash.maxPerSecond} | ${sequence.pass ? "pass" : "FAIL"} |`,
      );
    }
    lines.push("", `Pass result: ${pass.pass ? "PASS" : "FAIL"}`, "");
  }
  lines.push(
    "This is one rendered capture pass per motion setting on one host. It does not replace a recognized",
    "photosensitive-epilepsy analysis tool, the low-spec/typical/discrete-GPU hardware matrix, or manual",
    "reduced-motion acceptance on the signed release candidate. See the JSON `limitations` field.",
    "",
  );
  await atomicWrite(JSON_OUTPUT, canonicalJson(report));
  await atomicWrite(SUMMARY_OUTPUT, `${lines.join("\n")}\n`);
}

async function atomicWrite(destination, contents) {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "w" });
  await rename(temporary, destination);
}

async function removeValidatedTempProfile(profile) {
  assertValidatedTempProfile(profile);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function assertValidatedTempProfile(profile) {
  assertValidatedTemporaryProfile(profile, tmpdir(), PROFILE_PREFIX);
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseArguments(arguments_) {
  let appPath = DEFAULT_APP;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--app") {
      appPath = arguments_[++index];
      if (!appPath) throw new Error("--app requires a value.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { appPath };
}

const isMain =
  typeof process.argv[1] === "string" && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

/** A CDP deadline proves neither a presentation pass nor a product failure. */
export function classifyCaptureFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^CDP command .* timed out\.$/.test(message)
    ? "inconclusive-cdp-timeout"
    : "product-failure";
}

if (isMain) {
  try {
    const report = await runPackagedFlashCapture(parseArguments(process.argv.slice(2)));
    console.log(
      [
        `Packaged flash/luminance analysis ${report.overallPass ? "passed" : "FAILED"}.`,
        ...report.passes.map(
          (pass) =>
            `Pass ${pass.passId}: ${pass.pass ? "pass" : "FAIL"} (${pass.sequences
              .map((sequence) => `${sequence.id}=${sequence.pass ? "pass" : "FAIL"}`)
              .join(", ")}).`,
        ),
        `JSON: ${relative(projectRoot, JSON_OUTPUT).split(sep).join("/")}.`,
        `Summary: ${relative(projectRoot, SUMMARY_OUTPUT).split(sep).join("/")}.`,
      ].join(" "),
    );
    if (!report.overallPass) process.exitCode = 1;
  } catch (error) {
    const outcome = classifyCaptureFailure(error);
    console.error(
      `Packaged flash/luminance analysis ${outcome}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = outcome === "inconclusive-cdp-timeout" ? 2 : 1;
  }
}
