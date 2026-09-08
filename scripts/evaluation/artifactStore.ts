import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArtifactRef } from "./contracts";

function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

function refFor(relativePath: string, bytes: Uint8Array): ArtifactRef {
  return {
    relativePath: relativePath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
}

export interface WriteArtifactOptions {
  root: string;
  relativePath: string;
  content: string | Uint8Array;
  /** Baseline/holdout writes are always exclusive, including same content. */
  requireNew?: boolean;
}

export async function writeImmutableArtifact(
  optionsOrPath: WriteArtifactOptions | string,
  content?: string | Uint8Array,
): Promise<ArtifactRef> {
  const options: WriteArtifactOptions = typeof optionsOrPath === "string"
    ? { root: process.cwd(), relativePath: optionsOrPath, content: content ?? "" }
    : optionsOrPath;
  const bytes = bytesOf(options.content);
  const ref = refFor(options.relativePath, bytes);
  const target = resolve(options.root, options.relativePath);
  await mkdir(dirname(target), { recursive: true });
  try {
    const existing = new Uint8Array(await readFile(target));
    const existingRef = refFor(options.relativePath, existing);
    if (existingRef.sha256 === ref.sha256 && !options.requireNew) return existingRef;
    throw new Error(`Immutable artifact already exists with different content: ${options.relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temp, bytes, { flag: "wx" });
  try {
    await rename(temp, target);
  } catch (error) {
    try { await writeFile(temp, new Uint8Array()); } catch { /* best effort */ }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Immutable artifact was created concurrently: ${options.relativePath}`);
    }
    throw error;
  }
  return ref;
}

export async function verifyArtifact(
  rootOrPath: string,
  expected?: ArtifactRef,
): Promise<ArtifactRef> {
  const path = expected ? resolve(rootOrPath, expected.relativePath) : resolve(rootOrPath);
  const bytes = new Uint8Array(await readFile(path));
  const relativePath = expected?.relativePath ?? path;
  const actual = refFor(relativePath, bytes);
  if (expected && (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)) {
    throw new Error(`Artifact hash/size mismatch for ${relativePath}`);
  }
  return actual;
}

export async function artifactExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await stat(resolve(root, relativePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
