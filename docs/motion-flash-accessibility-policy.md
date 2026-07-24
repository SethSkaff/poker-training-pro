# Motion and flash accessibility policy

Status: static release gate implemented; visual flash analysis and hands-on reduced-motion verification remain release blockers.

This policy is a conservative engineering guardrail for Poker Training Pro. It is not a WCAG conformance claim or accessibility certification.

## Shipping limits

1. Do not ship any content that flashes more than three times in any one-second period. This project applies that ceiling across the entire visible area instead of relying on the more complex area exception.
2. Do not add a repeated CSS animation whose name contains `blink`, `flash`, `flicker`, or `strobe`. The static gate intentionally rejects those signatures even when their declared duration appears slow.
3. Do not add a repeated stepped visual-property animation shorter than one second. Do not add a scripted visual toggle interval shorter than 334 ms.
4. Every repeated CSS animation must have both:
   - an operating-system `prefers-reduced-motion: reduce` override; and
   - the app's `.reduced-motion` override, controlled by the saved Reduce Motion setting.
5. Scripted presentation sequences must branch on the saved reduced-motion setting and reach a stable end state without the full movement.
6. Automatically started moving, blinking, scrolling, or auto-updating presentation that lasts more than five seconds and runs beside other content must offer a pause, stop, or hide mechanism unless it is essential. A reduced-motion preference is also retained as a stronger project-wide stop mechanism.
7. A future looping menu video or animated bitmap is not approved by source inspection. It must be analyzed as rendered, including the loop boundary.

The three-per-second limit follows the unqualified ceiling in WCAG 2.3.2 (Level AAA) and is also a simple sufficient route discussed for WCAG 2.3.1 (Level A). WCAG 2.3.1 otherwise permits content above that rate only when it remains below defined general-flash/red-flash area thresholds. The project does not use that exception in its code-level gate.

## Deterministic static gate

Run:

```powershell
node .\scripts\test-motion-flash-audit.mjs
node .\scripts\audit-motion-flash.mjs --output .\work\motion-flash-audit.json
```

The audit recursively inventories CSS animations, transitions, keyframes, scripted timers, and animated/looping media references under `src`. It fails on:

- repeated blink/flash/flicker/strobe animation names;
- a mechanically estimated visual-property reversal rate above three per second;
- rapid repeated stepped visual animations;
- rapid scripted visual-state intervals;
- repeated animation without operating-system or in-app reduction coverage;
- scripted presentation timers without a nearby reduced-motion branch; and
- an animation reference without matching keyframes in the same stylesheet.

The JSON output is deterministic for a fixed source tree and includes source file and line evidence. The scanner is intentionally conservative but cannot calculate rendered luminance, saturated-red chromaticity, affected visual angle, composited video frames, or browser/Electron timing behavior.

## Current source inventory and interpretation

The gate currently discovers the complete declared animation/transition and timer inventory rather than maintaining a hand-copied list. Notable motion requiring visual review includes:

- the 4.3-second championship room flythrough and background travel;
- the 1.65-second progress arrival and table-seat transfer;
- the title prompt opacity cycle, start-menu light/drift declarations, and menu shimmer;
- the thinking-ring rotation and short card/chip deal, muck, and push effects;
- hover/focus transforms and color/filter transitions;
- the scripted flythrough phase timers, arrival overlay timer, decision-presentation delays, and 100 ms elapsed-time status update; and
- the dormant start-menu looping-video code path. `START_MENU_LOOP` is currently undefined, so no loop asset is selected by the current source.

The global CSS contains both the saved `.reduced-motion` override and the operating-system media query. `RoomFlythrough.tsx` also selects its short completion path when the saved setting is enabled. These are positive source findings, not proof of runtime behavior.

## Required manual release checks

Static source inspection cannot establish WCAG 2.3.1 thresholds. Before a release candidate is approved:

1. Record every reachable screen and transition at the shipping frame rate. Cover all four modes, every game-speed setting, high-contrast mode, supported resolutions/scaling, hover/focus states, the flythrough, table arrival, card/chip effects, title/menu motion, and every video or animated image.
2. Analyze each recording with a recognized photosensitive-epilepsy analysis tool. Test loop boundaries. Reject or revise any sequence above the project ceiling or any general/red flash threshold.
3. Test operating-system Reduce Motion before launch and while the app is running. Test the saved in-app toggle before each presentation. Confirm no full flythrough, looping decoration, or repeated card/chip movement survives, and confirm the stable end state remains understandable.
4. Observe the app for at least five minutes per screen. Confirm persistent automatic motion has a working pause/stop/hide mechanism, or remove it.
5. Repeat the checks on the signed packaged Electron build; development-browser results are insufficient.

Record tester, build hash, operating system, display/scaling, capture frame rate, analysis tool/version, tested routes, result, and evidence location. Any new or changed motion asset invalidates the prior evidence for that route.

## Standards basis

- W3C, [Understanding SC 2.3.1: Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
- W3C, [Understanding SC 2.3.2: Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html)
- W3C, [Understanding SC 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- W3C, [Understanding SC 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- W3C, [G15: Using a tool to ensure content does not violate the flash thresholds](https://www.w3.org/WAI/WCAG22/Techniques/general/G15)

