import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stages as buildStages } from "./release-stages.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

interface Stage {
  name: string;
  command: string;
  args: string[];
}

const stages = buildStages("node") as Stage[];

describe("release verification stages", () => {
  it("names a script that exists, for every stage", () => {
    // A stage was once added ahead of the script it names, leaving two commits
    // whose release gate could not run at all -- it would have died on the
    // missing file. The stage list is data; this checks the data against disk.
    const missing: string[] = [];
    for (const stage of stages) {
      for (const argument of stage.args) {
        // Flags and values are not paths. A path argument here always starts
        // with a known top-level directory of this repo.
        if (!/^(scripts|node_modules|electron|src|config)[\\/]/.test(argument)) {
          continue;
        }
        if (!existsSync(path.join(projectRoot, argument))) {
          missing.push(`${stage.name}: ${argument}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every stage a distinct name", () => {
    // The runner prints "[n/total] name" and stops at the first failure; two
    // stages sharing a name makes that message ambiguous about which failed.
    const names = stages.map((stage) => stage.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("passes script arguments after `--` for vite-node stages", () => {
    // vite-node consumes its own flags first; a bare `--check` after the
    // script path is silently eaten rather than reaching the script, so the
    // stage would pass by doing nothing.
    for (const stage of stages) {
      const viteNode = stage.args.findIndex((argument) =>
        argument.includes("vite-node"),
      );
      if (viteNode < 0) continue;
      const scriptFlags = stage.args
        .slice(viteNode + 1)
        .filter((argument) => argument.startsWith("--"));
      // `-c <config>` belongs to vite-node and precedes the script path.
      const afterScript = stage.args.slice(
        stage.args.findIndex((argument) => /\.ts$/.test(argument)) + 1,
      );
      if (afterScript.some((argument) => argument.startsWith("--"))) {
        expect(afterScript[0]).toBe("--");
      }
      expect(scriptFlags.length).toBeGreaterThanOrEqual(0);
    }
  });
});
