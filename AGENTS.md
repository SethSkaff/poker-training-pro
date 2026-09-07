# Poker Training Pro agent instructions

These instructions apply to every AI coding session in this repository.

## Required session closeout

1. Keep the primary checkout on `main`. Every change made during the session must
   end up committed on local `main`; if work was done in an agent branch or
   worktree, bring that commit back to `main` before handing the work back.
   Preserve unrelated user changes and never reset or rewrite existing history.
2. Verify the result before committing. For source changes, run the relevant
   tests and `npm run build`; run `npm run package:win` when the packaged desktop
   app needs to reflect the changes.
3. Make the desktop shortcut point to the latest approved build by running
   `npm run release:update-shortcut`. The script targets
   `outputs/current/win-unpacked/Poker Training Pro.exe` and creates or updates
   `Poker Training Pro.lnk` on the user's Desktop.
4. Confirm `git status --short --branch` is clean after the commit, except for
   intentionally ignored build output.

## Commit identity

For this repository, use the personal GitHub identity below so new commits are
attributed to Seth Skaff. Configure it locally if the checkout does not already
have it:

```powershell
git config user.name "Seth Skaff"
git config user.email "97866615+SethSkaff@users.noreply.github.com"
```

This does not rewrite older commits. GitHub links commits to the account when
the commit email is an address verified by that account.
