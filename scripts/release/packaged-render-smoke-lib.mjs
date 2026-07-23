export const EXPECTED_DOCUMENT_URL =
  "poker-training-pro://app/index.html";
export const EXPECTED_TITLE = "Poker Training Pro";
export const EXPECTED_START_TEXT = "Press any key";
export const EXPECTED_SCREEN_TEXT_SETS = Object.freeze([
  Object.freeze(["First-time setup", "Save and continue"]),
  Object.freeze(["Press any key"]),
  Object.freeze(["Play", "Settings"]),
]);

export class RenderSmokeFailure extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RenderSmokeFailure";
    this.code = code;
    this.details = details;
  }
}

export function validateRenderObservation(observation) {
  const failures = [];
  if (!observation || typeof observation !== "object") {
    return ["renderer observation is unavailable"];
  }
  if (observation.url !== EXPECTED_DOCUMENT_URL) {
    failures.push(
      `document URL must be ${EXPECTED_DOCUMENT_URL}`,
    );
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
  if (
    typeof observation.rootText !== "string" ||
    !EXPECTED_SCREEN_TEXT_SETS.some((expectedTexts) =>
      expectedTexts.every((text) => observation.rootText.includes(text)),
    )
  ) {
    failures.push(
      "renderer must contain expected first-run, title, or start-menu text",
    );
  }
  return failures;
}

export function assertNoFatalCdpEvents(events) {
  const fatal = events.find(
    (event) =>
      event.kind === "runtime-exception" ||
      event.kind === "network-loading-failed" ||
      event.kind === "console-error",
  );
  if (!fatal) return;
  const labels = {
    "runtime-exception": "Runtime.exceptionThrown",
    "network-loading-failed": "Network.loadingFailed",
    "console-error": "console error",
  };
  throw new RenderSmokeFailure(
    fatal.kind,
    `Packaged renderer emitted ${labels[fatal.kind]}.`,
    { event: redactCdpEvent(fatal) },
  );
}

export async function waitForRenderSmoke(options) {
  if (!options || typeof options.observe !== "function") {
    throw new TypeError("A renderer observation function is required.");
  }
  const timeoutMs = boundedInteger(options.timeoutMs, 1, 120_000);
  const pollIntervalMs = boundedInteger(
    options.pollIntervalMs ?? 100,
    1,
    5_000,
  );
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((duration) =>
      new Promise((resolve) => setTimeout(resolve, duration)));
  const startedAt = now();
  let lastObservation;
  let lastFailures = ["renderer did not produce an observation"];

  while (now() - startedAt < timeoutMs) {
    const result = await options.observe();
    const events = Array.isArray(result.events) ? result.events : [];
    assertNoFatalCdpEvents(events);
    lastObservation = result.observation;
    lastFailures = validateRenderObservation(lastObservation);
    if (lastFailures.length === 0) {
      return lastObservation;
    }
    await sleep(pollIntervalMs);
  }

  throw new RenderSmokeFailure(
    "timeout",
    `Packaged renderer smoke timed out after ${timeoutMs}ms: ${lastFailures.join("; ")}.`,
    {
      lastObservation: redactObservation(lastObservation),
      validationFailures: lastFailures,
    },
  );
}

function redactCdpEvent(event) {
  return {
    kind: event.kind,
    ...(typeof event.errorText === "string"
      ? { errorText: event.errorText.slice(0, 200) }
      : {}),
    ...(typeof event.level === "string" ? { level: event.level } : {}),
  };
}

function redactObservation(observation) {
  if (!observation || typeof observation !== "object") return undefined;
  return {
    url:
      typeof observation.url === "string"
        ? observation.url.slice(0, 200)
        : undefined,
    title:
      typeof observation.title === "string"
        ? observation.title.slice(0, 100)
        : undefined,
    readyState:
      typeof observation.readyState === "string"
        ? observation.readyState
        : undefined,
    rootChildCount: Number.isInteger(observation.rootChildCount)
      ? observation.rootChildCount
      : undefined,
    rootTextLength:
      typeof observation.rootText === "string"
        ? observation.rootText.length
        : undefined,
  };
}

function boundedInteger(value, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `Expected an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}
