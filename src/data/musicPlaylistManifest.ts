import type { PlaylistManifest } from "../lib/musicPlaylist";

/**
 * PRODUCTION MUSIC MANIFEST — intentionally empty.
 *
 * No licensed instrumental masters ship yet. The candidate research lives in
 * `config/audio-candidate-manifest.json`, but every entry there is still
 * `conditional-license-and-source-verified`: no master has been downloaded,
 * licensed, loudness-normalised, or QA'd. Until a real licensed track exists
 * this list stays empty, which keeps `createMusicPlaylist` dormant so it builds
 * no audio graph and produces no sound.
 *
 * Activation checklist (do NOT ship music until all are true):
 *  - a licensed master is archived with license text, source, and attribution;
 *  - loudness normalisation, looping, memory, and package-size checks pass;
 *  - the Credits/Licenses screen lists the track and its attribution.
 */
export const productionMusicManifest: PlaylistManifest = {
  version: 1,
  crossfadeSec: 4,
  tracks: [],
};

/** True only once a licensed master has been added to the manifest above. */
export const musicPlaylistAvailable =
  productionMusicManifest.tracks.length > 0;
