# Runtime npm package notices

`THIRD-PARTY-NOTICES.runtime.txt` contains the actual upstream root
license/NOTICE texts for every npm identity selected as shipped:

- every non-development entry in `package-lock.json`;
- exact additional runtime packages named in
  `config/runtime-package-notice-policy.json`.

Electron is an explicit additional package because its locked runtime is copied
into desktop builds even though npm records it as a development dependency.
Nested build/download dependencies are not selected merely because they helped
produce the app.

## Exact evidence

`config/runtime-package-notice-evidence.json` freezes package name/version, lock
paths, declared-license sources, every installed manifest hash, and every
discovered root `LICENSE`, `LICENCE`, `NOTICE`, `COPYING`, or `COPYRIGHT` file
at every selected lock path with raw byte length and SHA-256. The assembler
rejects:

- missing, duplicate, extra, or stale package identities;
- wrong installed manifest name/version or changed manifest bytes;
- a changed declared license;
- missing, added, omitted, changed, or non-UTF-8 upstream texts;
- path traversal and configured package/text/artifact size violations.

The artifact repeats license text for distinct packages and duplicate installed
paths rather than silently deduplicating or collapsing their notices. Package
and source ordering is stable and line endings are normalized to LF; evidence
hashes always refer to raw upstream bytes.

Refresh evidence only after reviewing a deliberate dependency change:

```powershell
node scripts/refresh-runtime-package-notice-evidence.mjs `
  --acknowledge-exact-installed-texts
node scripts/generate-runtime-package-notices.mjs
node scripts/verify-runtime-package-notices.mjs
node scripts/test-runtime-package-notices.mjs
```

## Separate obligations and release blockers

This npm artifact covers the two shipped `@fontsource` packages and their exact
OFL texts. It does not establish rights for any font introduced outside those
packages.

Electron's binary distribution also carries `LICENSE.electron.txt` and the
large `LICENSES.chromium.html` sidecar. The Windows packaging gate must continue
to verify both sidecars; duplicating the Chromium HTML inside this npm text
bundle would not replace that obligation.

Electron Builder copies `THIRD-PARTY-NOTICES.runtime.txt` outside `app.asar` to
`resources/THIRD-PARTY-NOTICES.runtime.txt`. The same unpacked payload is the
input to the Windows NSIS installer and private portable preview target. This
makes the text a regular packaged file; it does not claim that an in-app
Credits/notices surface exists.

After producing a fresh Windows package, verify the exact external files:

```powershell
npm run package:win
```

`package:win` ends by running `release:audit-packaged-licenses`. To inspect an
already unpacked candidate at another location:

```powershell
npm run release:audit-packaged-licenses -- `
  --package-root "D:\staging\Poker Training Pro"
```

The audit checks these documented locations byte-for-byte against generated or
pinned source evidence:

- `resources/THIRD-PARTY-NOTICES.runtime.txt`;
- `LICENSE.electron.txt`;
- `LICENSES.chromium.html`.

It rejects missing, stale, tampered, wrong-version, non-regular, path-escaping,
or size-bound-violating sidecars. Run its source-only negative tests with
`npm run release:test-packaged-licenses`.

Images, generated art, non-npm fonts, music masters, sound recordings, and
other public assets remain governed by the asset-rights and audio evidence
gates. This package artifact does not approve them or remove their manual
provenance/redistribution blockers.
