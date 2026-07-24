# Replay export boundaries

Poker Training Pro has two deliberately separate replay artifacts.

## Player-safe bug-report replay

The public export is assembled in Electron from an allowlist. It includes
engine/content/policy versions, tournament structure, ratings, and the ordered
hero action inputs needed to describe the issue. It does not include the
deterministic seed, absolute action timestamps, player name or identifier,
filesystem paths, comments, unknown fields, decks, or any hole-card/private
state. The renderer cannot choose or learn the destination path; Electron uses
the operating-system JSON save picker and returns only the final filename.

## Deterministic developer replay

The developer artifact retains the validated seed, replay timestamps, and
canonical replay inputs needed for deterministic engineering reproduction.
It is therefore privileged. Export is enabled only when all of these are true:

1. Electron is not packaged.
2. the process is not running with `NODE_ENV=production`;
3. `POKER_TRAINING_PRO_DEVELOPER_REPLAY_EXPORT=1` was explicitly present when
   the main process started.

The main-process check is authoritative. The developer IPC remains denied when
called from a packaged or production build, regardless of renderer behavior.

Both artifacts are schema-validated, capped at 2 MiB, serialized with stable
key order, and written through a same-directory temporary file plus atomic
rename. Cancellation and filesystem failures return stable redacted codes; log
events contain only artifact kind/outcome/error code, never replay contents or
paths.
