# Poker room music catalogue

The app ships an offline background playlist of ten Kevin MacLeod tracks from
the composer's official Incompetech catalogue. The Ogg/Opus assets total 58:01
and about 45 MiB. They are licensed under Creative Commons Attribution 4.0;
per-track titles, ISRCs, source links, and the license link appear in Credits.

Playback is shuffled. When the library contains more than five tracks, the next
track cannot be any of the player's prior five tracks. That recent history is
retained for the lifetime of the app session, including playlist cycles. Master
volume, Music volume, Mute All, focus pause/resume, and effect ducking apply.
The player uses local `/audio/*.ogg` files only and never streams at runtime.

The release ledger is `config/audio-candidate-manifest.json`; exact checksums
and acquisition evidence are in `docs/audio/production-music-rights.md`, and
the encode/duration report is in `docs/audio/production-music-qa.md`. The
official CC BY legal code is bundled at `licenses/audio/CC-BY-4.0.txt`.

Before packaging, run:

```text
npm run release:verify-audio-rights
```

Do not register the tracks or project encodes with Content ID and do not add an
in-app standalone audio export feature.
