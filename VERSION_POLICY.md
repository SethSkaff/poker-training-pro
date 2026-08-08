# Build and version policy

Poker Training Pro uses two build slots. This keeps the playable build easy to
find and prevents experimental packages from accumulating in the repository.

## The only two slots

- `outputs/current` — the approved build used by the desktop shortcut.
- `outputs/next` — the one candidate build being tested or reviewed.

The source tree at the repository root is the working source for `next`. The
package version in `package.json` remains the product release version; it is not
a reason to create a new folder.

## Normal workflow

1. Work in the root source tree.
2. Run tests and `npm run build`.
3. Run `npm run package:win`. Electron Builder writes only to `outputs/next`.
4. Test and approve the candidate.
5. Run `powershell -File scripts/promote-build.ps1 -Force`.

Promotion removes the previous `outputs/current` build and moves `outputs/next`
into its place. The desktop shortcut already points to `outputs/current`, so it
continues to launch the approved build without being edited for every release.

## Rules for agents

- Never create folders named with feature, date, milestone, revision, or agent
  labels such as `desktop-f06`, `desktop-m103-*`, `r40`, or `final-preview`.
- Never point the desktop shortcut at `next`, an old build, or a nested preview.
- Temporary screenshots, audit reports, profiles, and generated drafts belong in
  `work/` and must be removed when the task is complete.
- Do not commit session logs, handoff notes, chat transcripts, or one-off visual
  captures. Put durable product facts in `APP_OVERVIEW.md` or a focused document.
- Do not delete `current` until `next` contains a verified runnable executable
  and the user has approved promotion.
