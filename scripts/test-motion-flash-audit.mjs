#!/usr/bin/env node

import assert from "node:assert/strict";
import { analyzeCss, analyzeScript } from "./audit-motion-flash.mjs";

const reductionRules = `
.reduced-motion *,
.reduced-motion *::before,
.reduced-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}`;

const safe = analyzeCss(
  `
.prompt { animation: prompt-breathe 2s ease-in-out infinite; }
@keyframes prompt-breathe {
  0%, 100% { opacity: .65; }
  50% { opacity: 1; }
}
${reductionRules}
`,
  "safe.css",
);
assert.equal(safe.failures.length, 0, "slow opacity breathing must pass the static gate");

const strobe = analyzeCss(
  `
.danger { animation: warning-strobe 200ms steps(2) infinite; }
@keyframes warning-strobe { from { opacity: 0; } to { opacity: 1; } }
${reductionRules}
`,
  "strobe.css",
);
assert.ok(
  strobe.failures.some((failure) => failure.code === "hazardous-animation-signature"),
  "a repeated strobe signature must fail",
);
assert.ok(
  strobe.failures.some((failure) => failure.code === "rapid-stepped-visual-animation"),
  "a rapid stepped visual animation must fail",
);

const noReduction = analyzeCss(
  `
.loop { animation: decorative-loop 2s linear infinite; }
@keyframes decorative-loop { from { transform: rotate(0); } to { transform: rotate(360deg); } }
`,
  "no-reduction.css",
);
assert.ok(
  noReduction.failures.some(
    (failure) => failure.code === "system-reduced-motion-missing",
  ),
  "missing system reduced-motion coverage must fail",
);
assert.ok(
  noReduction.failures.some(
    (failure) => failure.code === "in-app-reduced-motion-missing",
  ),
  "missing in-app reduced-motion coverage must fail",
);

const scriptedToggle = analyzeScript(
  `window.setInterval(() => element.classList.toggle("bright"), 100);`,
  "rapid-toggle.ts",
);
assert.ok(
  scriptedToggle.failures.some(
    (failure) => failure.code === "rapid-scripted-visual-toggle",
  ),
  "rapid scripted visual toggles must fail",
);

const reducedPresentation = analyzeScript(
  `
if (settings.reducedMotion) {
  window.setTimeout(onComplete, 500);
} else {
  window.setTimeout(() => setPhase("room"), 650);
}
`,
  "RoomFlythrough.tsx",
);
assert.equal(
  reducedPresentation.failures.length,
  0,
  "a reduced-motion-aware presentation timer must pass",
);

console.log("Motion/flash audit negative self-tests: pass (5 cases)");
