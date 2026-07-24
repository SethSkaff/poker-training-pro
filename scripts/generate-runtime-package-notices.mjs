import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleRuntimePackageNotices,
  loadRuntimePackageNoticeInputs,
} from "./lib/runtime-package-notices.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputs = loadRuntimePackageNoticeInputs(projectRoot);
const evidence = JSON.parse(
  readFileSync(
    path.join(
      projectRoot,
      "config",
      "runtime-package-notice-evidence.json",
    ),
    "utf8",
  ),
);
const result = assembleRuntimePackageNotices({ ...inputs, evidence });
const output = path.join(projectRoot, "THIRD-PARTY-NOTICES.runtime.txt");
writeFileSync(output, result.artifact);
console.log(
  JSON.stringify(
    {
      ok: true,
      output: path.relative(projectRoot, output).replaceAll("\\", "/"),
      packageCount: result.packageCount,
      sourceTextCount: result.sourceTextCount,
      sourceBytes: result.sourceBytes,
      artifactBytes: result.artifactBytes,
      sha256: result.sha256,
    },
    null,
    2,
  ),
);

