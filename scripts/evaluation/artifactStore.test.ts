import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyArtifact, writeImmutableArtifact } from "./artifactStore";

describe("A01 immutable artifact store", () => {
  it("writes and verifies an artifact, allowing identical idempotent content", async () => {
    const root = await mkdtemp(join(tmpdir(), "poker-eval-artifact-"));
    const first = await writeImmutableArtifact({ root, relativePath: "run/manifest.json", content: "{}\n" });
    const second = await writeImmutableArtifact({ root, relativePath: "run/manifest.json", content: "{}\n" });
    expect(second).toEqual(first);
    expect(await verifyArtifact(root, first)).toEqual(first);
  });

  it("rejects a different payload instead of replacing the original", async () => {
    const root = await mkdtemp(join(tmpdir(), "poker-eval-artifact-"));
    await writeImmutableArtifact({ root, relativePath: "baseline.json", content: "approved\n" });
    await expect(writeImmutableArtifact({ root, relativePath: "baseline.json", content: "candidate\n" })).rejects.toThrow(/Immutable artifact/);
    await expect(readFile(join(root, "baseline.json"), "utf8")).resolves.toBe("approved\n");
  });

  it("supports a simple path/content call for small fixture consumers", async () => {
    const root = await mkdtemp(join(tmpdir(), "poker-eval-artifact-"));
    const ref = await writeImmutableArtifact(join(root, "fixture.json"), "fixture\n");
    expect(ref.bytes).toBe(8);
    expect(await verifyArtifact(join(root, "fixture.json"))).toEqual(ref);
  });
});
