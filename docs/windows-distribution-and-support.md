# Windows distribution and support decision

Status: technical lane selected; public release remains blocked on publisher
identity, signing credentials, clean-machine evidence, and a release owner.

Last reviewed: 2026-07-23

## Shipping lane

Poker Training Pro v1 will use a **direct, x64, assisted NSIS installer** built
with electron-builder. It is the only public Windows artifact planned for v1.

- Installation is per-user by default and must not require administrator access.
- The assisted installer keeps the current explicit install-location choice.
- The current portable executable is a private preview/diagnostic artifact, not
  a separately supported public distribution channel.
- Microsoft Store/MSIX and Steam are deferred. Adding either is a new release
  lane with its own identity, fees, review, update, and test matrix.
- A web installer is not allowed because the game promises a complete offline
  runtime and the full package size is within the documented installer budget.

electron-builder documents NSIS as the common consumer-app target and supports
assisted installers with `oneClick: false`. The repository already uses that
setting.

## Supported operating systems and CPUs

The intended v1 support claim is:

> 64-bit Poker Training Pro for x64 editions of Microsoft-supported Windows 11.

The release candidate must be tested on every Windows 11 feature release still
supported by Microsoft on the freeze date. As of this review, the relevant Home
and Pro releases are 24H2, 25H2, and 26H1; 24H2 retires on 2026-10-13. Recheck
Microsoft's lifecycle page at release freeze and remove any retired version
from the claim and test matrix.

Not supported or not yet claimed:

- Windows 10, whose ordinary support ended on 2025-10-14. An ESU-enrolled
  machine is not part of the v1 consumer support promise.
- 32-bit Windows. Electron has announced removal of Windows ia32 prebuilts in
  Electron 44 and later, and this project intends to follow supported Electron
  releases.
- Windows on ARM. No arm64 package, native-device test evidence, performance
  evidence, or installer test exists yet. x64 emulation is not a substitute for
  an arm64 support claim.
- Windows Server, Windows IoT, Wine/Proton, virtualized GPUs, or unsupported
  Windows 11 feature releases.

The package command and CI must explicitly select x64 before the first release;
building on an x64 runner by accident is not a support declaration.

## Signing decision

Every public installer and executable must be Authenticode signed and
timestamped. CI must set electron-builder's `forceCodeSigning: true` for the
public-release job so missing credentials cannot silently produce an unsigned
artifact.

Preferred credential lane: **Azure Trusted Signing**, if the final publisher is
eligible. Fallback: a CI-compatible OV Authenticode certificate from a trusted
certificate authority. The final choice cannot be made until the publisher's
legal identity and account eligibility are known.

Secrets belong only in protected CI/release-secret storage. Certificate files,
passwords, tenant IDs, client secrets, and signing tokens must never enter the
repository or release archive. After upload, CI must independently verify the
signature, timestamp, publisher subject, and file hash of the exact public
artifact.

Unsigned builds may be labeled and shared only as private development previews.
Electron recommends signing distributed apps to avoid operating-system security
warnings.

## Update and rollback channel

V1 has no silent or mandatory network update check. Until a signed updater is
implemented and separately reviewed, updates are **user-initiated full
installer replacements** downloaded from the publisher's final HTTPS release
page.

Release storage must retain:

- the current signed installer;
- at least one previous supported signed installer;
- SHA-256 hashes and signing-verification output for both;
- release notes and save-compatibility status;
- the previous engine/content version needed to interpret a rollback.

Rollback is an explicit user/support action. Before replacing the app, the
installed version must take a safe save and preserve its previous valid save
generation. A rollback may open a save only when the documented compatibility
policy allows it; otherwise it must offer export/recovery rather than silently
rewriting future-version data.

If an in-app updater is added later, it must use signed packages and HTTPS
metadata, verify the expected publisher, prevent unapproved downgrade, support
staged rollout/rollback, and offer Restart Now/Later. That future implementation
must not change the offline-play promise.

## Ownership and costs that still block public release

The following fields require the user's/publisher's business decision and must
be recorded in the release checklist before signing is enabled:

| Field | Required decision |
|---|---|
| Legal publisher | Human or organization name that will own the certificate and appear in signatures/installer metadata |
| Release owner | Named person accountable for freeze, signing, upload, rollback, and support handoff |
| Signing service | Azure Trusted Signing eligibility/account/profile, or selected OV certificate authority |
| Signing budget | Current setup/identity-validation/subscription or certificate cost; re-quote from the selected vendor |
| HTTPS release host | Final owned download, privacy, and support domains plus recurring hosting/domain cost |
| Support owner | Named person/team and response channel for install, update, and data-recovery issues |

No dollar amount is hard-coded because vendor pricing and publisher eligibility
are not established. “Free” must not be entered as a placeholder.

## Release evidence still required

- Explicit x64 package configuration and a successful signed CI build.
- Clean Windows 11 virtual-machine tests for every supported feature release:
  install without admin, launch offline, upgrade, interrupted install/update,
  reinstall, rollback, uninstall, shortcuts, uninstall entry, and save
  preservation/removal choices.
- Signature/timestamp/publisher verification after the artifact is uploaded.
- Installed-build fuse/ASAR tamper rejection and representative no-network play.
- Final publisher/product/version/uninstall metadata inspection.
- Final hashes, retained rollback artifact, and signed go/no-go checklist.

## Primary references

- [Windows 11 Home and Pro lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)
- [Windows 10 end of support](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support)
- [Electron breaking changes: Windows ia32 removal](https://www.electronjs.org/docs/latest/breaking-changes)
- [Electron code-signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder NSIS target](https://www.electron.build/nsis/)
- [electron-builder Windows code signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)
