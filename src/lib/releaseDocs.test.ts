import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const validator = join(projectRoot, "scripts", "release", "validate-release-docs.mjs");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release documentation gate", () => {
  it("accepts the current pre-release operations set", () => {
    const output = execFileSync(process.execPath, [validator], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      packageVersion: "0.1.0",
      releaseBlockers: 10,
      status: "pre-release-blocked",
    });
  });

  it("fails closed when the package version is absent from the changelog", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "poker-release-docs-"));
    temporaryRoots.push(fixtureRoot);

    for (const path of [
      "package.json",
      "CHANGELOG.md",
      "docs",
      "THIRD-PARTY-NOTICES.packages.md",
      "work/third-party-audit.md",
    ]) {
      cpSync(join(projectRoot, path), join(fixtureRoot, path), {
        recursive: true,
      });
    }

    const changelogPath = join(fixtureRoot, "CHANGELOG.md");
    writeFileSync(
      changelogPath,
      readFileSync(changelogPath, "utf8").replace(
        "## [0.1.0] - Unreleased",
        "## [9.9.9] - Unreleased",
      ),
      "utf8",
    );

    expect(() =>
      execFileSync(process.execPath, [validator, "--root", fixtureRoot], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow(/Command failed/);
  });
});
