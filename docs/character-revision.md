# Character asset revision

This pass revises the existing Blender foreground kit. It changes only character
faces, hair, facial hair, garments, and the dealer's outfit. Poker state, card
peek, dealing timing, chip logic, table geometry, camera, and UI are outside it.

## Art and assembly

- Six head families have distinct mandibular angles, chin widths, cheek shelves,
  brow relief, sculpted nasal bridges/tips, recessed sockets, and folded ears.
- Each head accepts three jaw shapes, four bounded nose profiles, three fitted
  eye/lid shapes, three brows, and three lip shapes. The fitted modules preserve the
  upper skull and eye anchors; beard patches receive the same jaw deformation.
  Modules use fixed anatomical anchors, never random feature coordinates.
- Twelve authored hair meshes plus bald cover buzz, crop, side part, swept back,
  wavy, curly, receding, ponytail, bob, long straight, shoulder curls, and top knot.
  Scalp geometry carries directional ridges and UVs; longer styles continue the
  scalp surface. No hair cards or transparent outer hair shells are required.
- Clean-shaven, stubble, mustache, goatee, and short beard use separate fitted
  patches. Small cutout grain breaks up facial-hair surfaces. Stubble blends
  toward the selected skin tone instead of recoloring the whole lower head.
- Age-aware palettes favor black/espresso/brown, make gray more common with age,
  and reserve lighter natural shades for a minority of identities. Young faces
  do not select receding hair. The existing 75/25 presentation split and roughly
  5% mole rate remain; appearance still accepts only the identity ID.
- Ten garments retain their runtime names, with fitted collars, shallow seams,
  hood folds, opening facings, welts, rib necks, or quilt stitching as appropriate.
  Woven surface maps and restrained flannel checks belong to the material.
  Jackets/cardigans/waistcoats have a separate inset shirt. Character sleeve
  geometry adds cloth folds and cuff shaping without changing joint endpoints.
- The dealer wears shirt sleeves, a fitted dark waistcoat, ivory collar, and a
  thin burgundy tie. The original elevated torso and shoulder pivot remain.

This is still a stylized game kit, not a facial rig. Jaw/nose shape adjustments
happen once at assembly. Existing body, shoulder, elbow and hand transforms are
preserved for the later animation pass.

## Files and reproduction

Authoring was executed in Blender 4.5.13 through Blender MCP:

1. Run `tools/blender/revise_characters.py` in Blender. It loads the current
   `src/assets/foreground.glb`, retains all non-character meshes, replaces only
   its named character families, and exports the revised GLB.
2. Run `node tools/glb-to-geometry.mjs src/assets/foreground.glb
   src/scene3d/generated/foregroundGeometry.ts foregroundGeometry`.
3. Run `tools/blender/review_characters.py` in Blender to regenerate the editable
   `art/character-revision/characters.blend` and studio contact sheets.

The first-pass `build_foreground.py` remains the baseline construction recipe;
when building from an empty library, run it before the character revision.
The table master and its authoring recipe are unchanged.

`opponentAppearance.ts` owns deterministic module selection.
`characterSurfaces.ts` owns bounded shape fitting and hair surface treatment.
`sceneCharacters.ts` assembles the parts onto the existing joint graph.

## Review and checks

Studio contact sheets review garment fit and facial profiles. The gameplay
capture reviews the same assets in the existing room from the seated camera.
`validation.json` records final checks and geometry preservation results.
The Blender studio uses neutral lighting; the runtime retains the existing
warmer room lighting, so the contact sheet is not a screenshot of gameplay.

No third-party models, textures, likenesses, branding, or animation clips were
introduced. All geometry and surface recipes in this revision are original.
