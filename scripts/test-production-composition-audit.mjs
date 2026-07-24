import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  auditProductionComposition,
  parseStaticModuleSpecifiers,
} from "./lib/production-composition-audit.mjs";

const temporaryDirectories = [];

try {
  assert.deepEqual(
    parseStaticModuleSpecifiers(
      [
        'import React from "react";',
        'export { x } from "./x.js";',
        'const electron = require("electron");',
        'const later = import("lucide-react");',
        'const decoy = "require(\\"not-a-module\\")";',
      ].join("\n"),
      "fixture.ts",
    ),
    ["./x.js", "electron", "lucide-react", "react"],
  );

  const valid = createFixture({
    dependencies: {
      "lucide-react": "1.0.0",
      react: "19.0.0",
    },
    renderer: [
      'import React from "react";',
      'import { Icon } from "lucide-react";',
      "void React; void Icon;",
    ].join("\n"),
    electronMain: [
      'const { app } = require("electron");',
      'const helper = require("./helper.cjs");',
      "void app; void helper;",
    ].join("\n"),
    electronHelper: 'module.exports = require("node:path").basename("safe");',
  });
  const validReport = auditProductionComposition({ projectRoot: valid });
  const repeatedValidReport = auditProductionComposition({
    projectRoot: valid,
  });
  assert.equal(validReport.ok, true);
  assert.equal(
    JSON.stringify(repeatedValidReport),
    JSON.stringify(validReport),
    "the same inputs must produce byte-identical JSON",
  );
  assert.deepEqual(validReport.dependencyUsage.unused, []);
  assert.deepEqual(validReport.electronIsolation.violations, []);
  assert.deepEqual(validReport.build.unreferencedRuntimeAssets, []);

  const unused = createFixture({
    dependencies: {
      "lucide-react": "1.0.0",
      react: "19.0.0",
    },
    renderer: 'import React from "react"; void React;',
    electronMain: 'require("electron");',
  });
  const unusedReport = auditProductionComposition({ projectRoot: unused });
  assert.equal(unusedReport.ok, true);
  assert.deepEqual(unusedReport.dependencyUsage.unused, ["lucide-react"]);
  assert.equal(
    unusedReport.warnings.some(
      (warning) =>
        warning.code === "unused-direct-production-dependencies",
    ),
    true,
  );

  const forbiddenRendererDependency = createFixture({
    dependencies: { react: "19.0.0" },
    renderer: 'import React from "react"; void React;',
    electronMain: 'require("react");',
  });
  const dependencyReport = auditProductionComposition({
    projectRoot: forbiddenRendererDependency,
  });
  assert.equal(dependencyReport.ok, false);
  assert.equal(
    dependencyReport.failures.some(
      (failure) =>
        failure.code === "electron-imports-renderer-only-dependency",
    ),
    true,
  );

  const forbiddenPokerGraph = createFixture({
    dependencies: { react: "19.0.0" },
    renderer: [
      'import React from "react";',
      'export const policy = "rational";',
      "void React;",
    ].join("\n"),
    electronMain: 'require("./bridge.cjs");',
    electronHelper: 'module.exports = require("../src/modes/rational.ts");',
    electronHelperName: "bridge.cjs",
    extraFiles: {
      "src/modes/rational.ts": "export const result = 1;",
    },
  });
  const graphReport = auditProductionComposition({
    projectRoot: forbiddenPokerGraph,
  });
  assert.equal(graphReport.ok, false);
  assert.equal(
    graphReport.failures.some(
      (failure) => failure.code === "electron-imports-renderer-source",
    ),
    true,
  );
  assert.equal(
    graphReport.failures.some(
      (failure) => failure.code === "electron-imports-poker-computation",
    ),
    true,
  );

  process.stdout.write(
    "Production composition audit tests passed: parser, valid graph, unused dependency flag, renderer-dependency rejection, and transitive poker-module rejection.\n",
  );
} finally {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createFixture({
  dependencies,
  renderer,
  electronMain,
  electronHelper,
  electronHelperName = "helper.cjs",
  extraFiles = {},
}) {
  const root = mkdtempSync(
    path.join(tmpdir(), "poker-production-composition-"),
  );
  temporaryDirectories.push(root);
  write("package.json", JSON.stringify({
    name: "composition-fixture",
    version: "1.0.0",
    dependencies,
  }));
  write(
    "config/production-composition-policy.json",
    JSON.stringify({
      schemaVersion: 1,
      rendererEntrypoints: ["src/main.tsx"],
      electronEntrypoints: ["electron/main.cjs", "electron/preload.cjs"],
      allowedElectronExternalDependencies: ["electron"],
      rendererOnlyProductionDependencies: Object.keys(dependencies),
      forbiddenPokerComputationPathPatterns: [
        "(^|/)(engine|modes)(/|$)",
        "(^|/)(rational|tournament|training-engine)([.-]|$)",
      ],
    }),
  );
  write("src/main.tsx", renderer);
  write("electron/main.cjs", electronMain);
  write(
    "electron/preload.cjs",
    'const { contextBridge } = require("electron"); void contextBridge;',
  );
  if (electronHelper) write(`electron/${electronHelperName}`, electronHelper);
  for (const [file, contents] of Object.entries(extraFiles)) {
    write(file, contents);
  }
  write(
    "dist/index.html",
    '<link href="./assets/index.css"><script src="./assets/index.js"></script>',
  );
  write("dist/assets/index.css", '@font-face{src:url("./font.woff2")}');
  write("dist/assets/index.js", 'console.log("/hero.png");');
  write("dist/assets/font.woff2", "font-fixture");
  write("dist/hero.png", "image-fixture");
  return root;

  function write(file, contents) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}
