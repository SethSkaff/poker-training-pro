# Support-response procedure

Status: **draft — not operational**  
Applies to: Poker Training Pro desktop releases  
Last reviewed: 2026-07-23

There is no public support contact, named support owner, ticket system, or
approved response SLA. Public distribution is blocked until those fields are
assigned. This procedure defines safe handling, but it does not promise that a
message sent today will be received or answered.

## Required operational assignments

| Field | Current value | Public-release requirement |
|---|---|---|
| Legal publisher | Unassigned | Record the certificate/store identity. |
| Release owner | Unassigned | Name the person authorized to freeze, publish, halt, and roll back. |
| Support owner | Unassigned | Name the accountable person/team and backup. |
| Support contact/channel | Unassigned | Publish a monitored publisher-controlled HTTPS page and contact route. |
| Ticket/data system | Unassigned | Review access, retention, deletion, breach handling, and third parties before use. |
| Response SLA | No SLA approved | Publish only a capacity-backed commitment with coverage hours and severity definitions. |
| Security-reporting route | Unassigned | Publish a monitored private route before accepting vulnerability reports. |

Do not replace an unassigned field with a developer's personal address, an
unmonitored form, a guessed company name, or an aspirational response time.

## Intake

When an operational channel exists, the intake form should request only:

- application version/build identifier and installer or portable lane;
- Windows edition, feature release, CPU architecture, and whether the system
  meets the published support matrix;
- category: install/update, launch/crash, save/recovery, gameplay/rules,
  accessibility, privacy/security, or license/credit;
- concise reproduction steps, expected behavior, and actual behavior;
- whether the player can still launch, play, export diagnostics, and access a
  previous valid save.

Diagnostics are optional and player-initiated. Ask the player to review the
redacted export before sharing it. Do not request hole cards from opponents,
future-deck state, passwords, authentication tokens, unrelated files, full
home-directory paths, or a raw copy of the user-data directory.

## Triage and response

1. Acknowledge only through the approved support system. Do not state an SLA
   until one is formally approved.
2. Assign a stable ticket ID and record app/build, environment, impact,
   reproducibility, and whether data is at risk.
3. Check [known issues](release-known-issues.md), the
   [save matrix](save-compatibility-matrix.md), and exact release notes before
   suggesting a workaround.
4. Prefer reversible steps: stop repeated writes, export diagnostics/save,
   relaunch, use in-app recovery, or use a documented compatible build.
5. Never direct a player to delete, overwrite, or hand-edit their only save.
   Never claim a rollback is safe unless the matrix explicitly allows it.
6. Escalate suspected security/privacy exposure, widespread startup failure,
   save loss/corruption, signature failure, or rights complaint immediately to
   the named release owner and the responsible specialist once assigned.
7. Record the resolution, exact build affected, workaround safety, evidence,
   and whether release documentation or a product test must change.

## Release halt and incident criteria

The named release owner must be able to halt or withdraw a release for:

- invalid/missing signature or unexpected publisher identity;
- executable/hash mismatch after upload;
- credible code-execution, sandbox-escape, privacy, or supply-chain issue;
- widespread launch failure on a claimed platform;
- reproducible progress loss, destructive migration, or rollback overwrite;
- an unresolved claim that shipped art, audio, font, code, or branding lacks
  distribution rights.

Until an owner and authenticated release host exist, there is no operational
withdrawal mechanism; that absence is itself blocker `PTP-001`.

## Data handling and closure

- Keep only data required by the approved support process and privacy policy.
  Retention and deletion periods must be approved before the ticket system
  accepts player data.
- Remote crash upload remains off by default; support intake must not silently
  enable it.
- Close a report only with a documented outcome: fixed in a named build,
  duplicate, expected/documented, unable to reproduce with requested evidence,
  or unsupported environment.
- A fix is not “shipped” until the signed artifact and release note are public
  and independently verified.

Related policies: [desktop privacy](privacy-policy.md),
[Windows distribution and support](windows-distribution-and-support.md), and
[end of support](end-of-support-policy.md).
