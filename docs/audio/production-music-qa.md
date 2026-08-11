# Production music QA

Ten composer-hosted MP3 masters were downloaded and verified as decodable audio.
They were transcoded with checksum-verified FFmpeg 9.0 to Ogg Opus, stereo,
96 kb/s variable bitrate. This reduces the approximately 58-minute library to
45.33 MiB while retaining efficient background-music quality.

The app applies a four-second crossfade, so the source files do not need to be
seamless loops. Playback is offline-only and failure-tolerant: an unavailable
or undecodable voice is skipped without affecting gameplay. Music pauses with
desktop audio focus, ducks beneath public table effects, and follows persisted
Master, Music, and Mute All settings.

| File | Duration (s) | SHA-256 |
|---|---:|---|
| ambiment.ogg | 1372.87 | c39fab308fb71c4d6841600a4aef2a05c5e3f6fa6ba286a7b2e030d8883349c1 |
| space-jazz.ogg | 369.51 | 3e0e89f9377e5909ab5040c6984e2e12e8725050f297284f945038a17b905016 |
| water-prelude.ogg | 324.92 | bab2861b19025ba267234815e7ccd284e479ac15ef0f0cfc54de88a8d3dadd23 |
| study-and-relax.ogg | 223.41 | 04876c361f9debff6cb5d5ced597704aa6e9996d132c0ac3a5734d9b1f9c7e69 |
| poppers-and-prosecco.ogg | 193.78 | 94d5914395bf4d6c9c47513b4f1e42207180dbab21337e94a0d4d763f938aeb2 |
| night-on-the-docks-sax.ogg | 174.06 | 42aeb1e89e22bef4d0ba53d3ff85cbae9db75f22f2a80111d23b608777bb8ff8 |
| george-street-shuffle.ogg | 268.31 | e6a795ca6f595f8cbbf36e8570cff07ab7fdd17a122260f5781a42e3eae8e7c4 |
| cool-vibes.ogg | 218.39 | 6624a2c542e7c94e8ae543f23d1afc892f4b31a3a9a08297ccb9bcb43b216826 |
| local-forecast-elevator.ogg | 189.21 | 595cd5d71f6ac097635a1155fdf512de1c465790ef75695665cad50b0d2e4a3a |
| dances-and-dames.ogg | 146.84 | f6634a381eece5b291a3350794481f88461ca63756c8c856fe761a684acc402e |

Total decoded duration: 3481.30 seconds (58:01.3).
