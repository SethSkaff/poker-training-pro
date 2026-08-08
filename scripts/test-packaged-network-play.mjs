import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepresentativePlayPlan,
  evaluatePackagedNetworkPlay,
  planModeCoverage,
  REPRESENTATIVE_MODES,
  summarizeNetworkPlayAudit,
} from "./release/packaged-network-play-lib.mjs";

test("the representative play plan covers every mode", () => {
  const plan = buildRepresentativePlayPlan();
  assert.deepEqual(planModeCoverage(plan), [...REPRESENTATIVE_MODES].sort());
  // Every step is well-formed.
  for (const step of plan.steps) {
    assert.ok(typeof step.id === "string" && step.id.length > 0);
    assert.ok(
      ["clickText", "clickSelector", "heroAction", "expectScreen", "settle"].includes(
        step.kind,
      ),
      `unexpected step kind: ${step.kind}`,
    );
  }
  // At least one real table decision is scripted per playable mode.
  const heroActions = plan.steps.filter((step) => step.kind === "heroAction");
  assert.ok(heroActions.length >= 5);
});

test("evaluation passes only on a clean run that reached every mode", () => {
  const clean = evaluatePackagedNetworkPlay({
    launched: true,
    remainedRunning: true,
    observations: [],
    reachedModes: [...REPRESENTATIVE_MODES],
  });
  assert.deepEqual(clean, { ok: true, failures: [] });
});

test("any observed connection fails the audit closed", () => {
  const result = evaluatePackagedNetworkPlay({
    launched: true,
    remainedRunning: true,
    observations: [{ firstLine: "GET http://example.com/ HTTP/1.1", bytes: 40 }],
    reachedModes: [...REPRESENTATIVE_MODES],
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /1 network connection/);
});

test("a mode the plan never reached fails the audit closed", () => {
  const result = evaluatePackagedNetworkPlay({
    launched: true,
    remainedRunning: true,
    observations: [],
    reachedModes: ["normal", "rational", "training"],
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /missing: timed/);
});

test("launch and early-exit failures are reported", () => {
  const notLaunched = evaluatePackagedNetworkPlay({
    launched: false,
    remainedRunning: false,
    observations: [],
    reachedModes: [...REPRESENTATIVE_MODES],
  });
  assert.equal(notLaunched.ok, false);
  assert.match(notLaunched.failures.join("\n"), /failed to launch/);
  assert.match(notLaunched.failures.join("\n"), /exited before/);
});

test("the summary embeds the evaluation and connection accounting", () => {
  const plan = buildRepresentativePlayPlan();
  const summary = summarizeNetworkPlayAudit({
    executable: "Poker Training Pro.exe",
    observationMs: 12_000,
    launched: true,
    remainedRunning: true,
    observations: [],
    reachedModes: [...REPRESENTATIVE_MODES],
    completedStepIds: plan.steps.map((step) => step.id),
    plan,
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.observedProxyConnections, 0);
  assert.equal(summary.schemaVersion, 2);
  assert.deepEqual(
    summary.representativePlay.reachedModes,
    [...REPRESENTATIVE_MODES].sort(),
  );
  assert.equal(
    summary.representativePlay.completedSteps,
    plan.steps.length,
  );
});
