# Desktop 3D architecture decision

**Status:** Accepted — 2026-07-27
**Supersedes:** the deferral in `desktop-presentation-architecture.md`, which
chose staged 2.5D and postponed real 3D behind a future decision record. That
document remains valid as the record of what shipped up to this point and as the
specification for the **fallback renderer** described below. Its "Canvas/WebGL
engine — Deferred" row is no longer in force.

## Decision

The desktop game moves to a **real-time 3D scene rendered with three.js on
WebGL2**, drawn to a canvas that sits behind the existing DOM table. The
deterministic poker engine, the DOM accessibility layer, offline operation, and
the reduced-motion alternative are all preserved unchanged.

The scene is presentation only. It reads state; it never owns it.

### Why this was reopened

The previous record's reasoning was sound for its constraints and produced real
work — layered art, per-table depth in the arrival fly-through, translated table
coordinates. None of it delivers the product direction, and no amount more of it
will: CSS parallax, flat background art, portrait panels, circles, gradients, and
small translations are explicitly outside what this task accepts. The product
requires a room the camera can move through and bodies that perform the physical
actions of poker. That needs a renderer with a camera, a depth buffer, and
meshes.

## Rendering technology

**three.js (r185+), used imperatively, on WebGL2.**

| Option | Verdict | Reason |
|---|---|---|
| **three.js alone** | **Chosen** | Zero runtime dependencies — verified against the registry. Mature glTF/PBR/shadow support. GLSL is compiled through the WebGL API, never `eval`, so it satisfies `script-src 'self'`. |
| three.js + @react-three/fiber | Rejected | Pulls ten transitive dependencies (`buffer`, `zustand`, `its-fine`, `base64-js`, `scheduler`, `@types/webxr`, `suspend-react`, `@babel/runtime`, `react-use-measure`, `use-sync-external-store`). This repository runs a dependency-security gate, an SBOM, a licence catalogue, and runtime notice generation; a zero-dependency library is materially cheaper to defend, and the declarative ergonomics are not worth ten supply-chain entries. |
| Babylon.js | Rejected | Larger baseline for capabilities (physics, WebXR, inspector) this product does not need. |
| PlayCanvas engine | Rejected | Comparable size to three.js with a smaller ecosystem for glTF tooling. |
| Raw WebGL2 | Rejected | Months of lighting, shadow, and glTF work to reach parity with a library that is already audited and licensed permissively. |
| WebGPU | Deferred | Electron 43 supports it, but WebGL2 is the safer baseline and three.js can switch backends later without changing scene code. |

**Licence:** three.js is MIT. It enters the asset/licence manifest and the
runtime notices through the existing pipeline like any other dependency.

## Bundle impact and the budget decision

The current gate (`config/performance-budgets.json`) is:

- `initialJavaScriptGzipMiB`: **0.3**
- `distTotalMiB`: **64** (current `dist` is ~11 MiB)

**The initial-JS budget does not move.** three.js never enters the initial
chunk. The renderer is loaded only when a scene that needs it is entered, using
the `lazyWithPreload` mechanism this codebase already uses for `PokerTable`,
`RoomFlythrough`, `HandReviewScreen`, and `CareerTravel` — so the machinery for
this already exists and is already exercised by the packaged audits.

A **new** budget key is added rather than relaxing an old one, so the cost is
visible instead of hidden:

```
"sceneJavaScriptGzipMiB": 0.35   // three.js + scene code, lazy chunk only
"sceneAssetsMiB": 24             // .glb meshes + textures in dist
```

Expected: tree-shaken three.js (`WebGLRenderer`, core math, `GLTFLoader`,
`meshopt` decoder) lands around 150–170 KiB gzip; scene code perhaps 40 KiB.
`distTotalMiB` stays at 64 and absorbs `sceneAssetsMiB` — 11 MiB today plus a
24 MiB ceiling leaves headroom.

`scripts/audit-static-budgets.mjs` must be taught the new keys. **A budget
addition is a policy decision recorded here, not a gate bypass**; if the scene
chunk exceeds 0.35 MiB gzip the correct response is to cut scene scope or
re-decide in writing, not to raise the number quietly.

## Performance budget

The existing desktop budgets already bind and are not relaxed:
`frameTimeP95Ms: 25`, `frameTimeP99Ms: 50`, `idleCpuPercent: 3`,
`peakWorkingSetMiB: 600`, `modeSelectToTableReadyMs: 1500` typical / 3000
low-spec.

Scene-specific budgets, to be measured by extending the packaged lifecycle audit
(which already measures real frame rate through CDP):

| Budget | Target | Rationale |
|---|---|---|
| Draw calls / frame | ≤ 150 | Six seated bodies, table, room shell, cards, chips. |
| Triangles / frame | ≤ 250k | Low-poly by design; a seated body is 3–8k. |
| Texture memory | ≤ 128 MiB decoded | Half the existing 256 MiB runtime-asset ceiling. |
| Shadow casters | ≤ 8 | One overhead key light; the rest baked. |
| Idle CPU while hidden | ~0 | The loop must stop on the existing pause path. |

**The render loop must honour the existing lifecycle contract.** The packaged
lifecycle audit already proves the app drops to 0 fps when minimized and that
play freezes; a `requestAnimationFrame` loop that keeps running would regress a
measured, passing gate.

## Asset pipeline

- **Format:** glTF 2.0 binary (`.glb`), meshopt-compressed. One rigged seated
  body mesh reused across characters, varied by material, palette, and
  accessory — which also addresses E27-006, since face variety stops depending
  on a six-cell sprite sheet.
- **Animation:** baked clips, not procedural IK — `idle`, `receive-cards`,
  `peek`, `fold-muck`, `check-tap`, `push-bet`, `all-in-shove`, `win-collect`,
  `stand-and-leave`. These are the actions E27-014 requires be visible.
- **Authoring:** original work. No protected WSOP branding, and no imported
  third-party character or UI design. Every mesh, texture, and material enters
  the asset-rights manifest and passes `validate-asset-rights.mjs` before it
  ships, exactly as the audio pipeline already works.
- **Delivery:** bundled in the ASAR and loaded over the custom protocol. CSP
  (`script-src 'self'`) forbids CDN delivery, remote models, and remote
  textures; the packaged network audit already proves zero egress and must keep
  passing.
- **Determinism:** no asset may influence engine state. Meshes and clips are
  chosen by the same deterministic identity hash that drives appearance today.

## Accessibility structure

This is the part most easily got wrong, so it is stated as a hard rule:

**The DOM stays the accessibility scene. The canvas is decorative.**

- The `<canvas>` is `aria-hidden="true"` and never focusable.
- The existing table DOM — named seat groups, live regions, focus management,
  action controls, card and pot text — remains mounted and authoritative for
  every interaction. It is what screen readers, keyboards, and controllers use,
  and what the existing accessibility, geometry, and contrast audits inspect.
- Because the DOM layer already exists and is already audited, this is a
  presentation swap rather than a rewrite: the 3D scene is added behind a layer
  that keeps working if the scene never loads.
- **Reduced motion:** `data-motion-camera="off"` pins the camera, disables
  interpolation and idle animation, and renders on demand rather than
  continuously. Reduced motion must not reduce information.
- **Fallback:** if WebGL2 is unavailable, context creation fails, or the device
  is blocklisted, the existing 2.5D CSS table renders instead. That path stays
  supported and tested — it is the reason the previous decision record's work
  is not discarded.

## Staged migration path

Each stage is independently shippable and independently revertable behind a
setting. No stage is allowed to regress a passing packaged audit.

| Stage | Content | Exit criterion |
|---|---|---|
| **M0** | This decision, budget keys, dependency added, renderer bootstrap behind a flag, WebGL capability probe and fallback. | Fallback proven by forcing probe failure. |
| **M1 — vertical slice** | One room shell, one playable table, seated camera with limited left/right look and recentre, physical cards and chip stacks, **one** seated low-poly opponent performing deal, fold, and betting actions, driven by the real presentation event queue. | A real hand is playable in the slice; DOM layer unchanged; reduced-motion path renders a fixed camera. |
| **M2** | All six seats, full action vocabulary, dealer button, per-pot chip piles (completes E27-002's physical half and E27-009). | Six bodies within the draw-call and triangle budgets. |
| **M3** | Room context: additional tables, lighting, background activity, tier-varied venues. | Budgets hold at 1080p on integrated graphics. |
| **M4** | Camera travel — arrival fly-through and inter-event travel rebuilt in the scene (E09-004, E20-003). | Arrival and travel run in 3D with reduced-motion equivalents. |
| **M5** | Promote to default; 2.5D becomes the fallback renderer; packaged audits extended to the scene. | All packaged audits pass against the 3D default. |

## What this decision does not do

It does not make the game photorealistic, and it does not require it. Stylised
low-poly is the target. It does not move the poker engine, the replay format, or
the save format. It does not remove the DOM table. And it does not, by itself,
make the room feel alive — that is M3, and it is where the atmosphere the
product is asking for actually arrives.
