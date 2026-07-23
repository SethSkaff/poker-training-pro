# Settings audio previews

Master and Table effects use explicit preview buttons beside their sliders.
Moving a slider only updates the saved setting; it does not construct or resume
an audio graph. A graph may be initialized only after the player activates a
Preview button.

Before playing a cue, the preview coordinator reapplies the persisted mute,
Master, and Table effects values. Mute or a zero effective level returns a
silent status without constructing a graph. Device, graph, and cue failures are
contained and reported through one polite status message; they never block
Settings or gameplay.

The controls use native range inputs and buttons, so arrows/Page Up/Page Down
operate sliders and Enter/Space activate previews. Each slider is associated
with its description and current percentage. Preview results use one
`role="status"` / `aria-live="polite"` region that changes only after an
explicit preview, avoiding announcements on every slider tick.

Music volume remains adjustable for future licensed content, but its preview is
visibly disabled and labeled unavailable. Do not enable it until approved exact
masters and their release evidence are present.

Focused verification:

```powershell
& "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  ".\node_modules\vitest\vitest.mjs" run `
  "src/lib/audio.test.ts" `
  "src/lib/audioPreview.test.ts" `
  "src/components/SettingsPanel.test.tsx"
```

