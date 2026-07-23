import assert from "node:assert/strict";
import {
  EXPECTED_DOCUMENT_URL,
  EXPECTED_START_TEXT,
  EXPECTED_TITLE,
  RenderSmokeFailure,
  assertNoFatalCdpEvents,
  validateRenderObservation,
  waitForRenderSmoke,
} from "./release/packaged-render-smoke-lib.mjs";

const valid = {
  url: EXPECTED_DOCUMENT_URL,
  title: EXPECTED_TITLE,
  readyState: "complete",
  rootChildCount: 1,
  rootText: `Poker Training Pro ${EXPECTED_START_TEXT}`,
};

assert.deepEqual(validateRenderObservation(valid), []);

assert.match(
  validateRenderObservation({ ...valid, rootChildCount: 0, rootText: "" }).join(
    " ",
  ),
  /#root must contain rendered content/i,
);
assert.match(
  validateRenderObservation({
    ...valid,
    url: "file:///C:/broken/index.html",
  }).join(" "),
  /document URL must be poker-training-pro:\/\/app\/index\.html/i,
);

assert.throws(
  () =>
    assertNoFatalCdpEvents([
      {
        kind: "network-loading-failed",
        errorText: "ERR_FAILED",
        requestType: "Document",
      },
    ]),
  (error) =>
    error instanceof RenderSmokeFailure &&
    error.code === "network-loading-failed",
);
assert.throws(
  () =>
    assertNoFatalCdpEvents([
      { kind: "runtime-exception", description: "ReferenceError" },
    ]),
  (error) =>
    error instanceof RenderSmokeFailure &&
    error.code === "runtime-exception",
);

let clock = 0;
await assert.rejects(
  waitForRenderSmoke({
    timeoutMs: 20,
    pollIntervalMs: 5,
    now: () => clock,
    sleep: async (duration) => {
      clock += duration;
    },
    observe: async () => ({
      observation: {
        ...valid,
        rootChildCount: 0,
        rootText: "",
      },
      events: [],
    }),
  }),
  (error) =>
    error instanceof RenderSmokeFailure && error.code === "timeout",
);

console.log(
  "Packaged renderer smoke negative self-tests passed: empty root, failed document, wrong scheme, runtime exception, timeout.",
);
