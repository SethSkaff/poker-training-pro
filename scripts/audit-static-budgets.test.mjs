import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const audit = path.join(root, "scripts", "audit-static-budgets.mjs");

function run({
  sceneBytes = 32,
  assetBytes = 0,
  limit = 0.001,
  extraBytes = 0,
  staticBytes = 0,
  dynamicBytes = 0,
  initialSharedBytes = 0,
  unrelatedDynamicBytes = 0,
  missingManifest = false,
  missingSceneEntry = false,
  missingStaticImport = false,
  missingStaticOutput = false,
} = {}) {
  const fixture = mkdtempSync(path.join(tmpdir(), "poker-budget-"));
  const dist = path.join(fixture, "dist");
  mkdirSync(path.join(dist, ".vite"), { recursive: true });
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), '<script src="./assets/index.js"></script>');
  writeFileSync(path.join(dist, "assets", "index.js"), randomBytes(16));
  writeFileSync(path.join(dist, "assets", "scene.js"), randomBytes(sceneBytes));
  if (staticBytes && !missingStaticOutput) writeFileSync(path.join(dist, "assets", "scene-static.js"), randomBytes(staticBytes));
  if (dynamicBytes) writeFileSync(path.join(dist, "assets", "decoder.js"), randomBytes(dynamicBytes));
  if (initialSharedBytes) writeFileSync(path.join(dist, "assets", "initial-shared.js"), randomBytes(initialSharedBytes));
  if (unrelatedDynamicBytes) writeFileSync(path.join(dist, "assets", "unrelated-route.js"), randomBytes(unrelatedDynamicBytes));
  if (assetBytes) writeFileSync(path.join(dist, "assets", "scene.glb"), randomBytes(assetBytes));
  if (extraBytes) writeFileSync(path.join(dist, "assets", "other.js"), randomBytes(extraBytes));
  const manifest = {
    "index.html": {
      file: "assets/index.js",
      isEntry: true,
      imports: initialSharedBytes ? ["initial-shared"] : [],
      dynamicImports: [
        ...(missingSceneEntry ? [] : ["src/components/TableScene3D.tsx"]),
        ...(unrelatedDynamicBytes ? ["unrelated-route"] : []),
      ],
    },
    ...(missingSceneEntry ? {} : {
      "src/components/TableScene3D.tsx": {
        file: "assets/scene.js",
        isDynamicEntry: true,
        imports: [
          "index.html",
          ...(staticBytes || missingStaticImport ? ["scene-static"] : []),
          ...(initialSharedBytes ? ["initial-shared"] : []),
        ],
        assets: assetBytes ? ["assets/scene.glb"] : [],
        dynamicImports: dynamicBytes ? ["scene-decoder"] : [],
      },
    }),
    ...(staticBytes && !missingStaticImport ? { "scene-static": { file: "assets/scene-static.js" } } : {}),
    ...(dynamicBytes ? { "scene-decoder": { file: "assets/decoder.js" } } : {}),
    ...(initialSharedBytes ? { "initial-shared": { file: "assets/initial-shared.js" } } : {}),
    ...(unrelatedDynamicBytes ? { "unrelated-route": { file: "assets/unrelated-route.js" } } : {}),
  };
  if (!missingManifest) writeFileSync(path.join(dist, ".vite", "manifest.json"), JSON.stringify(manifest));
  const budgets = path.join(fixture, "budgets.json");
  writeFileSync(budgets, JSON.stringify({ version: 1, bundle: { distTotalMiB: 10, initialJavaScriptGzipMiB: 1, sceneJavaScriptGzipMiB: limit, sceneAssetsMiB: limit, largestDeferredChunkGzipMiB: 10, initialCssGzipMiB: 1, singleImageMiB: 10, singleFontMiB: 10 } }));
  const result = spawnSync(process.execPath, [audit], { env: { ...process.env, POKER_AUDIT_DIST: dist, POKER_AUDIT_BUDGETS: budgets }, encoding: "utf8" });
  rmSync(fixture, { recursive: true, force: true });
  return result;
}

test("scene audit independently gates its incremental static graph and assets", () => {
  assert.equal(run().status, 0);
  assert.equal(run({ sceneBytes: 2048, limit: 0.0001 }).status, 1);
  assert.equal(run({ assetBytes: 2048, limit: 0.0001 }).status, 1);
  assert.equal(run({ staticBytes: 2048, limit: 0.0001 }).status, 1);
  assert.equal(run({ extraBytes: 4096 }).status, 0);
});

test("scene audit excludes already-loaded prerequisites and dynamic descendants", () => {
  const result = run({
    initialSharedBytes: 2048,
    dynamicBytes: 2048,
    unrelatedDynamicBytes: 2048,
    limit: 0.0001,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const scene = JSON.parse(result.stdout).totals.scene;
  assert.deepEqual(scene.entries, ["src/components/TableScene3D.tsx"]);
  assert.deepEqual(scene.prerequisiteEntries, ["index.html", "initial-shared"]);
  assert.deepEqual(scene.excludedDynamicEntries, ["scene-decoder", "unrelated-route"]);
});

test("scene audit fails closed when required graph metadata is missing", () => {
  assert.equal(run({ missingManifest: true }).status, 1);
  assert.equal(run({ missingSceneEntry: true }).status, 1);
  assert.equal(run({ missingStaticImport: true }).status, 1);
  assert.equal(run({ staticBytes: 32, missingStaticOutput: true }).status, 1);
});
