# Poker Training Pro — Application Overview

This is the current product and engineering brief for Poker Training Pro. It
was refreshed on 2026-08-03 against the source tree and the latest packaged
desktop build. The app release version is still `0.1.0`; build artifacts are
managed separately through the `current` and `next` slots described in
[VERSION_POLICY.md](VERSION_POLICY.md).

## Product in one paragraph

Poker Training Pro is an offline Windows desktop game and trainer for
tournament No-Limit Texas Hold'em. It combines playable six-seat tournaments,
two different opponent philosophies, one-decision training drills, poker-math
feedback, ratings, career progression, hand review, and a stylized championship
room. It uses play chips only: there is no wagering, payment, cash-out, account,
advertising, analytics, or required network connection. Progress and settings
stay on the local device. The desktop application runs offline from the
Electron shell and can be developed on Windows or macOS.

## What the player can do

The desktop shell is organized around a home screen, a Play mode selector, and
supporting screens rather than a dashboard full of simultaneous panels.

- The home screen presents the Poker Training Pro mark and the main Play,
  Settings, Profile, and Credits/support routes.
- The first-run gate collects motion, contrast, and mute preferences before
  timed presentation begins. A separate play-chip acknowledgment is required
  before the first scored play session.
- Play opens the four game modes, the playable tutorial, and the poker
  reference. It can also enter a saved/resumable session when one exists.
- Career travel and room-transition screens move the player into the next event
  or table. A tournament ceremony reports placement, qualification, unlocks,
  rating changes, and the important hands from the completed event.
- The Profile/Player Record screen shows ratings, training progress, tournament
  results, and career progress.
- Hand Review derives a redacted review from a completed public replay. It
  groups decisions by street, rates regret/quality, identifies notable choices,
  and shows the math and strategic explanation without revealing opponent hole
  cards that were not public at the time.
- Settings contains display, motion, accessibility, camera, audio, control
  remapping, save-data, and diagnostic controls. Credits lists the bundled
  fonts, packages, runtime notices, privacy/support information, build metadata,
  and the locations of saves and logs.

## Game modes

| Mode | Player promise | Progress and opponents |
| --- | --- | --- |
| Normal Tour | A tournament against strong, bounded personalities that bluff, adjust, and vary without deliberately making nonsense plays. | Career events and tournament rating; Normal policy. |
| Rational Tour | A tournament against opponents that reason from ranges, equity, position, and tournament risk using only information available to their seat. | Career events and tournament rating; Rational policy. |
| Training Lab | One realistic decision followed by a related contextual math question, with immediate feedback and an explanation of the underlying tradeoff. | Decision Elo and Math Elo; validated scenario bank. |
| Timed Table | A single table configured around the time the player has available, intended to finish near the selected deadline. | Placement rating without career progression; deterministic timed blind director. |

Career uses five tiered events: Local Qualifier, Regional Open, Circuit Main,
National Championship, and World Championship. The session tracks qualification,
placement, tournament rating, and the event result. The tournament engine is
the authoritative state machine; the presentation never invents a result or
silently changes a legal action.

Training accepts practical table notation for percentages, decimals, fractions,
and ratios, including decimal-comma input. Grading is based on modeled EV regret
and tolerance bands rather than a brittle exact-string answer. Scenario data has
its own schema/content version, source metadata, reviewer metadata, legality
validation, duplicate detection, and calibration checks.

Timed Table asks for a bounded duration, preserves a normal opening phase, and
then increases pressure with deterministic blind scheduling. At or after the
deadline, the director forces the big blind to cover the second-largest live
stack so the table resolves rather than running indefinitely. Pauses, minimize,
screen lock, and inactive time are excluded from the timed promise.

## Opponent behavior

Normal and Rational are different policies, not merely easy and hard settings.

### Normal policy

Normal opponents use deterministic personality profiles, private-hand strength,
public betting history, position, stack pressure, and bounded exploit signals.
They can bluff and change aggression, but candidate actions are filtered through
legality and purpose constraints so the result remains plausible rather than
random. Their private cards are used only by the acting opponent's policy and
are never exposed to the player or public replay.

### Rational policy

Rational opponents build an information set from legal public information and
their own seat's available cards. They do not receive the hero's hidden cards or
future board cards. Range equity is estimated with deterministic, seeded Monte
Carlo work. Live tournaments request 60 simulations per decision; 1,200 is the
hard engineering ceiling for every caller, not the live default. Browser
renderers without the Electron desktop bridge use a module Web Worker with
between-slice cancellation and stale-result rejection. The hardened Electron
renderer, including the packaged Windows app, deliberately uses the identical
synchronous estimator because its module-worker bootstrap is not yet reliable
under the packaged sandbox. That fallback is deterministic and capped, but its
bounded work still runs on the renderer thread.

### Decision timing

Both policies produce a presentation delay from decision closeness, street,
action complexity, tempo, seeded jitter, and anti-tell noise. Timing is not the
policy result and is intentionally capped so thinking time cannot reliably leak
hand strength or intended action. The player can change presentation speed, and
the accessible Skip control resolves queued presentation delay without changing
or duplicating the selected action.

## Poker engine and deterministic state

The engine is independent of React and Electron. The main pieces are in
`src/engine`, `src/modes`, `src/types`, and `src/workers`.

- deterministic deck creation, shuffling, and hand evaluation;
- legal betting targets, minimum raises, all-ins, side pots, chip conservation,
  blind schedules, eliminations, and table progression;
- six-seat compressed tournament sessions and an async tournament runner;
- Normal, Rational, and Timed policy selection through one session boundary;
- public-action presentation events for deals, bets, folds, showdowns, awards,
  side pots, eliminations, and travel between seats;
- public replay creation/restoration and redaction checks;
- pairwise tournament, decision, and math rating calculations.

The current replay identifiers are `tournament-session-v1`,
`career-events-v1`, and `normal-rational-v4`. A replay records the engine/content
and policy identifiers, seed, public action log, blind structure, simulation
settings, and public entrant data. It does not store opponent hidden cards as a
player-visible or exported public fact. Engine invariants and deterministic
replay tests cover card uniqueness, betting legality, chip conservation, hidden
information, side pots, long sessions, and completion across modes.

## Current desktop presentation

The desktop table now has a real three.js/WebGL2 scene behind the existing DOM
table. The scene is presentation-only: it reads the same public snapshot as the
DOM and never owns engine state.

- The canvas is decorative (`aria-hidden` and not focusable); the DOM remains
  the interaction and accessibility surface.
- The current table uses an authored original `.glb` table master compiled to
  `src/scene3d/generated/tableGeometry.ts`. The geometry includes the felt,
  padded rail, metal trim, medallion, betting line, player zones, pedestal,
  cards, and chip body.
- Procedural scene code supplies the room context, seats, chairs, dealer,
  markers, cards, chips, lighting, camera, public action cues, and state-driven
  motion. The implementation is stylized low-poly, not photorealistic.
- The hero peek is a connected asymmetric first-person hand rig. Each card is
  one grouped mesh with a planted face-down majority and a curved, privately
  authorised printed underside using the same visible orientation as community cards; projection tests keep
  the side shield clear and the rear brace depth-occluded across camera poses.
- Physical chip stacks use denomination-pure low-to-high columns with printed
  values, contact shadows, and diagnostics that assert rendered chip value and
  DOM parity. The 15,000 opening rack includes playable change instead of
  collapsing into high-value plaques. Stack and bet labels use the active
  renderer camera frame so they remain attached during camera motion.
- Card presentation is driven by explicit dealer reach, grasp, lift, transport,
  place, reveal, release, and return phases. Burn cards precede board cards, and
  public-card ownership/face state is reported through the redacted audit path.
- The player has a limited camera pan and recenter behavior rather than an
  unrestricted free camera. Camera views and motion preferences are part of the
  persisted settings and are tested against the table composition contract.
- If WebGL2 is unavailable, blocked, or loses its context unrecoverably, the
  existing CSS/DOM table remains the fallback renderer. Reduced motion
  suppresses automatic and interpolated scene motion while preserving direct
  camera look; the explicit camera-motion-off setting pins and disables the
  camera controls.
- The renderer stops when suspended, minimized, or otherwise hidden. It reports
  only renderer/lifecycle diagnostics to the packaged audit path.

The arrival/travel screens and the table renderer are separate presentation
layers. The current build has the playable WebGL2 table scene; a fully
continuous 3D fly-through through every venue/table remains a future
presentation expansion, not a prerequisite for the poker engine or DOM table.

## Input and interaction

A single versioned action map is shared by menus and gameplay across keyboard,
mouse, and Gamepad API input. It covers menu navigation, Fold, Check/Call,
raise sizing, custom raise, all-in, peek/hide cards, camera left/right and
recenter, speed controls, pause, hand review, and back/confirm actions.

Control remapping supports keyboard and gamepad overrides, conflict detection,
reserved-key warnings, device-specific defaults, and reset-to-default behavior.
Text fields, sliders, remapping dialogs, and system dialogs capture input so a
hotkey cannot trigger a poker action accidentally. No required action depends
on dragging, holding, double-clicking, or rapid repeated input.

Gamepad prompts appear when a gamepad is the most recent input device. Focus
movement, activation, back, and slider adjustment work through the D-pad/stick
and face buttons. Mouse and keyboard remain complete paths.

## Accessibility and lifecycle behavior

Accessibility is implemented in the DOM layer and tested at source and packaged
levels.

- named seat groups, community cards, hero cards, pots, actions, and state
  changes have semantic labels;
- live announcements cover actions, blinds, pots, side pots, all-ins, results,
  and errors without exposing hidden information;
- focus traps restore prior focus, modal dialogs have initial focus, and the
  global focus indicator remains visible over the scene;
- Compact, Standard, Large, and Extra Large UI scales affect table labels and
  action targets as well as ordinary text;
- reduced motion follows the OS preference by default, while an explicit
  in-app choice wins; color is never the only signal;
- primary poker actions target 44px hit areas and utility controls target 24px;
- rendered luminance/flash checks and contrast audits protect the presentation;
- tutorials, explanations, errors, and important notifications stay available
  until dismissed.

When the window blurs, minimizes, locks, suspends, or loses visibility, the app
freezes the exact remaining AI/presentation delay rather than letting timers
continue in the background. On resume it presents a readable recap and excludes
inactive time from Training and Timed Table. Safe lifecycle boundaries save
progress before close, Windows session end, suspend, and other relevant events.

## Saves, recovery, and diagnostics

Electron owns durable data under the app's per-user `userData` directory. The
renderer `localStorage` path is only a legacy import source. Save generations
use temporary writes, replacement/rotation, checksums, and a previous valid
generation so one failed write cannot destroy the only known-good save.

Players can export and import saves, export public replays, export redacted
diagnostics, or reset progress through explicit confirmation flows. Import and
reset use previews and change tokens to protect against time-of-check/time-of-
use changes. Settings reset is separate from progress deletion.

If recovery is needed, the recovery screen identifies the available generation
and offers restore, diagnostic export, start fresh, or cancel. Repeated startup
or renderer failures activate a safe mode that disables hardware acceleration,
forces reduced motion and mute, ignores unsafe imported settings, and preserves
progress while presenting a redacted recovery state.

## Offline, privacy, and packaging

The packaged app bundles its runtime assets and fonts. Electron security controls
include a strict content-security policy, renderer sandboxing, blocked
permission requests, restricted navigation/new windows/downloads, validated IPC
senders and arguments, and a narrow typed preload bridge. The packaged network
audit denies representative external traffic. There is no account, telemetry,
remote font, CDN asset, bot server, or mandatory update check.

Electron fuses, ASAR integrity, source-map/developer-tool exclusion, asset-rights
checks, package notices, and play-chip boundary scans are part of the release
verification work. Credits and support surfaces expose the privacy policy,
licenses, package/runtime notices, build metadata, save/log locations, and
diagnostic export.

Audio controls are present for master, music, effects, and mute. Sound waits for
user interaction, follows focus and lifecycle changes, and has a silent failure
path. The deterministic playlist/ducking engine is dormant until licensed music
masters and attribution are available, so the current production build does not
ship unlicensed soundtrack files.

## Localization and teaching content

English is an explicit complete locale with a versioned message catalog,
interpolation helper, numeric/date formatting, direction-safe message
components, pseudo-localization, long-name checks, and right-to-left layout
tests. Training scenarios and third-party license text are deliberate
exemptions because their wording is governed by separate content/legal
workflows.

The playable tutorial introduces peeking, legal actions, bet sizing, hand flow,
showdown, chips versus pot odds, equity, and expected value. Contextual coaching
appears for events such as all-ins, side pots, minimum raises, blind increases,
eliminations, qualifications, and rating changes. The reference screen remains
available as an always-on poker rules/math aid.

## Repository map and honest status

- `src/` — React UI, engine, modes, scene, assets, localization, tests.
- `electron/` — native shell, preload bridge, durable saves, recovery, logs,
  replay export, and lifecycle handling.
- `public/`, `src/assets/`, `build/`, `licenses/` — runtime assets and legal
  packaging inputs.
- `scripts/`, `config/`, and `docs/` — repeatable audits, release policy, asset
  rights, architecture, and support documentation.
- `outputs/current` — approved runnable package; `outputs/next` — one candidate.

The current desktop source and package are feature-complete for the intended v1
training-game scope, but the product is not a public release. Remaining
limitations include code-signing and update infrastructure, licensed music,
commercial clearance for any supplied artwork that lacks final documentation,
hardware/accessibility acceptance on real Windows devices, low-spec performance
and long-session soak coverage, clean-machine install/upgrade testing, and
human validation of the synthetic training-calibration baseline. None of these
limitations should be hidden by describing the project as fully released or
externally validated.
