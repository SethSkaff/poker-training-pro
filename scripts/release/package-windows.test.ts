import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  electronBuilderArgs,
  installerTargets,
  packagedExecutableRelativePath,
  pinnedElectronDist,
} from "./package-windows.mjs";
import { stages as buildStages } from "./release-stages.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const readText = (relative: string) =>
  readFileSync(path.join(projectRoot, relative), "utf8");

const manifest = JSON.parse(readText("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  build: { directories: { output: string }; productName: string };
};

const STAGE_31 = "Packaged lifecycle smoke bridge isolation audit";

interface WorkflowStep {
  name: string;
  run: string;
  uses: string;
  workingDirectory: string;
}

/**
 * The `verify` job's steps, in order. Only the keys this file reasons about
 * are read; the workflow is a flat list of steps whose commands are all
 * single-line, so a full YAML parser would add an undeclared dependency for
 * no more truth.
 */
function verifyJobSteps(): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (const line of readText(".github/workflows/release-quality.yml").split(
    /\r?\n/,
  )) {
    const name = /^ {6}- name: (.+)$/.exec(line);
    if (name) {
      steps.push({
        name: name[1].trim(),
        run: "",
        uses: "",
        workingDirectory: "",
      });
      continue;
    }
    const current = steps.at(-1);
    if (!current) continue;
    for (const [key, pattern] of [
      ["run", /^ {8}run: (.+)$/],
      ["uses", /^ {8}uses: (.+)$/],
      ["workingDirectory", /^ {8}working-directory: (.+)$/],
    ] as const) {
      const match = pattern.exec(line);
      if (match) current[key] = match[1].trim();
    }
  }
  return steps;
}

const stepIndex = (
  steps: WorkflowStep[],
  predicate: (step: WorkflowStep) => boolean,
) => steps.findIndex(predicate);

describe("Windows packaging configuration", () => {
  it("differs between the unpacked and installer modes only by target selection", () => {
    // The unpacked artifact the packaged audits inspect has to be the same
    // application the installers wrap. Sharing one argument builder is how
    // that is guaranteed: everything outside the target words -- platform,
    // architecture, and the pinned Electron distribution -- must match, and
    // the `build` field in package.json supplies the rest to both.
    const unpacked = electronBuilderArgs("unpacked");
    const installers = electronBuilderArgs("installers");
    const withoutTargets = (args: string[]) =>
      args.filter((arg) => arg !== "--dir" && !installerTargets.includes(arg));

    expect(withoutTargets(unpacked)).toEqual(withoutTargets(installers));
    expect(withoutTargets(unpacked)).toEqual([
      "--win",
      "--x64",
      `--config.electronDist=${pinnedElectronDist}`,
    ]);
  });

  it("requests no installer target, and so no signing, for the audited build", () => {
    const unpacked = electronBuilderArgs("unpacked");
    expect(unpacked).toContain("--dir");
    for (const target of [...installerTargets, "msi", "appx", "squirrel"]) {
      expect(unpacked).not.toContain(target);
    }
    expect(electronBuilderArgs("installers")).not.toContain("--dir");
  });

  it("rejects an unknown package mode instead of guessing a target", () => {
    expect(() => electronBuilderArgs("dir" as "unpacked")).toThrow(
      /Unsupported Windows package mode/,
    );
  });

  it("keeps one electron-builder configuration source for every mode", () => {
    // A standalone `electron-builder.*` config would override the `build`
    // field for whichever invocation picked it up, which is exactly the
    // silent divergence the shared argument list is there to prevent.
    for (const extension of [
      "yml",
      "yaml",
      "json",
      "json5",
      "js",
      "cjs",
      "mjs",
      "ts",
    ]) {
      expect(
        existsSync(path.join(projectRoot, `electron-builder.${extension}`)),
      ).toBe(false);
    }
    for (const mode of ["unpacked", "installers"] as const) {
      const overrides = electronBuilderArgs(mode).filter((arg) =>
        arg.startsWith("--config"),
      );
      expect(overrides).toEqual([
        `--config.electronDist=${pinnedElectronDist}`,
      ]);
    }
  });

  it("packages the executable the packaged audits launch", () => {
    // The audits name this path as a literal. Deriving it from the same build
    // configuration electron-builder is given keeps a renamed product or
    // relocated output slot from leaving the audits pointed at nothing --
    // the failure mode this stage precondition came from in the first place.
    expect(packagedExecutableRelativePath(manifest)).toBe(
      "outputs/current/win-unpacked/Poker Training Pro.exe",
    );
    expect(
      readText("scripts/audit-packaged-lifecycle-bridge-security.mjs"),
    ).toContain(packagedExecutableRelativePath(manifest));
  });

  it("routes both npm packaging commands through the shared builder", () => {
    expect(manifest.scripts["package:win-unpacked"]).toBe(
      "node scripts/check-node-version.mjs && npm run build && node scripts/release/package-windows.mjs --unpacked",
    );
    expect(manifest.scripts["package:win"]).toContain(
      "npm run build && node scripts/release/package-windows.mjs --installers",
    );
  });
});

describe("release-quality CI pipeline", () => {
  const steps = verifyJobSteps();

  it("reads the workflow it is asserting against", () => {
    // Guards the parser itself: an indentation or key change that silently
    // stopped matching would leave every ordering assertion below vacuous.
    expect(steps.length).toBeGreaterThan(5);
    expect(
      steps.filter((step) => !step.run && !step.uses).map((step) => step.name),
    ).toEqual([]);
    expect(steps.filter((step) => step.run).length).toBeGreaterThan(5);
  });

  it("keeps the lockfile install free of dependency lifecycle code", () => {
    // The supply-chain posture is that no dependency's own install script
    // runs; the reviewed, version-pinned entry points are invoked by name.
    const installs = steps.filter((step) =>
      /\bnpm (ci|install)\b/.test(step.run),
    );
    expect(installs.map((step) => step.run)).toEqual([
      "npm ci --ignore-scripts",
    ]);
    expect(steps.some((step) => /npm rebuild/.test(step.run))).toBe(false);
  });

  it("verifies dependency security before running any lifecycle entry point", () => {
    const security = stepIndex(steps, (step) =>
      step.run.includes("verify-dependency-security.mjs"),
    );
    expect(security).toBeGreaterThanOrEqual(0);
    const firstEntryPoint = stepIndex(steps, (step) =>
      step.workingDirectory.startsWith("node_modules/"),
    );
    expect(security).toBeLessThan(firstEntryPoint);
  });

  it("provisions the pinned Electron runtime through the pinned package itself", () => {
    // `electron` 43 has no install lifecycle script, so the lockfile install
    // never fetches its platform runtime and the allowlist has nothing to
    // approve. The runtime must still come from the pinned package's own
    // checksum-verified entry point rather than an ad-hoc download.
    const electron = steps.find(
      (step) => step.workingDirectory === "node_modules/electron",
    );
    expect(electron?.run).toBe("node install.js");

    const lockfile = JSON.parse(readText("package-lock.json")) as {
      packages: Record<string, { version?: string; hasInstallScript?: boolean }>;
    };
    const locked = lockfile.packages["node_modules/electron"];
    expect(locked?.version).toBe(manifest.devDependencies.electron);
    expect(locked?.hasInstallScript ?? false).toBe(false);

    const allowlist = JSON.parse(
      readText("config/dependency-install-script-allowlist.json"),
    ) as { entries: { packagePath: string }[] };
    // Allowlisting it would fail the security gate, which rejects approvals
    // for packages that declare no install script.
    expect(allowlist.entries.map((entry) => entry.packagePath)).not.toContain(
      "node_modules/electron",
    );
  });

  it("builds the audited package before the gate that audits it", () => {
    const electron = stepIndex(
      steps,
      (step) => step.workingDirectory === "node_modules/electron",
    );
    const packaging = stepIndex(steps, (step) =>
      step.run.includes("npm run package:win-unpacked"),
    );
    const verification = stepIndex(steps, (step) =>
      step.run.includes("npm run release:verify"),
    );

    expect(electron).toBeGreaterThanOrEqual(0);
    expect(packaging).toBeGreaterThan(electron);
    expect(verification).toBeGreaterThan(packaging);
  });

  it("builds no installer and configures no signing material in CI", () => {
    const workflow = readText(".github/workflows/release-quality.yml");
    expect(steps.some((step) => /package:win(?!-unpacked)/.test(step.run))).toBe(
      false,
    );
    for (const token of ["CSC_LINK", "CSC_KEY_PASSWORD", "forceCodeSigning"]) {
      expect(workflow).not.toContain(token);
    }
  });
});

describe("Stage 31 packaged-executable precondition", () => {
  const stages = buildStages("node") as { name: string; args: string[] }[];

  it("still runs the packaged lifecycle bridge audit as a gate stage", () => {
    const names = stages.map((stage) => stage.name);
    expect(names).toContain(STAGE_31);
    expect(names.indexOf(STAGE_31) + 1).toBe(31);
    expect(stages.length).toBe(33);
  });

  it("fails closed on a missing packaged executable, CI included", () => {
    // The clean-CI defect was the absence of the artifact, not the strictness
    // of the check. If this ever starts passing -- a CI escape hatch, an
    // allowlist, a "not applicable" success -- the stage would go green on
    // machines that never launched the packaged app at all.
    const reportPath = path.join(
      projectRoot,
      "work",
      "packaged-lifecycle-bridge-security.json",
    );
    const before = existsSync(reportPath)
      ? readFileSync(reportPath, "utf8")
      : null;

    const result = spawnSync(
      process.execPath,
      [
        path.join("scripts", "audit-packaged-lifecycle-bridge-security.mjs"),
        "--app",
        path.join("work", "no-such-package", "Poker Training Pro.exe"),
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        shell: false,
      },
    );

    expect(result.status).not.toBe(0);
    if (process.platform === "win32") {
      expect(result.stderr).toContain("Packaged executable not found");
    }

    const after = existsSync(reportPath)
      ? readFileSync(reportPath, "utf8")
      : null;
    expect(after).toBe(before);
  });

  it("cannot be satisfied by a committed artifact", () => {
    // `outputs/` is ignored, so the only artifact the gate can see is one the
    // pipeline just built. A tracked placeholder would defeat that.
    expect(readText(".gitignore")).toMatch(/^\/outputs\/$/m);
    const tracked = spawnSync("git", ["ls-files", "--", "outputs"], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false,
    });
    expect(tracked.status).toBe(0);
    expect(tracked.stdout.trim()).toBe("");
  });
});
