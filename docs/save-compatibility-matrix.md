# Per-release save compatibility matrix

Status: pre-release operational snapshot  
Application version: `0.1.0` (unreleased)  
Journal format: `poker-training-pro-autosave`, version `1`  
Payload format: `poker-training-pro-save`, version `1`  
Last reviewed: 2026-07-23

The normative rules and failure handling live in the
[save compatibility and recovery policy](save-compatibility-recovery-policy.md).
This shorter matrix records what each released application build actually
promises. It must be updated before every public version.

## Reader matrix

| App reader | Journal | Payload | Read | Write | Required behavior |
|---|---:|---:|---|---|---|
| `0.1.0` | 1 | 1 | Supported by contract | Writes v1 after full validation | Validate and load without payload migration. |
| `0.1.0` | 1 | 0 or unversioned legacy local object | Migration path defined | Writes v1 only after complete migration and validation | Preserve source until the authoritative v1 commit is verified. |
| `0.1.0` | 1 | Greater than 1 | Not supported | Forbidden | Preserve every byte; enter read-only recovery; offer update/cancel/diagnostics. |
| `0.1.0` | Other | Any | Not supported | Forbidden | Preserve every byte; report unsupported journal version. |
| `0.1.0` | Any | Foreign format | Not supported | Forbidden | Reject as unknown format; never import it as Poker Training Pro progress. |

“Supported by contract” is not packaged-release evidence. Open blocker
[`PTP-008`](release-known-issues.md) records the missing process-restart and
fault-matrix proof.

## Distribution and rollback matrix

| From | To | Program-file operation | Save behavior | Current release status |
|---|---|---|---|---|
| No installation | `0.1.0` | Clean install | Create v1 only after the first durable save boundary. | Not clean-machine verified. |
| Legacy browser-only preview | `0.1.0` | One-time import | File generations take precedence; validate/migrate first; mark import complete only after verified file commit. | Implementation/evidence remains covered by `PTP-008`. |
| `0.1.0` | newer build | Full-installer update | New reader must publish its own matrix and retain a validated pre-update generation before advancing either schema. | No newer version exists. |
| newer build | `0.1.0` | Rollback | Allowed only if this matrix explicitly supports the on-disk journal and payload. Future versions are read-only and must not be rewritten. | Not tested; no rollback release artifact exists. |
| `0.1.0` installer | `0.1.0` reinstall | Same-version reinstall | Preserve valid progress unless the player separately confirms deletion. | Not clean-machine verified. |
| `0.1.0` | uninstall | Remove program files | Player data is preserved by the current installer setting; deletion must be a separate explicit choice. | Uninstall behavior is not clean-machine verified. |

## Compatibility sign-off required for each public version

- Record application, journal, payload, engine, content, and policy versions.
- Exercise every supported source-to-reader pair and retain checksums before
  and after migration.
- Prove unsupported future/foreign versions remain byte-for-byte unchanged.
- Prove disk-full, permission, interrupted write, corrupt current, and corrupt
  previous handling never replaces the only valid generation.
- Test installer and portable behavior separately if both are distributed.
- Link the exact release and rollback artifacts plus evidence from the
  [release-operations index](release-operations-index.md).

No compatibility claim extends beyond the rows above.
