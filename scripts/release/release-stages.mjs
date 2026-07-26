/**
 * The release verification stage list.
 *
 * Lives apart from the runner so it can be inspected without executing it.
 * `run-release-verification.test.ts` reads it to assert that every stage
 * points at a file that exists -- a stage was once added in the same commit
 * as the runner change but ahead of the script it names, leaving two commits
 * whose release gate could not run at all.
 */
import { join } from "node:path";

export const stages = (node) => [
  {
    name: "Package manifest, lockfile, SRI metadata, and installed-version integrity",
    command: node,
    args: [join("scripts", "release", "verify-package-integrity.mjs")],
  },
  {
    name: "Dependency vulnerability, registry-origin, and install-script review gate",
    command: node,
    args: [join("scripts", "release", "verify-dependency-security.mjs")],
  },
  {
    name: "High-signal repository secret scan",
    command: node,
    args: [join("scripts", "release", "scan-obvious-secrets.mjs")],
  },
  {
    name: "Worktree hygiene negative self-tests",
    command: node,
    args: [join("scripts", "release", "test-worktree-hygiene.mjs")],
  },
  {
    name: "Rejected merge artifact and conflict-marker hygiene",
    command: node,
    args: [join("scripts", "release", "verify-worktree-hygiene.mjs")],
  },
  {
    name: "Versioned release-operations documentation gate",
    command: node,
    args: [join("scripts", "release", "validate-release-docs.mjs")],
  },
  {
    name: "TypeScript strict verification",
    command: node,
    args: [
      join("node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--pretty",
      "false",
    ],
  },
  {
    name: "Unit/property/soak test inventory",
    command: node,
    args: [join("scripts", "release", "verify-test-inventory.mjs")],
  },
  {
    name: "Complete unfiltered unit/property/soak test execution",
    command: node,
    args: [join("node_modules", "vitest", "vitest.mjs"), "run"],
  },
  {
    name: "Frozen synthetic Training calibration regression gate",
    command: node,
    args: [
      join("node_modules", "vite-node", "vite-node.mjs"),
      "-c",
      join("scripts", "vite-node.config.mjs"),
      join("scripts", "audit-training-calibration.ts"),
    ],
  },
  {
    name: "AI behavior regression gates (raise chains, aggression mix, pacing)",
    command: node,
    args: [
      join("node_modules", "vite-node", "vite-node.mjs"),
      "-c",
      join("scripts", "vite-node.config.mjs"),
      join("scripts", "audit-ai-behavior-gates.ts"),
    ],
  },
  {
    name: "AI exploitability gates (scripted counter-strategies vs the table)",
    command: node,
    args: [
      join("node_modules", "vite-node", "vite-node.mjs"),
      "-c",
      join("scripts", "vite-node.config.mjs"),
      join("scripts", "audit-exploitability-gates.ts"),
    ],
  },
  {
    name: "Production renderer build",
    command: node,
    args: [
      join("node_modules", "vite", "bin", "vite.js"),
      "build",
      "--configLoader",
      "runner",
    ],
  },
  {
    name: "Runtime music rights, provenance, and QA evidence gate",
    command: node,
    args: [join("scripts", "validate-audio-rights.mjs")],
  },
  {
    name: "Runtime video policy and codec-test applicability gate",
    command: node,
    args: [join("scripts", "validate-runtime-video-policy.mjs")],
  },
  {
    name: "iOS bundled Training bank parity gate",
    command: node,
    args: [
      join("node_modules", "vite-node", "vite-node.mjs"),
      "-c",
      join("scripts", "vite-node.config.mjs"),
      join("scripts", "export-ios-training-bank.ts"),
      // vite-node passes everything after `--` through to the script.
      "--",
      "--check",
    ],
  },
  {
    name: "iOS bundled tournament-session engine parity gate",
    command: node,
    args: [join("scripts", "export-ios-tournament-engine.mjs"), "--check"],
  },
  {
    name: "Offline production bundle and CSP audit",
    command: node,
    args: [join("scripts", "audit-offline-build.mjs")],
  },
  {
    name: "Developer Training authoring and answer-key exclusion audit",
    command: node,
    args: [join("scripts", "audit-training-tool-exclusion.mjs")],
  },
  {
    name: "Privacy, telemetry, and gameplay-network source audit",
    command: node,
    args: [join("scripts", "audit-privacy.mjs")],
  },
  {
    name: "Motion and flash accessibility audit self-test",
    command: node,
    args: [join("scripts", "test-motion-flash-audit.mjs")],
  },
  {
    name: "Motion and flash static source audit",
    command: node,
    args: [join("scripts", "audit-motion-flash.mjs")],
  },
  {
    name: "Play-chip-only boundary audit self-test",
    command: node,
    args: [join("scripts", "audit-play-chip-boundary.mjs"), "--self-test"],
  },
  {
    name: "Play-chip-only runtime and package boundary audit",
    command: node,
    args: [join("scripts", "audit-play-chip-boundary.mjs")],
  },
  {
    name: "Static production performance budgets",
    command: node,
    args: [join("scripts", "audit-static-budgets.mjs")],
  },
  {
    name: "Production composition and Electron dependency isolation audit",
    command: node,
    args: [join("scripts", "audit-production-composition.mjs")],
  },
  {
    name: "Production composition audit negative tests",
    command: node,
    args: [join("scripts", "test-production-composition-audit.mjs")],
  },
  {
    name: "Complete third-party dependency/asset audit generation",
    command: node,
    args: [join("scripts", "generate-third-party-audit.mjs")],
  },
  {
    name: "Deterministic CycloneDX software bill of materials",
    command: node,
    args: [join("scripts", "release", "generate-sbom.mjs")],
  },
  {
    name: "Production source-map/debug/test-hook hygiene scan",
    command: node,
    args: [join("scripts", "release", "verify-production-artifacts.mjs")],
  },
  {
    name: "Packaged lifecycle smoke bridge isolation audit",
    command: node,
    args: [join("scripts", "audit-packaged-lifecycle-bridge-security.mjs")],
  },
  {
    name: "Deterministic release manifest generation",
    command: node,
    args: [join("scripts", "release", "generate-release-manifest.mjs")],
  },
];
