# Build and version policy

Poker Training Pro keeps one local approved package slot. This keeps the
playable build easy to find without accumulating experimental packages.

## The package slot

- `outputs/current` — the approved build used by the desktop shortcut.

The source tree at the repository root is the working source. The package
version in `package.json` remains the product release version; it is not a
reason to create a new output folder.

## Normal workflow

1. Work in the root source tree.
2. Run tests and `npm run build`.
3. Run `npm run package:win`. Electron Builder writes the approved package to
   `outputs/current`.
4. Test the executable at
   `outputs/current/win-unpacked/Poker Training Pro.exe`.

The desktop shortcut points to that same executable, so it continues to launch
the approved build after each verified package.

## Rules for agents

- Never create folders named with feature, date, milestone, revision, or agent
  labels such as `desktop-f06`, `desktop-m103-*`, `r40`, or `final-preview`.
- Never point the desktop shortcut at `next`, an old build, or a nested preview.
- Temporary screenshots, audit reports, profiles, and generated drafts belong in
  `work/` and must be removed when the task is complete.
- Do not commit session logs, handoff notes, chat transcripts, or one-off visual
  captures. Put durable product facts in `APP_OVERVIEW.md` or a focused document.
- Do not commit the local `outputs/current` package or any temporary build
  directory.
