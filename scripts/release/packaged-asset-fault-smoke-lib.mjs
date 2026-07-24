import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertValidatedTemporaryProfile } from "./runtime-performance-profile-lib.mjs";
import {
  EXPECTED_DOCUMENT_URL,
  EXPECTED_TITLE,
  RenderSmokeFailure,
} from "./packaged-render-smoke-lib.mjs";

export const ASSET_FAULT_PROFILE_PREFIX =
  "poker-training-pro-asset-fault-";
export const START_MENU_ASSET_PATH = "/start-menu-reference.png";
export const ROOM_ASSET_PATH = "/start-menu-room.png";
export const AMBIENT_VIDEO_ASSET_PATH = "/start-menu-loop.webm";
export const FONT_ASSET_EXTENSIONS = Object.freeze([".woff2", ".woff", ".ttf"]);

/**
 * Declarative fault matrix. Each entry records the injection mechanism and
 * whether verifying it requires launching a fresh package. Entries flagged
 * `unitTested` have pure classification/validation logic exercised in
 * scripts/test-packaged-asset-fault-smoke.mjs without a package build.
 */
export const FAULT_MATRIX = Object.freeze([
  {
    id: "corrupt-start-menu-image",
    title: "Corrupt start-menu art inside the packaged ASAR",
    mechanism: "CDP image src override to invalid image/png data",
    needsFreshPackage: true,
    unitTested: true,
  },
  {
    id: "missing-room-image",
    title: "Missing championship-room art inside the packaged ASAR",
    mechanism: "CDP image src override to a nonexistent custom-protocol asset",
    needsFreshPackage: true,
    unitTested: true,
  },
  {
    id: "slow-disk-delayed-read",
    title: "Slow disk / delayed asset reads",
    mechanism:
      "CDP Fetch delay applied to asset responses; UI must show loading, then resolve",
    needsFreshPackage: true,
    unitTested: true,
  },
  {
    id: "unsupported-or-corrupt-video",
    title: "Unsupported or corrupt optional ambient video codec",
    mechanism:
      "CDP media src override to an undecodable source; static still fallback must show",
    needsFreshPackage: true,
    unitTested: true,
  },
  {
    id: "windows-font-load-failure",
    title: "Windows bundled-font load failure",
    mechanism:
      "CDP font response failure; local system font stack must keep text readable",
    needsFreshPackage: true,
    unitTested: true,
  },
  {
    id: "audio-device-loss",
    title: "Audio-device loss / no output device",
    mechanism:
      "Renderer audio graph creation fails; silent fallback must not block poker actions",
    needsFreshPackage: false,
    unitTested: true,
  },
]);

export function describeFaultMatrix() {
  return FAULT_MATRIX.map((entry) => ({ ...entry }));
}

export function classifyAssetFaultRequest(url) {
  if (typeof url !== "string") return "continue";
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "continue";
  }
  if (pathname === START_MENU_ASSET_PATH) return "corrupt-start-menu";
  if (pathname === ROOM_ASSET_PATH) return "missing-room";
  return "continue";
}

/**
 * Extended classification covering the additional fault classes. The optional
 * ambient video and bundled fonts are faulted here; everything else defers to
 * the base image classifier.
 */
export function classifyExtendedAssetFaultRequest(url) {
  const base = classifyAssetFaultRequest(url);
  if (base !== "continue") return base;
  if (typeof url !== "string") return "continue";
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "continue";
  }
  if (pathname === AMBIENT_VIDEO_ASSET_PATH) return "corrupt-video";
  if (FONT_ASSET_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
    return "missing-font";
  }
  return "continue";
}

/**
 * Slow-disk model: every asset read is delayed by `delayMs`; tiny protocol
 * control requests are not. Returns the delay to apply to a given request.
 */
export function slowDiskDelayForRequest(url, delayMs = 750) {
  if (typeof url !== "string" || !Number.isFinite(delayMs) || delayMs < 0) {
    return 0;
  }
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 0;
  }
  const assetLike = /\.(png|jpe?g|webp|avif|gif|webm|mp4|woff2?|ttf|css|js)$/i;
  return assetLike.test(pathname) ? delayMs : 0;
}

export function validateSlowDiskObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (!observation.sawLoadingState) {
    failures.push("slow disk must present a visible loading state");
  }
  if (!observation.eventuallyReady) {
    failures.push("app must recover to an interactive screen after slow reads");
  }
  if (observation.timedOut) {
    failures.push("slow disk must not leave the app permanently blocked");
  }
  return failures;
}

export function validateVideoFallbackObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (observation.videoStatus !== "failed") {
    failures.push("unsupported/corrupt video must reach a failed state");
  }
  if (!observation.stillFallbackVisible) {
    failures.push("static still-image fallback must remain visible");
  }
  if (!observation.videoHidden) {
    failures.push("failed video element must be hidden");
  }
  if (!observation.playUsable || !observation.settingsUsable) {
    failures.push("Play and Settings controls must remain usable");
  }
  return failures;
}

export function validateFontFallbackObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (observation.fontStatus !== "failed") {
    failures.push("font load failure must reach a failed state");
  }
  if (!observation.usedFallbackFamily) {
    failures.push("a local system font fallback family must be applied");
  }
  if (!observation.textReadable) {
    failures.push("critical text must remain visible/readable without the font");
  }
  return failures;
}

export function validateAudioDeviceLossObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (!observation.audioContextFailed) {
    failures.push("audio-device loss scenario must record a failed audio graph");
  }
  if (!observation.silentFallbackActive) {
    failures.push("a silent fallback must be active after audio-device loss");
  }
  if (!observation.pokerActionUsable) {
    failures.push("poker actions must remain usable without audio");
  }
  if (
    typeof observation.statusText !== "string" ||
    !/audio|sound|muted|silent/i.test(observation.statusText)
  ) {
    failures.push("an audio-status message must be announced");
  }
  return failures;
}

export function validateStartMenuFallbackObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (observation.screen !== "home") {
    failures.push("start menu must be the active screen");
  }
  if (observation.canonicalStatus !== "failed") {
    failures.push("corrupt start-menu art must reach failed state");
  }
  if (!observation.fallbackExists || !observation.fallbackVisible) {
    failures.push("start-menu CSS/DOM fallback must remain visibly rendered");
  }
  if (!observation.canonicalArtHidden) {
    failures.push("failed canonical start-menu art must be hidden");
  }
  if (!observation.playUsable || !observation.settingsUsable) {
    failures.push("Play and Settings controls must remain usable");
  }
  if (
    typeof observation.noticeText !== "string" ||
    !/fallback|could not display/i.test(observation.noticeText)
  ) {
    failures.push("start-menu asset failure notice must be present");
  }
  return failures;
}

export function validateRoomFallbackObservation(observation) {
  const failures = validateSharedObservation(observation);
  if (!isRecord(observation)) return failures;
  if (observation.screen !== "room-flight") {
    failures.push("room flythrough must be the active screen");
  }
  if (observation.backgroundStatus !== "failed") {
    failures.push("missing room art must reach failed state");
  }
  if (!observation.venueExists || !observation.venueVisible) {
    failures.push("CSS/DOM championship room fallback must remain visible");
  }
  if (!observation.backgroundArtHidden) {
    failures.push("failed room background art must be hidden");
  }
  if (!observation.skipUsable) {
    failures.push("room Skip arrival control must remain usable");
  }
  if (
    typeof observation.rootText !== "string" ||
    !observation.rootText.includes("Championship Room")
  ) {
    failures.push("room fallback identity must remain rendered");
  }
  if (
    typeof observation.noticeText !== "string" ||
    !/fallback|could not display/i.test(observation.noticeText)
  ) {
    failures.push("room asset failure notice must be present");
  }
  return failures;
}

export function assertNoUnexpectedRendererEvents(events) {
  const unexpected = (Array.isArray(events) ? events : []).find(
    (event) =>
      event?.kind === "runtime-exception" ||
      event?.kind === "console-error" ||
      event?.kind === "network-loading-failed",
  );
  if (!unexpected) return;
  throw new RenderSmokeFailure(
    unexpected.kind,
    `Packaged renderer emitted an unexpected ${unexpected.kind} event${
      typeof unexpected.description === "string" &&
      unexpected.description.trim()
        ? `: ${unexpected.description.trim()}`
        : "."
    }`,
    {
      event: {
        kind: unexpected.kind,
        ...(typeof unexpected.description === "string"
          ? { description: unexpected.description.slice(0, 500) }
          : {}),
      },
    },
  );
}

export function assertValidatedAssetFaultProfile(
  profile,
  temporaryRoot = tmpdir(),
) {
  return assertValidatedTemporaryProfile(
    profile,
    temporaryRoot,
    ASSET_FAULT_PROFILE_PREFIX,
  );
}

export async function removeValidatedAssetFaultProfile(
  profile,
  temporaryRoot = tmpdir(),
  options = {},
) {
  const resolvedProfile = assertValidatedAssetFaultProfile(
    profile,
    temporaryRoot,
  );
  const remove = options.remove ?? rm;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolvePromise) =>
        setTimeout(resolvePromise, milliseconds),
      ));
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await remove(resolvedProfile, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function validateSharedObservation(observation) {
  if (!isRecord(observation)) return ["renderer observation is unavailable"];
  const failures = [];
  if (observation.url !== EXPECTED_DOCUMENT_URL) {
    failures.push(`document URL must be ${EXPECTED_DOCUMENT_URL}`);
  }
  if (observation.title !== EXPECTED_TITLE) {
    failures.push(`document title must be ${EXPECTED_TITLE}`);
  }
  if (
    !Number.isInteger(observation.rootChildCount) ||
    observation.rootChildCount < 1 ||
    typeof observation.rootText !== "string" ||
    observation.rootText.trim().length === 0
  ) {
    failures.push("#root must contain rendered content");
  }
  return failures;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
