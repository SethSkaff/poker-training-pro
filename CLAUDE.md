# Claude instructions for Poker Training Pro

Treat the repository root as the canonical source tree. The only packaged build
locations are `outputs/current` (approved and launched by the desktop shortcut)
and `outputs/next` (the single candidate under review).

Run `npm run package:win` only for the candidate slot. Never create historical
folders such as `desktop-f06`, `desktop-m103-*`, `r40`, or `final-preview`.
Temporary screenshots, logs, profiles, and audit evidence belong in `work/` and
must be deleted after use. Do not add session logs or handoff transcripts.

After the user approves the candidate, rotate it with
`powershell -File scripts/promote-build.ps1 -Force`; do not manually repoint the
desktop shortcut. Update `APP_OVERVIEW.md` when durable product behavior
changes, and follow `VERSION_POLICY.md` for the complete workflow.
