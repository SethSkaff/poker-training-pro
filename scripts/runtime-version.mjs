export const MINIMUM_NODE_VERSION = "22.12.0";
export const PINNED_NODE_VERSION = "22.12.0";

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse the Node-style semver strings used by process.versions and pin files. */
export function parseNodeVersion(value) {
  if (typeof value !== "string") return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
  };
}

function compareNodeVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === null && right.prerelease !== null) return 1;
  if (left.prerelease !== null && right.prerelease === null) return -1;
  return 0;
}

export function isSupportedNodeVersion(value) {
  const current = parseNodeVersion(value);
  const minimum = parseNodeVersion(MINIMUM_NODE_VERSION);
  return Boolean(
    current && minimum && compareNodeVersions(current, minimum) >= 0,
  );
}

export function unsupportedNodeVersionMessage({
  version = process.versions.node,
  execPath = process.execPath,
  workflow = "Poker Training Pro developer workflows",
} = {}) {
  return [
    `${workflow} requires Node.js >=${MINIMUM_NODE_VERSION}; current runtime is ${String(version)}.`,
    `Runtime executable: ${execPath}`,
    `Switch to the version pinned in .node-version/.nvmrc (${PINNED_NODE_VERSION}) or a newer supported release, then retry.`,
  ].join("\n");
}

/** Fail before loading Vite, Vitest, Electron Builder, or release tooling. */
export function assertSupportedNodeVersion(options = {}) {
  const version = options.version ?? process.versions.node;
  if (isSupportedNodeVersion(version)) return version;
  const error = new Error(
    unsupportedNodeVersionMessage({ ...options, version }),
  );
  error.code = "ERR_UNSUPPORTED_NODE_VERSION";
  throw error;
}
