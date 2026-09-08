import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { CURRENT_CONTENT_VERSION, CURRENT_ENGINE_VERSION, CURRENT_POLICY_VERSION } from "../../src/modes/tournamentRunner";
import type {
  ArtifactRef,
  EvaluationObjective,
  EvaluationScope,
  PolicyIdentity,
  RunManifest,
  Split,
} from "./contracts";

const EXCLUDED_PARTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "outputs",
  "work",
  ".codex",
  ".agents",
]);
const EXCLUDED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "npm-debug.log",
  "yarn-error.log",
]);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function runGit(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function isExcluded(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  const parts = rel.split(sep);
  return parts.some((part) => EXCLUDED_PARTS.has(part)) ||
    EXCLUDED_NAMES.has(parts.at(-1) ?? "") ||
    parts.at(-1)?.startsWith(".") === true;
}

function collectFiles(root: string): string[] {
  const tracked = runGit(root, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((file) => resolve(root, file));
  const status = runGit(root, ["status", "--porcelain", "-z"]);
  const changed = status
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3).trim())
    .filter(Boolean)
    .map((file) => resolve(root, file));
  const unique = new Set<string>();
  for (const file of [...tracked, ...changed]) {
    if (!existsSync(file) || isExcluded(root, file)) continue;
    try {
      if (lstatSync(file).isFile()) unique.add(realpathSync(file));
    } catch {
      // A file can disappear between git status and the snapshot. It is not a
      // reproducible source input and is therefore omitted from this attempt.
    }
  }
  // A temporary fixture repository used by the manifest tests may not have a
  // git metadata directory yet. It is still a source snapshot, so include its
  // small declared tree instead of claiming that an empty file list is
  // reproducible.
  if (unique.size === 0) {
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const candidate = join(directory, entry.name);
        if (isExcluded(root, candidate)) continue;
        if (entry.isDirectory()) visit(candidate);
        else if (entry.isFile()) unique.add(realpathSync(candidate));
      }
    };
    visit(root);
  }
  return [...unique].sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}

function artifactFor(root: string, filePath: string): ArtifactRef {
  const bytes = readFileSync(filePath);
  return {
    relativePath: relative(root, filePath).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
}

function sourceTreeHash(files: ArtifactRef[]): string {
  return hashCanonicalJson(files.map((file) => ({
    path: file.relativePath,
    sha256: file.sha256,
    bytes: file.bytes,
  })));
}

export interface CreateRunManifestOptions {
  repoRoot?: string;
  commandArgv?: readonly string[];
  harnessVersion?: string;
  semanticsVersion?: string;
  registryVersion?: string;
  policies?: readonly PolicyIdentity[];
  experiment?: Partial<RunManifest["experiment"]>;
  scope?: EvaluationScope;
  clock?: RunManifest["clock"];
  objective?: EvaluationObjective;
  bankRef?: ArtifactRef | null;
  split?: Split;
  seeds?: Partial<RunManifest["seeds"]>;
  budgets?: Record<string, number>;
  baselineRef?: ArtifactRef | null;
  samplingConfigRef?: ArtifactRef | null;
  /** Explicitly selected untracked files needed by a temporary fixture repo. */
  selectedSourceFiles?: readonly string[];
}

function defaultPolicy(root: string, sourceHash: string): PolicyIdentity {
  const identity = {
    mode: "rational" as const,
    policyVersion: CURRENT_POLICY_VERSION,
    engineVersion: CURRENT_ENGINE_VERSION,
    contentVersion: CURRENT_CONTENT_VERSION,
    sourceTreeHash: sourceHash,
    parameterHash: hashCanonicalJson({ policyVersion: CURRENT_POLICY_VERSION }),
    profileKey: null,
    profileId: null,
    profileHash: null,
    adapterVersion: "evaluation-policy-adapter-v1",
  };
  return { ...identity, id: hashCanonicalJson(identity) };
}

export function createRunManifest(options: CreateRunManifestOptions = {}): RunManifest {
  const root = resolve(options.repoRoot ?? process.cwd());
  const files = collectFiles(root);
  for (const selected of options.selectedSourceFiles ?? []) {
    const candidate = resolve(root, selected);
    if (existsSync(candidate) && !isExcluded(root, candidate) && lstatSync(candidate).isFile()) {
      if (!files.includes(realpathSync(candidate))) files.push(realpathSync(candidate));
    }
  }
  files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const sourceFiles = files.map((file) => artifactFor(root, file));
  const sourceTree = sourceTreeHash(sourceFiles);
  const head = runGit(root, ["rev-parse", "HEAD"]) || "uncommitted-fixture";
  const branch = runGit(root, ["branch", "--show-current"]) || "detached";
  const dirty = runGit(root, ["status", "--porcelain"]).length > 0;
  const lockFile = join(root, "package-lock.json");
  const lockfileHash = existsSync(lockFile)
    ? artifactFor(root, lockFile).sha256
    : hashCanonicalJson({ missing: "package-lock.json" });
  const seeds = {
    master: [...(options.seeds?.master ?? ["evaluation-master-0"])],
    salt: options.seeds?.salt ?? "evaluation-sampling-salt-v1",
  };
  const manifestIdentity = {
    harnessVersion: options.harnessVersion ?? "poker-behavior-evaluation-v1",
    semanticsVersion: options.semanticsVersion ?? "poker-action-semantics-v1",
    registryVersion: options.registryVersion ?? "metric-registry-v1",
    commandArgv: [...(options.commandArgv ?? process.argv.slice(2))],
    gitHead: head,
    branch,
    dirty,
    sourceTreeHash: sourceTree,
    sourceFiles,
    lockfileHash,
    runtime: {
      node: process.version,
      npm: runGit(root, ["--version"]) ? process.env.npm_config_user_agent ?? "unknown" : "unknown",
      platform: os.platform(),
      arch: os.arch(),
    },
    policies: [...(options.policies ?? [defaultPolicy(root, sourceTree)])],
    experiment: {
      commonState: options.experiment?.commonState ?? false,
      naturalPlay: options.experiment?.naturalPlay ?? false,
      fixedStack: options.experiment?.fixedStack ?? false,
      adaptation: options.experiment?.adaptation ?? false,
      reviewer: options.experiment?.reviewer ?? false,
    },
    scope: options.scope ?? "hero",
    clock: options.clock ?? "frozen",
    objective: options.objective ?? "chip",
    bankRef: options.bankRef ?? null,
    split: options.split ?? "development",
    seeds,
    budgets: options.budgets ?? {},
    baselineRef: options.baselineRef ?? null,
    samplingConfigRef: options.samplingConfigRef ?? null,
  };
  const runId = hashCanonicalJson(manifestIdentity);
  const trackedPaths = new Set(runGit(root, ["ls-files"]).split("\n").filter(Boolean));
  const untrackedSourceRefs = sourceFiles.filter((file) => !trackedPaths.has(file.relativePath));
  return {
    schemaVersion: 1,
    runId,
    ...manifestIdentity,
    diffRef: null,
    untrackedSourceRefs,
  };
}

export function manifestCanonicalJson(manifest: RunManifest): string {
  return canonicalize(manifest);
}
