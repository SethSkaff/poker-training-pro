import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { projectRoot } from "./shared.mjs";
import { stages as buildStages } from "./release-stages.mjs";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  throw new Error(
    `Release verification requires Node.js 22 or newer; current runtime is ${process.versions.node}.`,
  );
}

const node = process.execPath;
const stages = buildStages(node);

for (const [index, stage] of stages.entries()) {
  const prefix = `[${index + 1}/${stages.length}]`;
  console.log(`\n${prefix} ${stage.name}`);
  const result = spawnSync(stage.command, stage.args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      CI: "true",
      TZ: "UTC",
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    console.error(
      `\nRelease verification stopped at ${prefix} ${stage.name} (exit ${String(result.status)}).`,
    );
    process.exit(result.status ?? 1);
  }
}

console.log(
  "\nAutomated release verification passed. Review the generated third-party audit's manual blockers separately. This gate does not sign/package installers, smoke-test an installed package, or perform active penetration testing.",
);
