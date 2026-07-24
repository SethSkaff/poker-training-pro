import { extname, join } from "node:path";
import {
  listRegularFiles,
  projectRoot,
  relativePath,
} from "./shared.mjs";
import { readFileSync } from "node:fs";

const sourceDirectory = join(projectRoot, "src");
const testFiles = listRegularFiles(sourceDirectory).filter((filePath) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath),
);
const soakFiles = testFiles.filter((filePath) =>
  /\.soak\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath),
);
const unitFiles = testFiles.filter((filePath) => !soakFiles.includes(filePath));
const invariantFiles = testFiles.filter((filePath) =>
  /\b(?:invariant|property|generated|random|seeded)\b/i.test(
    `${relativePath(filePath)}\n${readFileSync(filePath, "utf8")}`,
  ),
);

const errors = [];
if (testFiles.length === 0) errors.push("no Vitest test files were found");
if (unitFiles.length === 0) errors.push("no unit test files were found");
if (soakFiles.length === 0) errors.push("no *.soak.test.* suite was found");
if (invariantFiles.length === 0) {
  errors.push(
    "no generated/property/invariant coverage marker was found in the test inventory",
  );
}

for (const filePath of testFiles) {
  const extension = extname(filePath).toLowerCase();
  if (![".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(extension)) {
    errors.push(`unsupported test file extension: ${relativePath(filePath)}`);
  }
}

if (errors.length > 0) {
  throw new Error(
    `Test inventory verification failed:\n${errors
      .map((error) => `- ${error}`)
      .join("\n")}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      allTestFiles: testFiles.length,
      unitAndAuditFiles: unitFiles.length,
      explicitSoakFiles: soakFiles.map(relativePath),
      generatedPropertyOrInvariantFiles: invariantFiles.map(relativePath),
      execution:
        "The release runner invokes one unfiltered `vitest run`, so every inventoried unit, audit, generated-invariant, property-style, and soak suite is executed.",
    },
    null,
    2,
  ),
);

