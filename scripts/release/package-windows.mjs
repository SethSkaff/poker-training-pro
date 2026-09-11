/**
 * The Windows packaging entry point, shared by the public installer command
 * and by the unpacked build the packaged audits inspect.
 *
 * Both modes run one electron-builder invocation over the single `build`
 * field in `package.json`, so the Electron version, packaged file set, asar
 * behavior, fuse configuration, and preload/main code cannot differ between
 * them. The only difference is target selection: `installers` adds the NSIS
 * and portable targets on top of the app packaging every mode performs, and
 * `unpacked` stops after that app packaging. electron-builder reaches both
 * through the same `doPack`, so `outputs/current/win-unpacked` is the same
 * artifact either way -- an installer build produces it as its own input.
 *
 * Keeping the argument list here rather than in two npm script strings is the
 * point: `package-windows.test.ts` asserts the two modes differ only by
 * target, which a pair of hand-maintained command lines could not guarantee.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertSupportedNodeVersion } from "../runtime-version.mjs";
import { projectRoot, readJson } from "./shared.mjs";

/** Where the pinned `electron` dependency unpacks its platform runtime. */
export const pinnedElectronDist = "node_modules/electron/dist";

export const packageModes = ["unpacked", "installers"];

/**
 * electron-builder targets that emit a public distributable. The unpacked
 * mode must request none of them: Stage 31 audits the app, and an installer
 * is the one artifact that would drag signing into a plain verification run.
 */
export const installerTargets = ["nsis", "portable"];

export function electronBuilderArgs(mode) {
  if (!packageModes.includes(mode)) {
    throw new Error(
      `Unsupported Windows package mode: ${String(mode)} (expected ${packageModes.join(" or ")})`,
    );
  }
  return [
    "--win",
    ...(mode === "installers" ? installerTargets : []),
    "--x64",
    ...(mode === "unpacked" ? ["--dir"] : []),
    `--config.electronDist=${pinnedElectronDist}`,
  ];
}

/**
 * The executable the packaged audits launch, read from the same build
 * configuration electron-builder is given rather than restated.
 */
export function packagedExecutableRelativePath(manifest = readJson(join(projectRoot, "package.json"))) {
  const output = manifest.build?.directories?.output;
  const productName = manifest.build?.productName;
  if (typeof output !== "string" || typeof productName !== "string") {
    throw new Error("package.json build config must declare directories.output and productName");
  }
  return `${output}/win-unpacked/${productName}.exe`;
}

function resolveMode(argv) {
  const requested = packageModes.filter((mode) => argv.includes(`--${mode}`));
  if (requested.length !== 1) {
    throw new Error(
      `Pass exactly one of ${packageModes.map((mode) => `--${mode}`).join(" or ")}.`,
    );
  }
  return requested[0];
}

if (import.meta.filename === process.argv[1]) {
  assertSupportedNodeVersion({ workflow: "Windows packaging" });
  const mode = resolveMode(process.argv.slice(2));

  if (process.platform !== "win32") {
    throw new Error("Windows packaging requires Windows.");
  }
  // `electron` 43 ships no install lifecycle script, so a lockfile install --
  // with or without `--ignore-scripts` -- leaves this directory absent. The
  // runtime comes from the package's own version-pinned `install-electron`
  // entry point, which checks the download against the checksums shipped
  // inside the pinned package. Name that here instead of letting
  // electron-builder fail on a missing custom distribution.
  if (!existsSync(join(projectRoot, pinnedElectronDist, "electron.exe"))) {
    throw new Error(
      `Pinned Electron runtime is missing at ${pinnedElectronDist}. Run \`node ${join("node_modules", "electron", "install.js")}\` first.`,
    );
  }

  const result = spawnSync(
    process.execPath,
    [join("node_modules", "electron-builder", "cli.js"), ...electronBuilderArgs(mode)],
    { cwd: projectRoot, stdio: "inherit", shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nWindows ${mode} packaging failed (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}
