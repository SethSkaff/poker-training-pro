# Poker room music catalogue

The game has a shuffled, offline-first music player. It supports no immediate repeats, crossfades, Music/Master volume, Mute All, focus pause/resume, and sound-effect ducking. It only plays masters bundled at `/audio/...`; it never streams music at runtime.

## Five-hour programme

The candidate catalogue is encoded in `src/data/musicRotationCatalogue.ts`: sixteen restrained jazz, noir, and ambient cues in four differently ordered passes. The planned duration is a little over five hours. Every entry has its composer, source page, CC BY 4.0 route, and required credit. The two direct-composer catalogues are Silverman Sound and Incompetech.

## Why music is not bundled yet

These are researched candidates, not approved masters. No files are bundled until the exact downloaded master and its project redistribution evidence are archived. This avoids shipping music based only on a source-page claim, avoids remote playback, and keeps the desktop release usable offline.

## Activation checklist

1. Choose and download the exact master from its listed source page, or acquire the composer’s project-specific paid licence.
2. Save the master under `public/audio/` and record its checksum, source page, licence text, receipt, platform scope, loudness report, and loop QA in `config/audio-candidate-manifest.json`.
3. Move only fully evidenced records to `accepted`, then add their `id`, `durationSec`, and `/audio/...` `assetPath` to `src/data/musicPlaylistManifest.ts`.
4. Include the displayed CC BY credits in the in-game Credits/Licenses screen when using the free route. Do not register any of these tracks in Content ID and do not offer standalone extraction.
5. Run `npm run release:verify-audio-rights` before packaging.

The player becomes live automatically as soon as one approved packaged manifest entry exists; no additional wiring is needed.
