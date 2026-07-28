import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDirectory = process.env.POKER_AUDIT_DIST ?? path.join(projectRoot, "dist");
const budgets = JSON.parse(
  readFileSync(
    process.env.POKER_AUDIT_BUDGETS ?? path.join(projectRoot, "config", "performance-budgets.json"),
    "utf8",
  ),
);

if (!existsSync(distDirectory)) {
  fail("dist/ does not exist; run the production build first");
}

const files = walk(distDirectory).map((file) => ({
  file,
  relative: path.relative(distDirectory, file).replaceAll("\\", "/"),
  bytes: statSync(file).size,
  extension: path.extname(file).toLowerCase(),
}));
const mebibyte = 1024 * 1024;
const totalBytes = sum(files.map((file) => file.bytes));
const scripts = files.filter((file) => file.extension === ".js");
const styles = files.filter((file) => file.extension === ".css");
const images = files.filter((file) =>
  [".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(
    file.extension,
  ),
);
const fonts = files.filter((file) =>
  [".otf", ".ttf", ".woff", ".woff2"].includes(file.extension),
);
const gzipOf = (file) => gzipSync(readFileSync(file.file)).byteLength;
const jsGzipBytes = sum(scripts.map(gzipOf));
const cssGzipBytes = sum(
  styles.map((file) => gzipSync(readFileSync(file.file)).byteLength),
);

/*
  "Initial JavaScript" means what the entry document actually loads before the
  player can do anything -- not every `.js` file that happens to exist in dist.

  This used to sum all of them, which made the number grow every time a *lazy*
  route was added. That is the opposite of what the budget is for: code split
  behind a route is the fix for a large bundle, and the audit was charging for
  it as though it were a regression. With the 3D scene chunk present the sum
  reached 313,660 bytes against a 314,573 byte ceiling -- passing by 912 bytes,
  and about to fail for a reason that says nothing about startup cost.

  Initial is now derived from `dist/index.html`: the modules it loads eagerly
  via `<script type="module">` and `<link rel="modulepreload">`. Everything else
  is deferred and is reported, and budgeted, separately.
*/
const entryHtmlPath = path.join(distDirectory, "index.html");
const entryHtml = existsSync(entryHtmlPath)
  ? readFileSync(entryHtmlPath, "utf8")
  : "";
const eagerNames = new Set(
  [...entryHtml.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) =>
    match[1].replace(/^\.?\//, ""),
  ),
);
const initialScripts = scripts.filter((file) => eagerNames.has(file.relative));
const deferredScripts = scripts.filter((file) => !eagerNames.has(file.relative));
const initialJsGzipBytes = sum(initialScripts.map(gzipOf));
const deferredJsGzipBytes = sum(deferredScripts.map(gzipOf));
const largestDeferred = [...deferredScripts]
  .map((file) => ({ file: file.relative, gzipBytes: gzipOf(file) }))
  .sort((left, right) => right.gzipBytes - left.gzipBytes)[0];

const failures = [];
const scene = readSceneGraph();

check(
  "dist total",
  totalBytes,
  budgets.bundle.distTotalMiB * mebibyte,
);
if (eagerNames.size === 0) {
  // Refuse to silently pass by measuring nothing.
  failures.push({
    name: "initial JavaScript gzip",
    actual: "no entry scripts found in dist/index.html",
    maximum: "at least one",
  });
} else {
  check(
    "initial JavaScript gzip",
    initialJsGzipBytes,
    budgets.bundle.initialJavaScriptGzipMiB * mebibyte,
  );
}
/*
  The largest deferred chunk has its own ceiling. Today that is the 3D scene
  (see docs/desktop-3d-architecture.md): lazy-loading it protects startup, but
  it must not therefore be unbounded -- a player who turns the scene on still
  waits for it.
*/
if (budgets.bundle.largestDeferredChunkGzipMiB && largestDeferred) {
  check(
    `largest deferred chunk gzip (${largestDeferred.file})`,
    largestDeferred.gzipBytes,
    budgets.bundle.largestDeferredChunkGzipMiB * mebibyte,
  );
}
if (scene) {
  check(
    "scene JavaScript gzip",
    scene.javascriptGzipBytes,
    budgets.bundle.sceneJavaScriptGzipMiB * mebibyte,
  );
  check(
    "scene assets",
    scene.assetBytes,
    budgets.bundle.sceneAssetsMiB * mebibyte,
  );
}
check(
  "initial CSS gzip",
  cssGzipBytes,
  budgets.bundle.initialCssGzipMiB * mebibyte,
);
for (const image of images) {
  check(
    `image ${image.relative}`,
    image.bytes,
    budgets.bundle.singleImageMiB * mebibyte,
  );
}
for (const font of fonts) {
  check(
    `font ${font.relative}`,
    font.bytes,
    budgets.bundle.singleFontMiB * mebibyte,
  );
}

const report = {
  ok: failures.length === 0,
  budgetVersion: budgets.version,
  totals: {
    files: files.length,
    bytes: totalBytes,
    mebibytes: round(totalBytes / mebibyte),
    javascriptGzipBytes: jsGzipBytes,
    initialJavascriptGzipBytes: initialJsGzipBytes,
    deferredJavascriptGzipBytes: deferredJsGzipBytes,
    initialScripts: initialScripts.map((file) => file.relative),
    ...(largestDeferred ? { largestDeferredChunk: largestDeferred } : {}),
    ...(scene ? { scene } : {}),
    cssGzipBytes,
    imageBytes: sum(images.map((file) => file.bytes)),
    fontBytes: sum(fonts.map((file) => file.bytes)),
  },
  largestFiles: [...files]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 10)
    .map(({ relative, bytes }) => ({ file: relative, bytes })),
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exit(1);

function check(name, actual, maximum) {
  if (actual > maximum) failures.push({ name, actual, maximum });
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Follow Vite's named import graph from the scene's source entry. Shared
 * imports are charged to the scene as well: loading the scene must pay for
 * them even if another lazy route also happens to use the same chunk.
 */
function readSceneGraph() {
  const manifestPath = path.join(distDirectory, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    failures.push({ name: "scene manifest", actual: "missing", maximum: manifestPath });
    return null;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = "src/components/TableScene3D.tsx";
  if (!manifest[entry]) {
    failures.push({ name: "scene entry", actual: "missing", maximum: entry });
    return null;
  }
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    const item = manifest[key];
    if (!item) {
      failures.push({ name: "scene manifest import", actual: key, maximum: "present" });
      return;
    }
    visited.add(key);
    for (const imported of [...(item.imports ?? []), ...(item.dynamicImports ?? [])]) {
      visit(imported);
    }
  };
  visit(entry);
  const items = [...visited].map((key) => manifest[key]);
  const scriptPaths = new Set(items.map((item) => item.file));
  const assetPaths = new Set(items.flatMap((item) => item.assets ?? []));
  const byRelative = new Map(files.map((file) => [file.relative, file]));
  const sceneScripts = [...scriptPaths].map((file) => byRelative.get(file)).filter(Boolean);
  const sceneAssets = [...assetPaths].map((file) => byRelative.get(file)).filter(Boolean);
  for (const file of [...scriptPaths, ...assetPaths]) {
    if (!byRelative.has(file)) failures.push({ name: "scene output", actual: file, maximum: "present" });
  }
  return {
    entry,
    entries: [...visited].sort(),
    javascriptGzipBytes: sum(sceneScripts.map(gzipOf)),
    assetBytes: sum(sceneAssets.map((file) => file.bytes)),
    assets: [...assetPaths].sort(),
  };
}

function fail(message) {
  process.stderr.write(`Static performance audit failed: ${message}\n`);
  process.exit(1);
}
