# Release-operations index

Status: v0.1.0 pre-release baseline  
Last reviewed: 2026-07-23

This page is the navigation and ownership checklist for release documentation.
It does not override the status written in each linked document.

## Player and support operations

- [Changelog](../CHANGELOG.md) — player-visible and operational changes by
  version.
- [Known issues](release-known-issues.md) — open public-release blockers and
  preview limitations.
- [Per-release save compatibility matrix](save-compatibility-matrix.md) —
  reader/writer/update/rollback promises for each version.
- [Normative save compatibility and recovery policy](save-compatibility-recovery-policy.md)
  — implementation and failure-handling contract.
- [Support-response procedure](support-response-procedure.md) — safe intake,
  triage, escalation, and closure; currently not operational.
- [End-of-support policy](end-of-support-policy.md) — lifecycle states and
  notice requirements; no version is presently supported.
- [Desktop privacy policy](privacy-policy.md) — current local/offline data
  behavior; stable HTTPS publication and support contact remain blocked.
- [Windows distribution and support decision](windows-distribution-and-support.md)
  — intended public lane and intended support matrix.

## Notices, assets, and credits

- [Deterministic npm package notice inventory](../THIRD-PARTY-NOTICES.packages.md)
  — exact package/version declarations.
- [Shipped runtime npm notice artifact](../THIRD-PARTY-NOTICES.runtime.txt) and
  [packaging/audit policy](runtime-package-notices.md) — actual upstream text
  for selected shipped npm identities plus the external Windows sidecar
  locations and fail-closed post-package audit.
- [Generated third-party dependency and asset audit](../work/third-party-audit.md)
  — deterministic inventory and unresolved provenance fields; it is evidence,
  not legal approval.
- [Machine-readable asset rights ledger](../config/asset-rights-ledger.json) and
  [asset rights release policy](asset-rights-release-policy.md) — exact visual,
  icon, and imported-font byte inventory; visual rights remain blocked while
  the two imported font families have exact OFL evidence.
- [Package-license release policy](package-license-release-policy.md) —
  package declaration gate and remaining notice obligations.
- [Audio candidate and license research](audio/playlist-license-research.md) —
  conditional candidates; zero tracks are release-approved.

There is no approved consolidated asset/audio Credits file yet. Do not create
one by copying candidate names or unknown provenance into an “approved” list.
The final credits must be generated from the release-approved rights ledger and
cross-linked here.

## Per-version maintenance

Before a public version is frozen, the named release owner must:

1. update every document on this page for the exact candidate;
2. replace placeholder/unassigned ownership, contact, and HTTPS fields;
3. attach clean-machine, signature, save, offline-play, accessibility, and
   rights evidence;
4. archive exact package notices, required upstream texts, asset/audio credits,
   SBOM, hashes, and rollback artifact;
5. run the deterministic release-document validator;
6. sign the go/no-go checklist.

The current public-release verdict is **blocked** by
[`PTP-001` through `PTP-010`](release-known-issues.md).
