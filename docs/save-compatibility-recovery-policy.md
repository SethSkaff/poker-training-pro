# Save compatibility and recovery policy

Status: normative desktop v1 contract  
Owner: desktop persistence and release engineering  
Last grounded against the repository: 2026-07-23

This policy is the implementation contract for save reads, writes, upgrades,
rollbacks, and player-visible recovery. It refines the persistence states in
`docs/desktop-game-state-machine.md` and the `SAVE-*` / `RECOVERY-*` criteria in
`docs/desktop-v1-vertical-slice-gate.md`.

The words **must**, **must not**, **should**, and **may** are normative. A save is
not durable merely because the renderer updated its in-memory state or wrote
`localStorage`; durability requires a successful acknowledgement from the
authoritative file writer.

## Scope and terminology

The desktop save has two independently versioned layers:

1. The **journal record** is the checksummed disk container written below
   Electron's `userData/saves` directory. Desktop v1 uses
   `format: "poker-training-pro-autosave"` and `version: 1`.
2. The **payload envelope** is the JSON string inside the journal record.
   Desktop v1 uses `format: "poker-training-pro-save"` and `version: 1`.

`autosave.json` is the **current generation** and
`autosave.previous.json` is the **previous generation**. A generation is valid
only when all of these checks pass:

- the journal is readable and valid JSON;
- journal format, version, boundary, timestamp, payload, and checksum have the
  expected types and supported values;
- the SHA-256 checksum matches the exact payload bytes;
- the payload is valid JSON with the expected application format;
- the payload version is supported by this build and its complete migration
  chain succeeds;
- migrated data passes semantic validation, including session invariants and
  monotonic revision checks once live-session fields are added.

A structurally valid journal containing an unsupported payload version is not a
valid generation for that build.

## Compatibility guarantees

### Desktop v1 matrix

| Reader | Journal version | Payload version | Required behavior |
|---|---:|---:|---|
| Desktop v1 | 1 | 1 | Validate and load without migration. |
| Desktop v1 | 1 | 0 or unversioned legacy object | Migrate in memory to payload v1, validate, then commit v1 as a new generation only after player confirmation or successful startup import. |
| Desktop v1 | 1 | Greater than 1 | Return `unsupported-save-version`, preserve every byte, and offer Update/Cancel/Export Diagnostics. |
| Desktop v1 | Other | Any | Return `unsupported-journal-version`, preserve every byte, and offer Update/Cancel/Export Diagnostics. |
| Desktop v1 | Any | Foreign format | Return `unknown-format`, preserve every byte, and never import it as this game's progress. |

The current `src/lib/saveMigration.ts` implements payload v1 and legacy v0
migration. The current journal parser accepts journal v1. No other version is
implicitly compatible.

### Backward compatibility

- A new build must read every save version listed as supported in that release's
  compatibility matrix. Migration is ordered, explicit, and one direction:
  `vN -> vN+1 -> ... -> current`.
- Each migration must be deterministic and side-effect free. It must not write
  until the fully migrated result has passed schema and semantic validation.
- Unknown fields must not be silently destroyed by an older build. An older
  reader that cannot prove compatibility must stop with
  `unsupported-save-version`.
- Normalizing invalid leaf values is allowed only for fields whose defaults are
  explicitly safe. It must not invent or discard a live run, committed result,
  chips, Elo, unlock, attempt ID, or save revision.
- A successful migration write keeps the unmigrated generation recoverable as
  the previous or pre-update generation until the next separately confirmed
  durable save.

### Forward compatibility and update rollback

- No build may guess at a future journal or payload schema.
- If an older/rollback build sees a future version, it must enter a read-only
  recovery state. It must not rewrite, normalize, rotate, reset, or replace the
  future save.
- Before installing an update that can advance either schema, the updater must
  create and validate a non-rotating **pre-update generation** with the source
  app version, journal version, payload version, and checksum.
- A rollback is permitted only when the target build's published matrix says it
  can read the on-disk versions. Otherwise the launcher must retain the data and
  require a compatible/newer build.
- Merely restoring old program files is not permission to restore old player
  data. Replacing newer progress with a pre-update generation requires a
  player-visible preview and confirmation.
- Release verification must exercise upgrade and rollback in both installer and
  portable distributions and record the before/after versions and checksums.

## Authoritative read and recovery algorithm

Startup must use this order:

1. Probe the exact current and previous generation paths. Orphan temporary files
   are diagnostics only and are never load candidates.
2. Fully validate current, including payload migration and session semantics.
3. If current is invalid, fully validate previous.
4. If current is valid, use it. An invalid previous may be reported as a
   repairable warning but must not block play.
5. If current is invalid and previous is valid, enter Recovery with previous
   selected as the recommended restore. Do not silently conceal the current
   failure. Committing the restored payload creates a new current generation;
   the damaged file is archived first.
6. If neither file generation is valid, try an explicitly managed
   last-known-good/pre-update generation, newest first, without modifying any
   candidate.
7. Only if no authoritative file has ever committed, run the one-time browser
   storage import described below.
8. If any candidate exists but is unreadable, corrupt, foreign, or unsupported,
   enter Recovery. Defaults are forbidden.
9. Defaults are allowed only when the probe proves a genuine first run with no
   save/import evidence, or after the player confirms Start Fresh twice.

Within the same trust level, choose the highest successfully validated
monotonic save revision, not an untrusted wall-clock timestamp. A future
version never loses priority by being treated as corrupt; it blocks older
builds from writing until a compatible build or explicit player-directed
recovery is used.

## Non-destructive recovery behavior

Recovery must identify each attempted source and its stable failure code. It
must offer the applicable actions:

- **Restore Previous/Last Known Good** with a preview of player, progress,
  mode/session, revision, and save time;
- **Retry** for transient read or device failures;
- **Update App** for unsupported future versions;
- **Export Diagnostics**, redacted and excluding private cards, future deck, and
  production secrets;
- **Start Fresh**, behind a second confirmation explaining that existing data
  will be archived;
- **Cancel/Quit**, which leaves all save bytes unchanged.

Recovery must not delete a bad generation, rename it over a good generation,
clear browser keys, or start a default profile automatically. Start Fresh and a
confirmed restore first move displaced data to an archive name containing a
timestamp and checksum when readable. If archival fails, the destructive action
must stop.

The Recovery screen must not expose raw filesystem paths, private card data, or
arbitrary operating-system error text. Those details may appear only in a
redacted diagnostic export.

## Write transaction and failure handling

A file commit is successful only after this sequence:

1. Serialize a current payload envelope canonically and validate it in memory.
2. Create a journal record and checksum the exact serialized payload.
3. Write a uniquely named temporary file in the target directory.
4. Flush the temporary file's contents and close it.
5. Validate the temporary journal and payload by reading it back.
6. If current is fully valid, atomically replace previous with current. An
   invalid current must never replace a valid previous.
7. Atomically replace current with the validated temporary file.
8. Flush directory metadata where the platform supports it.
9. Read current back, revalidate it, and verify the expected monotonic revision
   and checksum.
10. Return a durable save receipt to the renderer.

An orphan temporary file means the replace did not complete. Startup ignores
it for play, records it for diagnostics, and continues with current/previous.
Cleanup may occur only after at least one authoritative generation validates.

On any write failure:

- do not return a save receipt;
- keep the in-memory state dirty and retryable;
- keep result navigation disabled if that result lacks a receipt;
- preserve current and previous generations;
- remove only the temporary file created by that attempted transaction, when
  safe;
- show Retry Save, Export Diagnostics, and safe Quit/Recovery choices;
- never rotate an invalid current into previous;
- never claim that progress was saved.

### Required failure mapping

| Condition | Stable code | Retryable | Required response |
|---|---|---:|---|
| Disk/device full (`ENOSPC`) | `disk-full` | Yes, after space is freed | Preserve generations and dirty state; explain how much space is needed when known. |
| User/filesystem quota (`EDQUOT`, browser `QuotaExceededError`) | `quota-exceeded` | Yes, after quota changes | Preserve data; authoritative desktop writes must not fall back to browser storage. |
| Access denied/read-only (`EACCES`, `EPERM`, `EROFS`, browser `SecurityError`) | `permission-denied` | Yes, after permission/location changes | Preserve data and offer Retry/Diagnostics/Quit. Do not request elevation silently. |
| Temporary or replace interruption | `write-interrupted` or mapped OS code | Usually | Ignore orphan temp on startup and load a validated named generation. |
| Checksum mismatch | `checksum-mismatch` | No for that generation | Reject that generation and evaluate the next recovery candidate. |
| Partial/malformed JSON | `invalid-json` | No for that generation | Reject that generation and evaluate the next recovery candidate. |
| Unsupported future payload | `unsupported-save-version` | No in this build | Preserve bytes and require a compatible/newer build. |
| Unsupported journal | `unsupported-journal-version` | No in this build | Preserve bytes and require a compatible/newer build. |
| Unknown I/O failure | `read-failed` or `write-failed` | Maybe | Preserve data, include sanitized system code in diagnostics, and allow Retry. |

Disk-full, permission, and quota failures are operational failures, not corrupt
saves. They must not trigger migration, normalization, rotation, or Start Fresh
automatically.

## Browser-storage one-time import

Browser storage is a legacy import source, never the authoritative desktop
store.

1. Probe file generations first. If any authoritative file version exists,
   including an unsupported future version, do not import browser data.
2. Import is eligible only when no file has ever committed. Read the current
   `poker-training-pro:settings` and `poker-training-pro:progress` keys, falling
   back to the older `poker-math-academy:*` keys only when their corresponding
   current key is absent.
3. Read all candidate values without modifying them. A storage access exception
   returns `storage-unavailable`; malformed existing data enters Recovery
   instead of becoming defaults.
4. Build the legacy v0 object, migrate through `migrateSavePayload`, validate,
   and show a concise import preview when progress exists.
5. Commit and read back the authoritative file. The committed payload records
   import completion/source metadata or a file-side marker does so atomically.
6. Only after verified file commit is browser import permanently disabled.
   File existence/import metadata is the authority; a browser marker alone is
   insufficient.
7. Leave legacy browser keys untouched by default so a failed import is
   retryable. Clearing them is a separate confirmed cleanup action.

If the file commit succeeds but browser cleanup or a compatibility marker write
hits a browser quota/permission error, the verified file remains authoritative
and the import must not run again. If the file commit fails, no import-complete
state is recorded.

## Testable API contract

Persistence APIs must resolve with a discriminated result for all expected
storage failures. They must not make the renderer parse exception strings.

```ts
type SaveSource =
  | "current"
  | "previous"
  | "last-known-good"
  | "pre-update"
  | "browser-import";

type SaveFailureCode =
  | "no-save"
  | "invalid-json"
  | "invalid-record"
  | "checksum-mismatch"
  | "invalid-payload"
  | "unknown-format"
  | "unsupported-journal-version"
  | "unsupported-save-version"
  | "read-failed"
  | "write-interrupted"
  | "disk-full"
  | "quota-exceeded"
  | "permission-denied"
  | "write-failed"
  | "storage-unavailable"
  | "no-valid-generation";

interface SaveFailure {
  code: SaveFailureCode;
  operation: "probe" | "read" | "migrate" | "write" | "verify" | "archive";
  message: string;
  retryable: boolean;
  source?: SaveSource;
  systemCode?: string;
}

type SaveResult<T> =
  | { ok: true; value: T; warnings?: SaveFailure[] }
  | { ok: false; error: SaveFailure; attempts?: SaveFailure[] };

interface DurableSaveReceipt {
  revision: number;
  boundary: "settings" | "action" | "hand" | "result" | "lifecycle";
  savedAt: string;
  checksum: string;
  journalVersion: number;
  payloadVersion: number;
}
```

Contracts:

- expected corruption and I/O failures resolve to `SaveResult`; programmer
  errors such as an invalid IPC argument may reject/throw;
- every failed generation appears once in `attempts`, in evaluation order;
- `no-save` means no candidate exists and is distinct from
  `no-valid-generation`;
- `systemCode` is an allow-listed value such as `ENOSPC`, never a raw path or
  stack trace;
- a successful fallback reports failed higher-priority candidates in
  `warnings`;
- a commit returns its receipt only after read-back verification;
- the UI binds progress/result transitions to the exact receipt revision.

## Verification requirements

Automated fault tests must cover:

- current, legacy v0, foreign, and future payloads;
- unsupported journal versions;
- corrupt JSON and checksum mismatch in each generation;
- valid-current rotation and corrupt-current non-rotation;
- orphan/partial temporary files;
- disk-full, quota, permission-denied, read, rename, flush, and read-back
  failures through injected filesystem/storage adapters;
- preservation of the only valid generation after every failed step;
- one-time browser import success, retry after failure, corrupted import data,
  and no re-import after a verified file commit;
- rollback with compatible and incompatible payload versions;
- duplicate revision rejection and result/progress idempotency.

Packaged Windows tests must additionally force termination before and after
replace, exercise installer/portable upgrade and rollback, and prove recovery
without `localStorage`.

## Current implementation mapping and gaps

Grounded on 2026-07-23:

| Requirement | Current implementation | Status |
|---|---|---|
| Payload v1 plus legacy v0 migration | `src/lib/saveMigration.ts` | Implemented and unit-tested. |
| Future payload rejection | `migrateSavePayload` returns `unsupported-version` | Implemented at migration layer; code/name does not yet match the target IPC contract. |
| Deterministic last-known-good serialization | `serializeSaveBackup` and browser-storage helpers | Implemented as a utility, not authoritative production recovery. |
| Checksummed current/previous journal | `electron/save-store.cjs` | Implemented and unit-tested. |
| Temporary write, file flush, atomic replace | `atomicReplace` | Implemented; no temporary read-back or directory flush. |
| Corrupt-current non-rotation | `writeAutosaveGeneration` | Implemented. |
| Current-to-previous fallback | `loadAutosaveGeneration` | Implemented at store layer with generation errors. |
| Full payload migration during journal load | Journal validates only broad envelope shape | Missing. |
| Structured disk-full/permission/quota results | Filesystem errors throw through IPC; browser helper collapses failures to `storage-unavailable` | Missing. |
| Renderer startup/write integration | Preload APIs exist but have no renderer caller | Missing. |
| File authority and one-time browser import | Production still reads/writes `localStorage` | Missing. |
| Recovery/resume UI | No production route | Missing. |
| Monotonic revision and durable receipt | Not in current payload/journal contract | Missing. |
| Pre-update generation and rollback guard | No implementation | Missing. |
| Archive/diagnostic export and confirmed fresh start | No implementation | Missing. |
| Fault injection for write-step failures | Filesystem calls are closed over directly | Missing test seam. |

This document satisfies the policy-definition requirement. It does not claim
that durable save/recovery implementation or the desktop vertical-slice gate is
complete.
