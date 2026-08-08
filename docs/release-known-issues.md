# Poker Training Pro v0.1.0 known issues

Status: **pre-release blocker register**  
Version: `0.1.0` (unreleased development preview)  
Last reviewed: 2026-07-23

This is not a claim that unlisted behavior is tested or production-ready.
Issues stay open until the release owner attaches the evidence named in the
exit condition. `Release-blocking` means v0.1.0 must not be distributed
publicly while the issue is open.

## Release blockers

| ID | Severity | Status | Summary | Exit evidence |
|---|---|---|---|---|
| `PTP-001` | Release-blocking | Open | Legal publisher, named release owner, named support owner, support contact, signing service, signing budget, and publisher-controlled HTTPS release/privacy/support locations are unassigned. The current unsigned preview executable inherits the incorrect placeholder `CompanyName` value `GitHub, Inc.`. | Every field is assigned in a signed go/no-go record; the frozen binaries contain the approved publisher/company metadata; public URLs resolve to the approved content. |
| `PTP-002` | Release-blocking | Open | Windows artifacts are not production Authenticode-signed or timestamped. | The exact uploaded installer and executable pass independent signature, timestamp, publisher-subject, and SHA-256 verification. |
| `PTP-003` | Release-blocking | Open | The intended Windows 11 x64 support matrix has not been tested on clean machines for every Microsoft-supported feature release at freeze. | Clean-machine install, launch, offline play, upgrade, rollback, reinstall, and uninstall evidence exists for every claimed release. |
| `PTP-004` | Release-blocking | Open | Visual, audio, and other asset provenance and commercial redistribution rights are not complete. The supplied start-menu image is included. Font binaries now have exact OFL evidence, but their final packaged notice presence still requires release-candidate verification. | The approved rights ledger identifies each exact shipped byte, source, creator, license/permission, platform scope, required credit, evidence archive, and reviewer approval; the candidate contains every required font notice. |
| `PTP-005` | Release-blocking | Open | The npm declaration inventory is gated, but the complete upstream copyright, license, and NOTICE texts required for redistribution have not been assembled and verified. | A reviewer validates the exact shipped notices bundle against every locked/shipped package and applicable obligation. |
| `PTP-006` | Release-blocking | Open | Representative packaged, ordinary offline play has not completed a deny-proxy audit in all four modes. | The same frozen candidate completes ordinary journeys in Normal, Rational, Training, and Timed Table with zero endpoint attempts. |
| `PTP-007` | Release-blocking | Open | The desktop accessibility, input, window-lifecycle, visual-resolution, pause/resume, and clean-machine acceptance matrices are incomplete. | All required matrices pass against the same frozen candidate with evidence attached. |
| `PTP-008` | Release-blocking | Open | Durable save integration and crash-safe action/hand-boundary autosave have not yet satisfied the complete packaged recovery matrix. | Installer and portable process-restart tests prove save, recovery, migration, corruption handling, and no duplicate awards at every required boundary. |
| `PTP-009` | Release-blocking | Open | The final simulated-poker age rating, play-chip-only metadata, store disclosures, and public-facing release materials are not approved. | Final game copy and every store/press field are reviewed together and the applicable rating questionnaire is complete. |
| `PTP-010` | Release-blocking | Open | No frozen release candidate, retained rollback artifact, final artifact hashes, or signed go/no-go decision exists. | One immutable candidate passes the full release gate; its rollback build and hashes are retained; authorized owners sign go/no-go. |

## Present product limitations

| ID | Severity | Status | Summary | Player/support handling |
|---|---|---|---|---|
| `PTP-101` | Preview limitation | Open | The portable artifact is a private preview/diagnostic lane, not a supported public distribution. | Do not publish or describe it as supported. Use only with explicit preview labeling. |
| `PTP-102` | Preview limitation | Open | Windows 10, Windows on ARM, 32-bit Windows, Windows Server, Wine/Proton, and unsupported Windows 11 releases are not claimed. | Do not promise a workaround or support claim. Record environment details and route any scope change through release review. |
| `PTP-103` | Preview limitation | Open | No automatic or mandatory update mechanism is implemented. | A future public v1 would use a user-initiated, signed full-installer replacement until a separately reviewed signed updater exists. |
| `PTP-104` | Preview limitation | Open | No soundtrack master is release-approved; the temporary synthesized background loop is muted. | Do not add a candidate track to a package until its exact master and rights evidence pass the audio checklist. |

## Maintenance rules

- Add an issue before shipping a discovered release-impacting limitation.
- Never close an issue because a source change merely appears correct; attach
  the named artifact, test, review, or approval.
- If a known issue affects save compatibility, also update the
  [per-release save matrix](save-compatibility-matrix.md).
- If a limitation changes the support promise, also update the
  [support-response procedure](support-response-procedure.md) and
  [end-of-support policy](end-of-support-policy.md).
- Closed issues remain in this file or move to the matching
  [changelog](../CHANGELOG.md) entry; they are not silently deleted.
