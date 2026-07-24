import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "ios/tournament-session-engine-entry.ts");
const output = resolve(
  root,
  "ios/PokerTrainingPro/Resources/Engine/tournament-session-engine.js",
);
const checkOnly = process.argv.includes("--check");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2018"],
  write: false,
  legalComments: "none",
  sourcemap: false,
  charset: "utf8",
});
const generated = `${result.outputFiles[0].text.trimEnd()}\n`;

if (checkOnly) {
  const current = await readFile(output, "utf8");
  if (current !== generated) {
    throw new Error(
      "iOS tournament-session engine is stale. Run scripts/export-ios-tournament-engine.mjs before release.",
    );
  }
  process.stdout.write(`iOS tournament-session engine is current (${generated.length} bytes).\n`);
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, generated, "utf8");
  process.stdout.write(`Exported iOS tournament-session engine to ${output}.\n`);
}
