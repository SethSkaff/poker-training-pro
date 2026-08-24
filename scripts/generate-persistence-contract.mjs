import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourcePath = path.join(
  projectRoot,
  "src",
  "lib",
  "persistedDataNormalization.ts",
);
const outputPath = path.join(
  projectRoot,
  "electron",
  "persisted-data-normalization.cjs",
);
const source = readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    removeComments: false,
  },
  fileName: sourcePath,
}).outputText;
if (/\brequire\s*\(/u.test(transpiled)) {
  throw new Error("The persistence contract must remain runtime-dependency-free.");
}
const generated =
  "// GENERATED from src/lib/persistedDataNormalization.ts. Do not edit.\n" +
  transpiled;

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== generated) {
    throw new Error(
      "Electron persistence contract is stale. Run npm run generate:persistence-contract.",
    );
  }
} else {
  writeFileSync(outputPath, generated, "utf8");
}
