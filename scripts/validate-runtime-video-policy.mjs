import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const projectRoot = resolve(new URL("..", import.meta.url).pathname.slice(1));
const videoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"]);

async function collectVideos(directory) {
  const matches = [];
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return matches; }
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await collectVideos(target));
    else if (videoExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) matches.push(target);
  }
  return matches;
}

const dashboard = await readFile(join(projectRoot, "src", "components", "Dashboard.tsx"), "utf8");
const shippedVideos = [
  ...(await collectVideos(join(projectRoot, "public"))),
  ...(await collectVideos(join(projectRoot, "dist"))),
].map((path) => path.slice(projectRoot.length + 1).replaceAll("\\", "/"));
const dormantLoop = /const START_MENU_LOOP:\s*string \| undefined\s*=\s*undefined;/.test(dashboard);

const report = {
  ok: shippedVideos.length === 0 && dormantLoop,
  runtimeVideoPolicy: "no-runtime-video",
  shippedVideos,
  dormantStartMenuLoop: dormantLoop,
  requiredFutureWork: "Enabling runtime video requires a packaged unsupported/corrupt-codec fallback test before release.",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.exitCode = 1;
}
