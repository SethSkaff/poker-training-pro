/**
 * Testable logic for the packaged deny-proxy audit's representative-play
 * extension. The CDP execution runs only against a built package, but the play
 * plan and the pass/fail evaluation are pure and unit-tested here so the audit's
 * intent is verified without a package build.
 *
 * Contract: ordinary offline play in every mode must contact zero network
 * endpoints. Any observed proxy connection, or any mode the plan failed to
 * reach, fails the audit closed.
 */

export const REPRESENTATIVE_MODES = Object.freeze([
  "normal",
  "rational",
  "training",
  "timed",
  "tutorial",
]);

/**
 * A declarative, CDP-driver-agnostic play plan. Each step names an interaction
 * kind plus its argument so the audit driver can execute it and so the coverage
 * (which modes are exercised) is inspectable without a running app.
 *
 * kinds:
 *  - "clickText": click the first enabled button whose trimmed text equals `text`
 *  - "clickSelector": click the button matching a CSS `selector`
 *  - "heroAction": dispatch a poker hotkey (`key`) for a table decision
 *  - "expectScreen": assert the named `screen` is present
 *  - "settle": wait `delayMs` for animations/transitions
 */
export function buildRepresentativePlayPlan() {
  const steps = [];
  const push = (mode, step) => steps.push({ mode, ...step });

  // First-run gate.
  push(null, { id: "skip-setup", kind: "clickText", text: "Skip setup" });
  push(null, { id: "home", kind: "expectScreen", screen: "home" });

  for (const mode of ["normal", "rational"]) {
    push(mode, { id: `${mode}-open-play`, kind: "clickSelector", selector: 'button[aria-label="Play"]' });
    push(mode, { id: `${mode}-select`, kind: "clickText", text: mode === "normal" ? "Normal" : "Rational" });
    push(mode, { id: `${mode}-enter-event`, kind: "clickText", text: "Enter event" });
    push(mode, { id: `${mode}-skip-arrival`, kind: "clickText", text: "Skip arrival" });
    push(mode, { id: `${mode}-table`, kind: "expectScreen", screen: "poker-table" });
    // A few ordinary table decisions.
    push(mode, { id: `${mode}-act-1`, kind: "heroAction", key: "c" });
    push(mode, { id: `${mode}-act-2`, kind: "heroAction", key: "c" });
    push(mode, { id: `${mode}-act-3`, kind: "heroAction", key: "f" });
    push(mode, { id: `${mode}-leave`, kind: "clickText", text: "Quit to menu" });
    push(mode, { id: `${mode}-home`, kind: "expectScreen", screen: "home" });
  }

  // Training: one scenario, a quiz answer, and a legal decision.
  push("training", { id: "training-open-play", kind: "clickSelector", selector: 'button[aria-label="Play"]' });
  push("training", { id: "training-select", kind: "clickText", text: "Training" });
  push("training", { id: "training-table", kind: "expectScreen", screen: "poker-table" });
  push("training", { id: "training-act", kind: "heroAction", key: "c" });
  push("training", { id: "training-leave", kind: "clickText", text: "Quit to menu" });

  // Timed Table: start, play a couple of actions.
  push("timed", { id: "timed-open-play", kind: "clickSelector", selector: 'button[aria-label="Play"]' });
  push("timed", { id: "timed-select", kind: "clickText", text: "Timed Table" });
  push("timed", { id: "timed-start", kind: "clickText", text: "Start timed table" });
  push("timed", { id: "timed-skip-arrival", kind: "clickText", text: "Skip arrival" });
  push("timed", { id: "timed-table", kind: "expectScreen", screen: "poker-table" });
  push("timed", { id: "timed-act", kind: "heroAction", key: "c" });
  push("timed", { id: "timed-leave", kind: "clickText", text: "Quit to menu" });

  // Tutorial.
  push("tutorial", { id: "tutorial-open-play", kind: "clickSelector", selector: 'button[aria-label="Play"]' });
  push("tutorial", { id: "tutorial-select", kind: "clickText", text: "Tutorial" });
  push("tutorial", { id: "tutorial-screen", kind: "expectScreen", screen: "tutorial" });

  return { schemaVersion: 1, modes: [...REPRESENTATIVE_MODES], steps };
}

/** The distinct modes a plan exercises (excludes null setup/menu steps). */
export function planModeCoverage(plan) {
  const covered = new Set();
  for (const step of plan.steps) {
    if (step.mode) covered.add(step.mode);
  }
  return [...covered].sort();
}

/**
 * Pure pass/fail evaluation for the representative-play deny-proxy audit.
 * `input.observations` is the array of proxy connection records; any entry is a
 * failure. `input.reachedModes` is the set/array of modes the driver confirmed
 * it exercised; every representative mode must be present.
 */
export function evaluatePackagedNetworkPlay(input) {
  const failures = [];
  if (!input.launched) {
    failures.push("packaged app failed to launch");
  }
  if (!input.remainedRunning) {
    failures.push("packaged app exited before representative play completed");
  }
  const connections = Array.isArray(input.observations)
    ? input.observations
    : [];
  if (connections.length > 0) {
    failures.push(
      `representative offline play attempted ${connections.length} network connection(s)`,
    );
  }
  const reached = new Set(input.reachedModes ?? []);
  const missing = REPRESENTATIVE_MODES.filter((mode) => !reached.has(mode));
  if (missing.length > 0) {
    failures.push(
      `representative play did not reach every mode; missing: ${missing.join(", ")}`,
    );
  }
  return { ok: failures.length === 0, failures };
}

/** Builds the canonical audit report body from run results. */
export function summarizeNetworkPlayAudit({
  executable,
  observationMs,
  launched,
  remainedRunning,
  observations,
  reachedModes,
  completedStepIds,
  plan,
}) {
  const evaluation = evaluatePackagedNetworkPlay({
    launched,
    remainedRunning,
    observations,
    reachedModes,
  });
  return {
    schemaVersion: 2,
    executable,
    observationMs,
    launched,
    remainedRunningForObservation: remainedRunning,
    representativePlay: {
      modes: [...REPRESENTATIVE_MODES],
      reachedModes: [...new Set(reachedModes ?? [])].sort(),
      plannedSteps: plan?.steps.length ?? 0,
      completedSteps: completedStepIds?.length ?? 0,
      completedStepIds: completedStepIds ?? [],
    },
    observedProxyConnections: (observations ?? []).length,
    observedBytes: (observations ?? []).reduce(
      (total, observation) => total + (observation.bytes ?? 0),
      0,
    ),
    requests: (observations ?? []).map((observation) => ({
      firstLine: observation.firstLine || "(connection without request line)",
      bytes: observation.bytes ?? 0,
    })),
    ok: evaluation.ok,
    failures: evaluation.failures,
    scope:
      "Deny-proxy launch plus scripted representative play through every mode " +
      "(Normal, Rational, Training, Timed, tutorial) under CDP, asserting zero " +
      "network contact. Static source/CSP scans cover bundled runtime references separately.",
  };
}
