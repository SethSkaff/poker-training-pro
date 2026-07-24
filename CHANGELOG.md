# Changelog

This file records player-visible and release-operational changes to Poker
Training Pro. The project follows [Keep a Changelog](https://keepachangelog.com/)
structure and intends to use semantic versioning after its first public
release.

## [Unreleased]

### Added

- A release-operations baseline covering known issues, save compatibility,
  support handling, and end-of-support decisions.

### Changed

- Nothing recorded.

### Fixed

- Nothing recorded.

### Security

- Nothing recorded.

## [0.1.0] - Unreleased

Status: development preview; **not a public release**.

### Added

- Four local play modes: Normal, Rational, Training, and Timed Table.
- A Windows-first Electron desktop application with local progress and
  settings.
- Deterministic poker engines, poker-math scenario grading, bot policies, and
  tournament progression.
- Offline-by-design runtime, a restrictive packaged content security policy,
  dependency verification, deterministic SBOM generation, and local redacted
  diagnostics.

### Known limitations

- Public distribution is blocked. The exact release blockers and present
  product limitations are maintained in
  [Known issues](docs/release-known-issues.md).
- No code-signed, clean-machine-tested public installer exists.

### Operations

- See the [release-operations index](docs/release-operations-index.md) for the
  authoritative status of support, saves, notices, credits, and end of support.

Comparison and release links are intentionally omitted. The release owner must
add the final publisher-controlled HTTPS URLs before public distribution.
