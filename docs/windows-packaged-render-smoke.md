# Windows packaged-render smoke

`scripts/audit-packaged-render-smoke.mjs` verifies the renderer that is
actually embedded in the unpacked Windows package. It exists specifically to
catch packaging mistakes that unit tests and a successful Vite build cannot,
including an ASAR that opens a blank document.

## Run

Use Node.js 22 or newer:

```powershell
node scripts/audit-packaged-render-smoke.mjs
```

The default executable is:

`outputs/next/win-unpacked/Poker Training Pro.exe`

An explicit package and hard timeout can be supplied:

```powershell
node scripts/audit-packaged-render-smoke.mjs --app "D:\staging\Poker Training Pro.exe" --timeout-ms 30000
```

Run the deterministic negative self-tests separately:

```powershell
node scripts/test-packaged-render-smoke.mjs
```

## Pass contract

The script starts one packaged process with a newly created temporary
`--user-data-dir` and Chromium's ephemeral remote-debugging port. After CDP is
attached, it reloads the page under Runtime, Network, Page, and Log
instrumentation. The gate passes only when all of these are true:

- the main document is exactly `poker-training-pro://app/index.html`;
- the title is exactly `Poker Training Pro`;
- `#root` has at least one child and non-empty text;
- the isolated renderer contains one recognized first-run/title/start-menu text
  set: `First-time setup` plus `Save and continue`, `Press any key`, or `Play`
  plus `Settings`;
- no `Runtime.exceptionThrown`, `Network.loadingFailed`, console-error event,
  or error-level Log entry is observed.

The entire operation has a hard timeout. Success output contains only the
validated document summary, not the debugging port or temporary profile.

## Process and profile safety

The spawned PID is retained and Windows termination uses `taskkill /PID <pid>
/T /F`, so only that process tree is targeted. Cleanup refuses any directory
that is not a descendant of the operating-system temporary directory
with the `poker-training-pro-render-smoke-` prefix. The normal user profile,
saves, and any separately running copy of the app are outside the smoke scope.

The smoke is intentionally standalone for now. Add it to the release runner
only after package creation is ordered ahead of this gate.
