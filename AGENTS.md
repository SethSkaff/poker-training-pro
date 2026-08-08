# Agent instructions for Poker Training Pro

The repository root is the source of truth for the game. Keep the working tree
focused on source, assets, tests, release policies, and durable documentation.

Build artifacts use exactly two slots:

- `outputs/current` is the approved build and the desktop shortcut target.
- `outputs/next` is the only candidate build. `npm run package:win` writes there.

Never create numbered, dated, milestone, feature, revision, preview, handoff, or
session-log build folders. Do not preserve old packages “just in case.” Use
`work/` for temporary generated evidence and clean it at the end of the task.
After explicit approval, rotate the candidate with:

```powershell
powershell -File scripts/promote-build.ps1 -Force
```

Keep `APP_OVERVIEW.md` accurate when the product or architecture changes. Keep
durable build rules in `VERSION_POLICY.md`. Do not add chat transcripts,
agent-to-agent handoffs, or session logs to the repository.
