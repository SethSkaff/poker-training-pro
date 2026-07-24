import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const releaseScriptDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
);
export const projectRoot = resolve(releaseScriptDirectory, "..", "..");
export const workDirectory = join(projectRoot, "work");

export function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function relativePath(filePath) {
  return relative(projectRoot, filePath).split(sep).join("/");
}

export function listRegularFiles(directory, options = {}) {
  const { allowMissing = false, rejectSymlinks = true } = options;
  if (!existsSync(directory)) {
    if (allowMissing) return [];
    throw new Error(`${relativePath(directory) || directory} does not exist.`);
  }

  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const absolutePath = join(directory, entry.name);
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) {
      if (rejectSymlinks) {
        throw new Error(
          `Symbolic links are not permitted in this release input: ${relativePath(absolutePath)}`,
        );
      }
      continue;
    }
    if (metadata.isDirectory()) {
      results.push(...listRegularFiles(absolutePath, options));
    } else if (metadata.isFile()) {
      results.push(absolutePath);
    }
  }
  return results;
}

