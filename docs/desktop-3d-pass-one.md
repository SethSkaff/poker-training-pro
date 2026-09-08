# Foreground asset redesign — pass one

## Audit and compatibility

The existing scene is an imperative Three.js presentation driven by public
poker state. The DOM HUD, accessibility layer, controls, camera stations,
event timing, reduced-motion fallback and poker engine remain unchanged.
The table/card/chip GLB was already compiled into synchronous geometry. The
opponents, dealer, chairs and markers were assembled from runtime primitives.
The weakest parts were intersecting hair caps, disconnected facial features,
coarse garment patterns, shallow furniture and insufficient material separation.

The replacement uses the same seat coordinates, table height, card UV
orientation, chip dimensions, shoulder/elbow pivots and dealer shared-arm pivot.
Existing fast dealing, folding, betting and peeking choreography is retained.
The POV upper-arm surfaces extend toward the player below the view; wrist and
elbow contact anchors stay fixed.
No animation clips or room/background assets were redesigned.

## Authored deliverables

Blender 4.5.13 was operated through Blender MCP to build, export, review and
refine the models. All geometry and surface patterns are original; no external
models, branding, reference imagery or paid generation service was used.

| Deliverable | Source / editable master | Runtime use |
| --- | --- | --- |
| Emerald table, closed upholstered rail, hard ledge, champagne trim, apron, twin supports | `tools/blender/build_table.py`, `art/pass-one/table.blend` | `src/assets/table.glb` → compiled table geometry |
| Beveled cards, rounded clay chips with edge spots and concentric face inlays | Same table master | Existing face/back textures, chip ownership and instancing |
| Connected five-digit hand | Same table master | Opponent, dealer and first-person action and peek hands; existing peek contact points retained |
| Upholstered chair, metal frame and piping | `tools/blender/build_foreground.py`, `art/pass-one/foreground.blend` | Three material parts |
| Dealer, small-blind and big-blind buttons | Same foreground master | Stepped ceramic body, recessed labelled face, metal band |
| Modular seated opponents and dealer | Same foreground master | Head, hair, eyes, garment, limbs and legs assembled locally |

The table library has 13 meshes and 8,725 triangles, below its existing 9,000
triangle gate. The foreground library has 50 meshes and 36,662 triangles across
all alternatives; only selected parts are instantiated for each character.
The existing static bundle limits are unchanged. Resource disposal still uses
the scene ledger, with fresh geometry owned by each disposable scene.

## Modular character rules

- Six facial surfaces vary jaw, cheek and chin shape while sharing an upper
  scalp envelope. Eyes and lips are small curved surfaces, not rectangular parts.
- Nine hair meshes plus bald cover the existing five male and five female
  style selections. Caps are fitted to the shared cranium; longer styles add
  separate shaped locks. The dealer uses the same fitted head/hair system.
- Ten tops have separate collars, lapels, bindings or a hood. Cloth uses a fine,
  low-contrast material texture rather than large printed blocks.
- Eight existing body families, six skin tones, continuous natural hair
  shades, four eye colors, optional stubble/goatee and three mole locations.
- A stable player-ID hash targets 75% male / 25% female. Facial hair applies to
  male-presenting identities; moles appear at approximately 5% probability.
  Appearance never reads skill, cards, rating, actions or other poker state.
- Full seated legs extend below the table. The first-person player remains a
  viewpoint and hands. No visible player torso was introduced.

The kit is prepared for a later animation pass through separate named parts,
metre units and retained attachment origins. It is **not a skinned facial or
finger rig**. Existing procedural joints continue to supply motion. The legacy
`dealer-cap` mesh name now identifies fitted dealer hair for compatibility.

## Materials and compilation

Runtime PBR materials live in `sceneCharacters.ts` and `tableScene.ts`; felt nap
is generated deterministically by `sceneSurfaceTextures.ts`. The felt, rail,
trim and support structure are opaque and depth-writing. Blender material
masters include editable PBR material nodes; GLB geometry exports deliberately
omit materials because the game supplies identity colors and local textures.

`tools/glb-to-geometry.mjs` quantizes position data to 0.01 mm, delta-encodes
positions and indices, and stores numeric arrays. Normals are reconstructed
from the exported split topology. This keeps the full asset set inside the
existing compressed-JavaScript budget without asynchronous placeholders or
network fetches. The decoder retains compatibility with older base64 arrays.

The older `assets:build-characters` command generates the legacy unused character
preview; use the foreground recipe below for this kit.

Regenerate in Blender 4.5 using `build_foreground.py` and `build_table.py`
(`-- --out src/assets/table.glb` for the latter), then run:

```text
node tools/glb-to-geometry.mjs src/assets/foreground.glb src/scene3d/generated/foregroundGeometry.ts foregroundGeometry
node tools/glb-to-geometry.mjs src/assets/table.glb src/scene3d/generated/tableGeometry.ts tableGeometry
```

`review_foreground.py` and `review_table.py` produce the editable `.blend`
libraries and studio review images. They operate on the authoring scene and
clear it first. Run them in a dedicated Blender session, as done for this pass.
Asset-rights metadata records both GLB masters and their original recipes.

## Review and validation

Reviewed Blender portraits and table materials, then the actual game from
seat level, including peeking and left/right views. Refinements addressed hair
intersections, collar/torso penetration, sleeve attachment, hand topology,
button UVs, table floor contact and geometry/bundle budgets.

The relevant scene/appearance suite has 259 tests, including new signed-delta
decoding, part availability and 10,000-identity distribution checks. Packaging
runs the repository's installed-app 3D audit and license-sidecar audit. The
generated reports remain in the ignored `work`/`outputs` directories.
