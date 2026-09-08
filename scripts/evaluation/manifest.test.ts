import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunManifest, hashCanonicalJson } from "./manifest";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poker-eval-manifest-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), "lock-v1\n");
  await writeFile(join(root, "src", "fixture.ts"), "export const answer = 1;\n");
  return root;
}

describe("A01 evidence manifest", () => {
  it("hashes canonical object keys independent of insertion order", () => {
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(hashCanonicalJson({ a: 1, b: 2 }));
  });

  it("keeps deterministic identity independent of invocation time", async () => {
    const root = await fixtureRepo();
    const first = createRunManifest({ repoRoot: root, commandArgv: ["fixture-run"], seeds: { master: ["a"], salt: "s" } });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = createRunManifest({ repoRoot: root, commandArgv: ["fixture-run"], seeds: { master: ["a"], salt: "s" } });
    expect(second.runId).toBe(first.runId);
    expect(second).toEqual(first);
  });

  it("changes identity when a relevant dirty source byte changes", async () => {
    const root = await fixtureRepo();
    const before = createRunManifest({ repoRoot: root, commandArgv: ["fixture-run"] });
    await writeFile(join(root, "src", "fixture.ts"), "export const answer = 2;\n");
    const after = createRunManifest({ repoRoot: root, commandArgv: ["fixture-run"] });
    expect(after.dirty).toBe(before.dirty);
    expect(after.sourceTreeHash).not.toBe(before.sourceTreeHash);
    expect(after.runId).not.toBe(before.runId);
  });

  it("excludes credentials and generated directories from the source identity", async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, ".env.local"), "TOKEN=sentinel\n");
    await mkdir(join(root, "work"), { recursive: true });
    await writeFile(join(root, "work", "generated.json"), "outcome\n");
    const manifest = createRunManifest({ repoRoot: root });
    expect(manifest.sourceFiles.some((file) => file.relativePath.includes(".env"))).toBe(false);
    expect(manifest.sourceFiles.some((file) => file.relativePath.startsWith("work/"))).toBe(false);
  });
});
