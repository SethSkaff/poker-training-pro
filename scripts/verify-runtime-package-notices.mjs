import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleRuntimePackageNotices,
  loadRuntimePackageNoticeInputs,
  verifyRuntimePackageNoticeArtifact,
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
const expected = assembleRuntimePackageNotices({ ...inputs, evidence });
const artifactPath = path.join(
  projectRoot,
  "THIRD-PARTY-NOTICES.runtime.txt",
);
const actual = readFileSync(artifactPath);
verifyRuntimePackageNoticeArtifact(actual, expected);
console.log(
  JSON.stringify(
    {
      ok: true,
      packageCount: expected.packageCount,
      sourceTextCount: expected.sourceTextCount,
      artifactBytes: expected.artifactBytes,
      sha256: expected.sha256,
    },
    null,
    2,
  ),
);
