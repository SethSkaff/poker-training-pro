import assert from "node:assert/strict";
import {
  findConflictMarkerLines,
  isRejectedMergeArtifact,
  shouldInspectConflictMarkers,
} from "./worktree-hygiene-lib.mjs";

assert.equal(isRejectedMergeArtifact("src/App.tsx.rej"), true);
assert.equal(isRejectedMergeArtifact("src\\App.tsx.ORIG"), true);
assert.equal(isRejectedMergeArtifact("docs/original-design.md"), false);
assert.equal(shouldInspectConflictMarkers("src/App.tsx"), true);
assert.equal(shouldInspectConflictMarkers("public/image.png"), false);
assert.deepEqual(
  findConflictMarkerLines(
    [
      "ordinary text",
      "<".repeat(7) + " local",
      "ours",
      "=".repeat(7),
      "theirs",
      ">".repeat(7) + " incoming",
    ].join("\n"),
  ),
  [2, 4, 6],
);
assert.deepEqual(
  findConflictMarkerLines(
    "Use ======= inside a sentence without creating a conflict marker.",
  ),
  [],
);

console.log(
  "Worktree hygiene negative self-tests passed: rejected artifacts and unresolved conflict markers are detected without substring false positives.",
);

