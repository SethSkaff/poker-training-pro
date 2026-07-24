import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRuntimePackageNoticeEvidence,
  loadRuntimePackageNoticeInputs,
} from "./lib/runtime-package-notices.mjs";

const acknowledgement = "--acknowledge-exact-installed-texts";
if (!process.argv.includes(acknowledgement)) {
  throw new Error(
    `Refusing to refresh evidence without ${acknowledgement}. Review the resulting exact-version diff.`,
  );
}
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputs = loadRuntimePackageNoticeInputs(projectRoot);
const evidence = createRuntimePackageNoticeEvidence(inputs);
const output = path.join(
  projectRoot,
  "config",
  "runtime-package-notice-evidence.json",
);
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${path.relative(projectRoot, output)} with ${evidence.entries.length} exact package entries.`,
);

