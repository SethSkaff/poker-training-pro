# End-of-support policy

Status: **baseline policy; not yet activated**  
Last reviewed: 2026-07-23

Poker Training Pro has no public release and no assigned publisher, release
owner, support owner, support channel, or response SLA. Therefore **no public
version is currently in a supported lifecycle** and no end-of-support date is
announced. This document defines the decision and communication requirements
that must exist before support is advertised.

In plain terms: no public version is currently in a supported lifecycle.

## Scope

A lifecycle record applies to one named application version and distribution
lane. Supporting a Windows installer does not automatically support a portable
preview, a macOS build, Windows on ARM, Windows 10, or another storefront.

An operating system leaving Microsoft's support does not silently rewrite a
published Poker Training Pro lifecycle record. The release owner must update
the support matrix and lifecycle notice explicitly.

## Lifecycle states

| State | Meaning |
|---|---|
| Development preview | No public support promise. Artifacts must be labeled private/preview and may be withdrawn without an end-user update mechanism. |
| Supported | The exact signed build, environment matrix, support route, owners, and response policy are published. |
| Security-only | Only critical security/privacy, signature/supply-chain, and destructive save issues are eligible for fixes; this state and its scope must be announced. |
| End of support | No fixes or compatibility assistance are promised after the recorded effective date. Existing offline functionality is not remotely disabled. |
| Withdrawn | Distribution is removed because continued availability is unsafe or legally impermissible; the reason and safe player-data guidance are published when lawful. |

## Before any version becomes supported

The release owner must record:

- version, build identifier, hashes, signature identity, and distribution lane;
- supported Windows editions/feature releases and architecture;
- support owner, monitored contact, coverage model, and approved response SLA;
- support-start date, review date, and either an end date or the exact rule and
  notice process by which one will be chosen;
- save compatibility with the next and retained rollback builds;
- publisher-controlled HTTPS locations for releases, privacy, support,
  lifecycle notices, and notices/credits.

No field may be inferred from `package.json`, a development build, or a TODO.

## Ending or narrowing support

Only the named release owner may approve a lifecycle change. Before the
effective date, the owner must:

1. publish the affected versions, lanes, platforms, reason, decision date, and
   effective date at the stable support URL;
2. state whether a supported upgrade exists, its exact save compatibility, and
   how to verify its signature and hash;
3. provide non-destructive export/recovery guidance and retain required
   privacy/license notices;
4. update the [known issues](release-known-issues.md),
   [save matrix](save-compatibility-matrix.md), [changelog](../CHANGELOG.md),
   and support procedure together;
5. retain the lifecycle notice after the date so offline users can determine
   the status of an installed build.

No minimum notice interval is promised yet. A public release is blocked until
the publisher chooses and staffs one. Emergency withdrawal may need immediate
effect for signature compromise, active exploitation, destructive save
behavior, privacy exposure, or a substantiated rights claim; the owner must
still publish the safest available explanation and data-preservation steps.

## Behavior after end of support

- The app must not erase local progress, force an account, or require an online
  check merely because support ended.
- Support may point to archived documentation and a compatible supported
  upgrade, but must not promise fixes or unsafe rollback.
- Public keys, hashes, privacy terms applicable to retained reports, source or
  attribution obligations, and save-format documentation needed for recovery
  remain available for as long as the publisher distributes or retains the
  affected artifacts.
- If the publisher ceases operation, a separately approved continuity plan is
  required; this document does not invent a successor or escrow arrangement.

## Current lifecycle register

| Version | Lane | State | Support start | End of support | Owner |
|---|---|---|---|---|---|
| `0.1.0` | Windows x64 development artifacts | Development preview | Not started | Not scheduled | Unassigned |

The register must gain an evidence-backed row for every public version and must
never silently delete older rows.
