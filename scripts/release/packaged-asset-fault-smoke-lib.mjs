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
