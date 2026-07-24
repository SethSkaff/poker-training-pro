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
const distDirectory = path.join(projectRoot, "dist");
const budgets = JSON.parse(
  readFileSync(
    path.join(projectRoot, "config", "performance-budgets.json"),
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
const jsGzipBytes = sum(
  scripts.map((file) => gzipSync(readFileSync(file.file)).byteLength),
);
const cssGzipBytes = sum(
  styles.map((file) => gzipSync(readFileSync(file.file)).byteLength),
);
const failures = [];

check(
  "dist total",
  totalBytes,
  budgets.bundle.distTotalMiB * mebibyte,
);
check(
  "initial JavaScript gzip",
  jsGzipBytes,
  budgets.bundle.initialJavaScriptGzipMiB * mebibyte,
);
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

function fail(message) {
  process.stderr.write(`Static performance audit failed: ${message}\n`);
  process.exit(1);
}
