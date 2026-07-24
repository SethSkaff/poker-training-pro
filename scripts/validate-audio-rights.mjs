/**
 * Prevent accidental soundtrack shipment before a track has complete,
 * project-specific redistribution evidence. Candidate research alone is never
 * an accepted master and cannot unlock production playback.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";

const candidatePath = resolve(projectRoot, "config", "audio-candidate-manifest.json");
const productionManifestPath = resolve(projectRoot, "src", "data", "musicPlaylistManifest.ts");
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const source = readFileSync(productionManifestPath, "utf8");
const accepted = Array.isArray(candidate.accepted) ? candidate.accepted : [];
const errors = [];

if (candidate.releasePolicy?.releaseReadyStatus !== "accepted") {
  errors.push("audio candidate manifest must declare accepted-only release policy");
}
if (candidate.releasePolicy?.forbidStandaloneExtractionFeature !== true) {
  errors.push("audio policy must prohibit standalone extraction");
}
if (candidate.releasePolicy?.forbidContentIdRegistrationByProject !== true) {
  errors.push("audio policy must prohibit project Content ID registration");
}

for (const track of accepted) {
  for (const key of [
    "id", "trackTitle", "author", "officialTrackUrl", "licenseReceiptPath",
    "licenseTextPath", "masterPath", "masterSha256", "platformScopeConfirmationPath",
    "attributionRoute", "loudnessReportPath", "loopQaReportPath",
  ]) {
    if (typeof track?.[key] !== "string" || track[key].trim() === "") {
      errors.push(`accepted track ${String(track?.id ?? "(unknown)")} lacks ${key}`);
    }
  }
  for (const pathKey of [
    "licenseReceiptPath", "licenseTextPath", "masterPath", "platformScopeConfirmationPath",
    "loudnessReportPath", "loopQaReportPath",
  ]) {
    const relative = track?.[pathKey];
    if (typeof relative === "string" && !existsSync(resolve(projectRoot, relative))) {
      errors.push(`accepted track ${track.id} evidence is missing: ${relative}`);
    }
  }
  if (!source.includes(`id: "${track.id}"`)) {
    errors.push(`accepted track ${track.id} is not listed in the production playlist manifest`);
  }
}

if (accepted.length === 0 && !/tracks:\s*\[\s*\]/s.test(source)) {
  errors.push("production playlist must remain empty while no track is accepted");
}
const runtimeAudio = resolve(projectRoot, "public", "audio");
if (accepted.length === 0 && existsSync(runtimeAudio) && readdirSync(runtimeAudio).length > 0) {
  errors.push("runtime audio files exist without an accepted rights record");
}
if (errors.length > 0) throw new Error(`Audio rights validation failed:\n- ${errors.join("\n- ")}`);

console.log(JSON.stringify({
  ok: true,
  acceptedTrackCount: accepted.length,
  productionManifestDormant: accepted.length === 0,
  scope: "Candidate research cannot authorize runtime music; accepted tracks require archived master, license, scope, attribution, loudness, and loop evidence.",
}, null, 2));
