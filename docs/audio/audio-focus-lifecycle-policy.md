# Audio focus and lifecycle policy

Status: deterministic policy and engine seam implemented; desktop lifecycle
wiring and packaged-device validation remain open.

## Contract

Audio is supplementary. Losing it must never block a poker action, alter a
decision, reveal hidden information, or overwrite the player's Music, SFX,
Master, or Mute preferences.

`src/lib/audioFocusPolicy.ts` is the single lifecycle policy:

- the initial state is silent until a browser user activation;
- pause, blur, hidden/minimized, suspend, and an audio interruption mute
  immediately and suspend an existing Web Audio context;
- clearing those conditions does **not** resume audio;
- the app must show its Ready recap and dispatch `ready-confirmed` only after
  every blocker has cleared;
- a removed/unavailable selected output remains silent after it returns until
  that same Ready confirmation;
- duplicate and overlapping events are idempotent;
- an audio failure is terminally silent for that process, while gameplay
  continues;
- lifecycle focus only calls `setFocusMuted`; it never writes user volume or
  mute settings.

`AudioFocusController` is a UI-independent effect runner. The host maps
Electron/DOM events to policy events and uses its state to decide when the
existing Ready recap is required. The controller may target `GameAudio`
directly.

`src/lib/audioOutputMonitor.ts` is the optional exact-device monitor. It never
requests permission, ignores failed enumeration, deduplicates events, and
invalidates asynchronous results after it is stopped.

## Required desktop event mapping

| Host signal | Policy event |
| --- | --- |
| First trusted click/key action | `user-activated` |
| Pause menu opens/closes | `manual-pause: true/false` |
| `window.blur` / `window.focus` | `window-focus: false/true` |
| `document.visibilitychange` | `document-visibility` |
| Electron `powerMonitor` suspend/resume | `system-suspend` |
| Native/OS interruption if exposed | `audio-interruption` |
| Selected output disappears/returns | `output-availability` |
| Player presses Ready | `ready-confirmed` |

The host must not dispatch Ready merely because focus, visibility, power, or a
device returns. If blur and suspend overlap, for example, both corresponding
clear events are required before Ready can succeed.

## Output devices and headphone removal

Chromium's `mediaDevices.devicechange` is only a hint that the device list
changed. Device labels and stable IDs can be unavailable until permission is
granted, and a default-device route can change without identifying a
"headphones removed" semantic event. Therefore:

1. Track an explicitly selected output ID only when the platform exposes one.
2. On `devicechange`, enumerate outputs and mark output unavailable only when
   that tracked ID is absent.
3. Do not infer headphones removal from a label, device count, or a transient
   enumeration error.
4. When no stable selected ID exists, keep the state unknown/available and rely
   on Web Audio state/error signals. Do not claim headphone-removal coverage.
5. If a native Electron helper later supplies a reliable removal event, map it
   to `output-availability: false`.

No permission prompt may be issued solely to identify an audio output.

## Windows and simultaneous system audio

Windows normally mixes Electron's audio session with other applications.
Chromium/Web Audio does not provide a reliable, privacy-safe signal that
another application started or stopped audio, nor a general exclusive
"audio-focus" API comparable to mobile interruption APIs. The policy records
`system-audio` as advisory but deliberately does not duck, pause, resume, or
change volume from it. The player controls Master/Mute and the Windows volume
mixer remain authoritative.

If a future native integration supplies a trustworthy interruption (not merely
"another app is audible"), use `audio-interruption`. Do not implement volume
ducking from polling, loopback capture, process enumeration, or microphone
permission.

## Web Audio constraints

- `AudioContext.resume()` may be rejected without user activation. The engine
  only resumes from the explicit activation/Ready effect.
- Background throttling and OS suspend can delay or coalesce DOM timers and
  events. Audio policy is not a clock; tournament active time must be paused by
  the game lifecycle separately.
- `AudioContext.state === "interrupted"` exists on some platforms but is not a
  portable desktop guarantee. Treat platform-specific interruption callbacks
  as optional input.
- A device can fail between availability detection and playback. All graph,
  suspend, and resume failures remain silent and non-fatal.
- The current build has no approved soundtrack masters. This policy is ready
  for later licensed playback but does not approve or add audio assets.

## Verification still required

- Wire one controller at the desktop app lifecycle boundary and remove direct,
  competing focus-mute calls.
- Bridge Electron `powerMonitor` suspend/resume through a narrow preload API.
- Connect the existing Ready recap to `ready-confirmed`.
- Decide whether an explicit output picker will ship; only then implement
  selected-output tracking.
- On supported Windows hardware, test Alt+Tab, minimize, lock/unlock,
  suspend/resume, device removal/reconnect, Bluetooth profile changes, default
  route changes, and concurrent browser/music playback.
- Repeat the matrix against the packaged signed release candidate. Automated
  reducer tests prove transition semantics, not operating-system delivery.
