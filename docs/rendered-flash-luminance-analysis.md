# Rendered flash/luminance analysis (packaged build)

Status: local rendered-evidence generator implemented. It supplements, and
does not replace, the required recognized photosensitive-epilepsy analysis
tool pass and manual reduced-motion acceptance described in
[`docs/motion-flash-accessibility-policy.md`](./motion-flash-accessibility-policy.md).

`docs/motion-flash-accessibility-policy.md` already gates the CSS/script
*source* for hazardous animation signatures, and says plainly that its
static gate "cannot calculate rendered luminance, saturated-red chromaticity,
affected visual angle, composited video frames, or browser/Electron timing
behavior." `scripts/audit-packaged-flash-capture.mjs` fills that specific
gap: it launches the packaged Windows build under Chrome DevTools Protocol
(CDP), screenshots four deterministically reachable high-motion moments, and
measures them.

**This is an implementation of the WCAG 2.3.1 thresholds, not a certified
tool.** No claim of G15-technique conformance or third-party
photosensitive-epilepsy tool certification is made anywhere in this script or
its evidence output.

## What is captured

Each pass launches the packaged app with an isolated temporary profile
(matching the launch/cleanup pattern in `scripts/profile-packaged-runtime.mjs`
and `scripts/audit-packaged-render-smoke.mjs`), seeds the app's own
`localStorage` settings/progress keys so it lands on the Play/Settings menu
without walking through first-run setup, and then reaches four sequences
using the same production selectors the existing packaged input smoke
(`scripts/audit-packaged-input-smoke.mjs`) already validates:

1. **Title/menu ambient loop** — the Play/Settings screen's
   `home-reference-drift` / `home-reference-light` 2-second CSS animations.
2. **Mode selection** — the four-mode choice screen right after Play.
3. **Room fly-through start** — the first ~1.5 seconds of the tournament
   arrival flythrough (`RoomFlythrough.tsx`'s `loading` → `room` phase).
4. **First dealt hand with chip/card motion** — the live tournament table as
   it first mounts (blind post, hole-card deal).

Screenshots are taken via `Page.captureScreenshot` on a fixed ~100ms
interval for each sequence's planned duration, decoded with the
hand-rolled, dependency-free PNG reader in
`scripts/release/png-decode-lib.mjs` (the project takes no new
dependencies, so there is no bundled image-decoding library; this reader
implements just enough of RFC 2083 — IHDR/IDAT parsing, zlib inflate via
`node:zlib`, and all five PNG scanline filter types — to read Chromium's
non-interlaced 8-bit screenshot output).

Each pass runs twice: once with the app's saved Reduce Motion setting off
("full-motion"), and once with it on ("reduced-motion"), to verify the
static/short-path fallbacks the source-level policy requires.

## The math: WCAG 2.3.1 thresholds as implemented

All formulas live in `scripts/release/flash-luminance-analysis-lib.mjs`,
whose module doc comment is the authoritative description; this section
restates it.

WCAG 2.3.1's glossary defines a **general flash** as a pair of opposing
changes in relative luminance of 10% or more of the maximum relative
luminance, where the darker frame's relative luminance is below 0.80, and a
**red flash** as any pair of opposing transitions involving a saturated red.
Content fails unless it has no more than three flashes of either kind in any
one-second period.

- **Relative luminance** uses the same linearized-sRGB, Rec. 709-weighted
  formula as the WCAG 2.x contrast-ratio definition:
  `L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin`, where each channel is
  linearized from its 0–255 value as `c<=0.03928*255 ? c/12.92 : ((c/255+0.055)/1.055)^2.4`.
- **Saturated red** is approximated as: HSV hue within 20° of red (0°/360°),
  saturation ≥ 0.8, value ≥ 0.5. This is a coarse HSV stand-in for WCAG's CIE
  chromaticity-coordinate polygon, not a colorimetric match.
- **General flash transition**: an adjacent-frame luminance delta ≥ 0.10
  where the darker of the two frames has luminance < 0.80.
- **Red flash transition**: an adjacent-frame change in saturated-red pixel
  coverage ≥ 0.10 (10 percentage points). WCAG's glossary gives no numeric
  magnitude for the red case; this mirrors the general-flash 10% figure for
  consistency, which is a project choice, not a standard requirement.
- **Flash counting**: only *opposing* transitions count (an increase
  reversing a prior decrease, or vice versa); consecutive same-direction
  significant changes are one ongoing change, not repeated flashes.
- **Flashes per second**: the maximum number of counted flash events found in
  any sliding one-second window over the observed event timestamps (exact,
  not binned).
- **Area**: like the project's static gate, this measures the whole captured
  region as a single block rather than scanning every possible 341×256px
  sub-block WCAG's full definition allows. That is the more conservative
  reading of the two (it cannot hide a small hazardous region behind a
  passing whole-frame average, though it also cannot pinpoint which
  sub-region would be responsible).
- **Ceiling**: > 3 flashes of either kind in any one-second window fails,
  matching `docs/motion-flash-accessibility-policy.md`'s existing
  three-per-second ceiling for the static gate.

## Run

```powershell
node scripts/audit-packaged-flash-capture.mjs
```

Run the pure-math and PNG-decoder self-tests independently of the packaged
app with:

```powershell
node scripts/test-flash-luminance-analysis.mjs
node scripts/test-png-decode.mjs
```

## Evidence produced

- `work/packaged-flash-luminance-analysis.json` — canonical, versioned JSON
  with per-pass, per-sequence frame-by-frame luminance/red-coverage values,
  detected flash events, pass/fail per sequence, and the full limitations
  list.
- `work/packaged-flash-luminance-analysis.md` — a concise per-pass table.

Raw screenshot bytes are discarded after analysis; only the derived numeric
per-frame summaries are persisted, to keep the evidence bounded and
deterministic in shape.

## Limitations (restated from the JSON)

- One host, one rendered capture pass per motion setting — not the required
  low-spec/typical/discrete-GPU hardware matrix, and not a substitute for the
  recognized photosensitive-epilepsy analysis tool pass the release policy
  still requires.
- Screenshot timestamps reflect when Node issued the CDP capture command, not
  a frame-accurate compositor timestamp; very short sub-interval transitions
  can be missed or their timing smeared. On the reference host, the achieved
  interval between screenshots was often well above the requested ~100ms
  (up to roughly 600ms/frame on the room fly-through and title-menu
  sequences, driven by CDP round-trip and PNG encode cost rather than the
  requested interval). By the Nyquist rate, a sparsely-sampled sequence can
  only reliably rule out flashing up to about half its achieved frame rate —
  a "pass" on such a sequence is weaker evidence than on a densely-sampled
  one. Each sequence's `achievedMeanFrameIntervalMs` in the JSON records the
  actual rate for that run.
- Per-frame summaries sample every third pixel (not every pixel) for
  decode/compute speed across the run's many full-viewport captures.
- Only four deterministically reachable sequences are covered. Later hands,
  other modes' presentation states, hover/focus transitions, settings-screen
  motion, and any future start-menu video are not covered by this script and
  still need the manual checks in
  `docs/motion-flash-accessibility-policy.md`.
- The reduced-motion pass toggles the app's own saved Reduce Motion setting
  (the mechanism the codebase actually reads). It does not currently read the
  operating-system `prefers-reduced-motion` media query at all — this script
  does not change that; the OS-preference path remains a separate manual
  check per policy.

## If a sequence fails

This script does not modify `src/`. If any sequence exceeds the three general
or red flashes per second ceiling in either pass, the JSON/Markdown record
the failing sequence, pass, and event timestamps, and the script exits
non-zero. Treat that as a precise engineering finding for the team to review
and fix in source — do not ship the sequence, and do not hand-wave the
failure away using this script's own "not a certified tool" caveat.
