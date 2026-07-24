# Package license release policy

This policy covers npm packages locked by `package-lock.json`. It does not
establish ownership or redistribution rights for images, audio, or other
non-package assets.

## Automated gate

Run:

```powershell
node scripts/generate-third-party-audit.mjs
```

The command fails closed when:

- a locked package has no declared license;
- a declaration is nonstandard, malformed, or not explicitly allowlisted in
  `config/package-license-policy.json`;
- exact-version registry evidence is missing or identity-mismatched for an
  optional/platform package absent from the current installation;
- the evidence catalog contains a duplicate or stale override; or
- a direct dependency is not uniquely represented by the lockfile.

`config/package-license-catalog.json` is a checked-in evidence snapshot. Each
entry records the exact package name and version, normalized declaration, npm
registry version URL, raw evidence field/value, repository metadata, and
tarball URL. Refresh it deliberately with
`node scripts/refresh-package-license-catalog.mjs` after a lockfile change,
review the diff, and then rerun the gate.

The generator writes:

- `work/third-party-audit.md`, the full locked-path and asset audit; and
- `THIRD-PARTY-NOTICES.packages.md`, a deterministic package/version inventory
  suitable as the package section of release notices.

## What allowlisting does and does not mean

An allowlisted declaration records that commercial redistribution is permitted
under the declared license's conditions. It is not legal advice, proof that the
publisher owned every contribution, or a substitute for reading the actual
license and notice files.

Before a public build, the release owner must assemble and retain the applicable
upstream license/copyright texts. Common obligations in the current lock include:

- retaining copyright, permission, warranty, and disclaimer text for
  MIT/ISC/BSD/0BSD/BlueOak/WTFPL packages as applicable;
- retaining Apache 2.0 license and NOTICE material, and marking modified files
  where required;
- satisfying MPL 2.0 file-level source and notice obligations for any covered
  files that are distributed or modified;
- retaining OFL notices and observing Reserved Font Name rules for bundled
  fonts;
- retaining Python 2.0 notices and applicable change summaries; and
- honoring the selected branch of every dual-license expression.

The generated SPDX inventory alone does not satisfy those text/notice
obligations. `THIRD-PARTY-NOTICES.runtime.txt` separately assembles actual
upstream text for the selected shipped runtime identities. Its evidence,
generation, external Electron Builder location, and fail-closed unpacked-package
audit are documented in
[`runtime-package-notices.md`](runtime-package-notices.md). That artifact does
not approve images, audio, generated art, or other non-npm assets, and it does
not establish an in-app Credits surface.
