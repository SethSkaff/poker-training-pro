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
  removeValidatedAssetFaultProfile,
  validateRoomFallbackObservation,
  validateStartMenuFallbackObservation,
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
