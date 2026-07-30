# Desktop 3D authored table assets

How the table, the playing card, and the casino chip are modelled, how they get
into the bundle, and which composition numbers moved when they did.

This supersedes nothing in
[the composition reset decision](./desktop-3d-composition-decision.md); that
document records why the `open-arc` model was abandoned. This one records the
state after `seated-ring-v3`, where the hero sits at an ordinary player seat.

## The pipeline

    tools/blender/build_table.py        authoring, run in Blender headless
      -> src/assets/table.glb           the authored master, in the rights ledger
        -> tools/glb-to-geometry.mjs    offline compile
          -> src/scene3d/generated/tableGeometry.ts
            -> src/scene3d/tableGeometryLibrary.ts   three.js BufferGeometry

Regenerate with:

    npm run assets:build-table          # needs `blender` on PATH

The script is checked in, takes no external input, and derives every dimension
from `src/scene3d/tableStations.ts` — the same constants the composition solver
and its tests use. A hand-modelled table would drift from the seat ring the
moment a station angle or the rail width changed.

### Why the .glb is compiled rather than loaded

The scene is built synchronously on the first frame. A fetched asset is not, so
loading the .glb at runtime would mean two paths through the renderer — a
placeholder table and the real one — and the packaged audit measures the first
frame, which is exactly what it would capture. Compiling the vertex data into
the bundle keeps one deterministic path and needs no loader, no MIME type, and
no exception to the app's `default-src 'self'` policy.

The .glb remains the authored artifact: it is what Blender exports, what
`config/asset-rights-ledger.json` records, and what the compiled module is
derived from. It is declared `approved-commercial-redistribution` with all three
evidence types satisfied, because it is original work generated arithmetically
by a checked-in script with no external source asset. Blender is the tool, not a
content source.

`.glb` is in `runtimeAssetExtensions`, so any undeclared model dropped into an
inventory root now fails the gate the same way an undeclared image does.

## What is authored, and what is still procedural

Authored (11 meshes, 3825 triangles): the three-zone table top — printed felt,
hard ledge ring, padded rail, metal trim — plus the centre medallion, the
racetrack betting line, the per-seat play zone, the per-seat ledge inlay, the
pedestal, the card, and the chip body and its edge spots.

Still procedural in `tableScene.ts`: the room, the seated bodies, the chairs, the
dealer, and the blind/button markers.

Both are original work by construction. `tableGeometryLibrary.test.ts` asserts
the compiled geometry still matches the composition constants — the felt's
extents, the zone nesting, the card ratio, the chip dimensions, and that every
seat medallion lands on the ledge shelf rather than the felt.

## Composition numbers that moved

| Constant | Was | Now | Why |
| --- | --- | --- | --- |
| `CAMERA_VERTICAL_FOV` | 70 | 62 | 70 bought peripheral coverage the hero never looked at and charged barrel distortion for it: the neighbour at the frame edge was stretched into an unrecognisable mass. Every opponent is still reachable inside the ±40° head turn. |
| `STATION_CLEARANCE` | 0.30 | 0.34 | 0.30 put a neighbour's shoulder 0.55 m from the eye. An intermediate 0.42 fixed that but left nobody able to rest their hands on their own rail without an arm long enough to look wrong. |
| `DEALER_CLEARANCE` | — | 0.20 | New. The dealer works at the felt, so they sit up against the rail. At a player's clearance their arms had to span half a metre of open air to reach the felt at all. |
| `CHIPS_PER_COLUMN` | 12 | 8 | A twelve-high column is 44 mm of chip on a 48 mm base and reads as one squat cylinder. Eight breaks a holding into two or three columns, which is both what players do and what makes a stack's size readable. |
| `PROCEDURAL_CARD_FACE_SIZE` | 96×136 | 132×186 | The board is read off the felt with no DOM overlay in front of it. |

## Two things worth not re-learning

**The board is laid out in the hero's frame, not the table's.** Along the
table's long axis it reads correctly only from the seats on the long sides; from
either end of the oval the hero looks straight down the row and it collapses into
a diagonal pile. It is also oversized (1.5×) and lifted 0.26 m toward the hero,
because from the worst seat it otherwise resolves to twenty pixels of card. A
dealer would square the board up to the table, so this is a deliberate
departure — a stable one, since the hero's seat is fixed for the whole event.

**Card faces stay 180°-rotationally symmetric.** That property is why a card
lying on a table has no wrong way up, and abandoning it for a single large centre
index produced an upside-down face twice, in opposite directions. The indices are
oversized and moved inboard to the card's midline — the least foreshortened band
at a grazing gaze — but there are still two of them, and a point reflection
through the card's centre maps one onto the other.

## Looking at the result

`node scripts/preview-3d-scene.mjs --out work/preview` drives a development build
through CDP and captures the seated frame at several streets and pan positions.
It is a design tool, not a gate: the packaged audit in
`scripts/audit-packaged-3d-scene.mjs` is the gate.

The split matters. Every composition defect this project has shipped was found by
opening a capture, and none were found by a passing assertion — presence,
opacity, bounds, parity and budget checks cannot see composition. The audit costs
a full package plus several minutes, which is the right price for evidence and
the wrong price for "is the rail the right colour".
