import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ASSET_FAULT_PROFILE_PREFIX,
  assertNoUnexpectedRendererEvents,
  assertValidatedAssetFaultProfile,
  classifyAssetFaultRequest,
  classifyExtendedAssetFaultRequest,
  describeFaultMatrix,
  removeValidatedAssetFaultProfile,
  slowDiskDelayForRequest,
  validateAudioDeviceLossObservation,
  validateFontFallbackObservation,
  validateRoomFallbackObservation,
  validateSlowDiskObservation,
  validateStartMenuFallbackObservation,
  validateVideoFallbackObservation,
} from "./release/packaged-asset-fault-smoke-lib.mjs";

const shared = {
  url: "poker-training-pro://app/index.html",
  title: "Poker Training Pro",
  rootChildCount: 1,
  rootText: "Poker Training Pro Championship Room Play Settings",
};

test("asset routing only faults the two exact packaged image paths", () => {
  assert.equal(
    classifyAssetFaultRequest(
      "poker-training-pro://app/start-menu-reference.png?cache=1",
    ),
    "corrupt-start-menu",
  );
  assert.equal(
    classifyAssetFaultRequest(
      "poker-training-pro://app/start-menu-room.png",
    ),
    "missing-room",
  );
  assert.equal(
    classifyAssetFaultRequest(
      "poker-training-pro://app/start-menu-settings.png",
    ),
    "continue",
  );
  assert.equal(classifyAssetFaultRequest("not a url"), "continue");
});

test("start-menu observation requires a visible fallback and usable actions", () => {
  const valid = {
    ...shared,
    screen: "home",
    canonicalStatus: "failed",
    fallbackExists: true,
    fallbackVisible: true,
    canonicalArtHidden: true,
    playUsable: true,
    settingsUsable: true,
    noticeText: "Start-menu artwork could not display. CSS fallback active.",
  };
  assert.deepEqual(validateStartMenuFallbackObservation(valid), []);
  const failures = validateStartMenuFallbackObservation({
    ...valid,
    rootChildCount: 0,
    rootText: "",
    fallbackVisible: false,
    playUsable: false,
  });
  assert.match(failures.join("\n"), /#root/);
  assert.match(failures.join("\n"), /fallback/);
  assert.match(failures.join("\n"), /Play and Settings/);
});

test("room observation rejects blank or cosmetic-only fallback states", () => {
  const valid = {
    ...shared,
    screen: "room-flight",
    backgroundStatus: "failed",
    venueExists: true,
    venueVisible: true,
    backgroundArtHidden: true,
    skipUsable: true,
    noticeText:
      "Championship-room background art could not display. CSS fallback active.",
  };
  assert.deepEqual(validateRoomFallbackObservation(valid), []);
  const failures = validateRoomFallbackObservation({
    ...valid,
    venueExists: false,
    venueVisible: false,
    backgroundArtHidden: false,
    skipUsable: false,
    noticeText: "",
  });
  assert.match(failures.join("\n"), /championship room fallback/);
  assert.match(failures.join("\n"), /background art/);
  assert.match(failures.join("\n"), /Skip arrival/);
  assert.match(failures.join("\n"), /notice/);
});

test("unexpected renderer faults fail closed", () => {
  assert.doesNotThrow(() => assertNoUnexpectedRendererEvents([]));
  assert.throws(
    () =>
      assertNoUnexpectedRendererEvents([
        { kind: "runtime-exception", description: "boom" },
      ]),
    /unexpected runtime-exception/,
  );
});

test("cleanup validation rejects broad, outside, and wrong-prefix paths", () => {
  const temporaryRoot = tmpdir();
  assert.throws(
    () => assertValidatedAssetFaultProfile(temporaryRoot, temporaryRoot),
    /Refusing/,
  );
  assert.throws(
    () =>
      assertValidatedAssetFaultProfile(
        join(temporaryRoot, "wrong-prefix-profile"),
        temporaryRoot,
      ),
    /Refusing/,
  );
  assert.throws(
    () =>
      assertValidatedAssetFaultProfile(
        join(temporaryRoot, "..", "outside-profile"),
        temporaryRoot,
      ),
    /Refusing/,
  );
});

test("validated cleanup removes exactly the isolated profile", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), ASSET_FAULT_PROFILE_PREFIX),
  );
  assert.equal(assertValidatedAssetFaultProfile(profile), profile);
  await removeValidatedAssetFaultProfile(profile);
  await assert.rejects(stat(profile), { code: "ENOENT" });
});

test("the fault matrix enumerates every required fault class", () => {
  const ids = describeFaultMatrix().map((entry) => entry.id);
  for (const required of [
    "corrupt-start-menu-image",
    "missing-room-image",
    "slow-disk-delayed-read",
    "unsupported-or-corrupt-video",
    "windows-font-load-failure",
    "audio-device-loss",
  ]) {
    assert.ok(ids.includes(required), `fault matrix is missing ${required}`);
  }
  // Every entry declares its mechanism and package requirement.
  for (const entry of describeFaultMatrix()) {
    assert.equal(typeof entry.mechanism, "string");
    assert.equal(typeof entry.needsFreshPackage, "boolean");
  }
});

test("extended classification routes video, font, and image faults", () => {
  assert.equal(
    classifyExtendedAssetFaultRequest(
      "poker-training-pro://app/start-menu-reference.png",
    ),
    "corrupt-start-menu",
  );
  assert.equal(
    classifyExtendedAssetFaultRequest(
      "poker-training-pro://app/start-menu-loop.webm",
    ),
    "corrupt-video",
  );
  assert.equal(
    classifyExtendedAssetFaultRequest(
      "poker-training-pro://app/assets/inter-latin.woff2",
    ),
    "missing-font",
  );
  assert.equal(
    classifyExtendedAssetFaultRequest(
      "poker-training-pro://app/index.html",
    ),
    "continue",
  );
});

test("slow-disk model delays asset reads but not control requests", () => {
  assert.equal(
    slowDiskDelayForRequest("poker-training-pro://app/main.js", 500),
    500,
  );
  assert.equal(
    slowDiskDelayForRequest("poker-training-pro://app/font.woff2"),
    750,
  );
  assert.equal(slowDiskDelayForRequest("poker-training-pro://app/", 500), 0);
  assert.equal(slowDiskDelayForRequest("not a url", 500), 0);
});

const sharedFields = {
  url: "poker-training-pro://app/index.html",
  title: "Poker Training Pro",
  rootChildCount: 1,
  rootText: "Poker Training Pro Championship Room Play Settings",
};

test("slow-disk observation requires loading then recovery, never a hang", () => {
  assert.deepEqual(
    validateSlowDiskObservation({
      ...sharedFields,
      sawLoadingState: true,
      eventuallyReady: true,
      timedOut: false,
    }),
    [],
  );
  const failures = validateSlowDiskObservation({
    ...sharedFields,
    sawLoadingState: false,
    eventuallyReady: false,
    timedOut: true,
  });
  assert.match(failures.join("\n"), /loading state/);
  assert.match(failures.join("\n"), /interactive screen/);
  assert.match(failures.join("\n"), /permanently blocked/);
});

test("video observation requires a visible still fallback", () => {
  assert.deepEqual(
    validateVideoFallbackObservation({
      ...sharedFields,
      videoStatus: "failed",
      stillFallbackVisible: true,
      videoHidden: true,
      playUsable: true,
      settingsUsable: true,
    }),
    [],
  );
  const failures = validateVideoFallbackObservation({
    ...sharedFields,
    videoStatus: "ok",
    stillFallbackVisible: false,
    videoHidden: false,
    playUsable: false,
    settingsUsable: false,
  });
  assert.match(failures.join("\n"), /failed state/);
  assert.match(failures.join("\n"), /still-image fallback/);
  assert.match(failures.join("\n"), /Play and Settings/);
});

test("font observation requires a readable local fallback family", () => {
  assert.deepEqual(
    validateFontFallbackObservation({
      ...sharedFields,
      fontStatus: "failed",
      usedFallbackFamily: true,
      textReadable: true,
    }),
    [],
  );
  const failures = validateFontFallbackObservation({
    ...sharedFields,
    fontStatus: "ok",
    usedFallbackFamily: false,
    textReadable: false,
  });
  assert.match(failures.join("\n"), /failed state/);
  assert.match(failures.join("\n"), /fallback family/);
  assert.match(failures.join("\n"), /readable/);
});

test("audio-device loss keeps poker actions usable with a silent fallback", () => {
  assert.deepEqual(
    validateAudioDeviceLossObservation({
      ...sharedFields,
      audioContextFailed: true,
      silentFallbackActive: true,
      pokerActionUsable: true,
      statusText: "Audio output unavailable; running silent.",
    }),
    [],
  );
  const failures = validateAudioDeviceLossObservation({
    ...sharedFields,
    audioContextFailed: false,
    silentFallbackActive: false,
    pokerActionUsable: false,
    statusText: "",
  });
  assert.match(failures.join("\n"), /failed audio graph/);
  assert.match(failures.join("\n"), /silent fallback/);
  assert.match(failures.join("\n"), /poker actions/);
  assert.match(failures.join("\n"), /audio-status/);
});
