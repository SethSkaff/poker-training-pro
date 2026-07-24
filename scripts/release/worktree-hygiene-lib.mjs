const REJECTED_SUFFIXES = Object.freeze([
  ".rej",
  ".orig",
  ".base",
  ".local",
  ".remote",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".swift",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const CONFLICT_PREFIXES = Object.freeze([
  "<".repeat(7) + " ",
  "|".repeat(7) + " ",
  "=".repeat(7),
  ">".repeat(7) + " ",
]);

export function isRejectedMergeArtifact(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new TypeError("A non-empty relative path is required.");
  }
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  return REJECTED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function shouldInspectConflictMarkers(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return false;
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  const fileName = normalized.slice(lastSlash + 1);
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return TEXT_EXTENSIONS.has(extension);
}

export function findConflictMarkerLines(text) {
  if (typeof text !== "string") {
    throw new TypeError("Conflict-marker input must be text.");
  }
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (
      CONFLICT_PREFIXES.some((prefix) =>
        prefix === "=".repeat(7)
          ? line.trim() === prefix
          : line.startsWith(prefix),
      )
    ) {
      findings.push(index + 1);
    }
  }
  return findings;
}

