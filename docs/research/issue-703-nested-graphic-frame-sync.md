# Issue #703 — Nested Graphic frame synchronization

Date: 2026-10-04
Status: bounded research/prototype complete; production implementation not authorized
Mother PR: #677

## Result

**Recommendation: GO TO IMPLEMENTATION CONTRACT** for the narrow case tested here: a nested XFL Graphic instance in `loop` mode, with no authored `firstFrame`/`lastFrame`, advances from its first child frame with elapsed time inside its containing parent span. This resolves Black B/C without a Panda-only nested-frame override.

The Black parent `元件 1` has three visible nested Graphics. Each instance span is `[0,30)`, uses `loop`, and omits `firstFrame` and `lastFrame`. At parent frame 6 the existing production adapter selects child frames `补间 1@0`, `补间 2@6`, `补间 3@0`; at parent frame 7 it selects `补间 1@0`, `补间 2@7`, `补间 3@0`. The selected body states are authored, one-frame spans with `tweenType=none`. No child frame was manually chosen.

Adobe’s Animate guide describes Graphic timelines as tied to the containing timeline and says Loop advances through the Graphic frames for the parent instance span. Its looping guide defines Single Frame as fixed to the selected first frame and says an omitted Last frame defaults to the end of the Graphic timeline. The source evidence and Black renders agree with that behavior. [Adobe Animate: Elements in Animate](https://helpx.adobe.com/ph_fil/animate/desktop/using/elements.html), [Adobe Learn: Types of symbols](https://www.adobe.com/learn/animate/web/types-of-symbols).

## Source and time coordinates

| Coordinate | Black evidence |
| --- | --- |
| Document target | Scene `场景 1`, document frame 0, one frame total |
| Scene instance | `元件 1`, Graphic/Loop, span `[0,1)`, visible, transform `{a:1,b:0,c:0,d:1,tx:759.05,ty:112.6}` |
| Parent symbol | `元件 1`, 30 frames; all three layer spans are `[0,30)`, `tweenType=none` |
| Parent state at frames 6/7 | Held from authored frame 0; the display list remains the frame-0 authored content while its playhead coordinate advances |
| Nested instances | `补间 1` (1 frame), `补间 2` (1927 frames), `补间 3` (1 frame); all visible, Graphic/Loop, spans `[0,30)`, no authored `firstFrame` or `lastFrame` |
| `补间 2` instance transform | `{a:1,b:0,c:0,d:1,tx:234.15,ty:549.6}` |
| Tested child body states | `补间 2@6` span `[6,7)` and `补间 2@7` span `[7,8)`; both authored, `tweenType=none` |

The Scene is only one frame long. The experiment therefore holds document frame 0 as the composition wrapper and explicitly probes the **internal parent Graphic frame** 0, 5, 6, 7, 8, 9, 10, and 11. It establishes nested selection when `元件 1` is at those internal frames; it does not claim that Scene playback advances this one-frame Scene instance to parent frame 6 or 7.

## Competing hypotheses

| Hypothesis | Selection rule | Result |
| --- | --- | --- |
| H1 — Graphic Loop follows parent-span time | Start at default/explicit first frame; advance by `parentFrame - instanceSpanStart`; Loop repeats through the authored child range | Supported. Frames 5, 6, 7, and 8 resolve to `补间 2@5/@6/@7/@8`. Parent frames 6 and 7 produce the B/C full-character candidates. |
| H2 — nested Graphic remains fixed at its default frame | Use the default/explicit first frame regardless of parent time | Falsified for B/C. Parent frames 6 and 7 both reproduce A exactly; neither body candidate appears. |
| H3 — absolute parent frame, ignoring instance-span start | Use `parentFrame` directly as child elapsed time | Not distinguishable in this file: every tested nested instance span starts at 0, so H3 and H1 produce the same frame indices. Adobe’s documented parent-span behavior supports H1’s relative origin. |

At parent frame 5, `补间 2@5` also contains two nested `single frame` instances with authored `firstFrame="3"`. They are recorded in the machine receipt but were not used to infer the first-frame index base or to claim a complete frame-5 render. The B/C body frames 6 and 7 contain no deeper symbol instances, so those full composites do not depend on unresolved descendant timing.

The body Graphic has 1927 frames, while the parent instance span is only 30 frames. The tested parent range does not cross the child’s end frame. Adobe documents Loop behavior, but this corpus does not independently exercise a wrap boundary. A later implementation contract should include a wrap control and a nonzero instance-span-start control, along with explicit `firstFrame`, `lastFrame`, Play Once, Single Frame, and out-of-range inputs.

## Render and reference evidence

The in-memory prototype uses the production XFL adapter, display-list resolver, SVG compositor, and sandboxed PNG rasterizer. It temporarily supplies frame contexts in a local symbol map; no production resolver behavior or persisted project state changes.

| Probe | Derived nested frames | SVG SHA-256 | PNG SHA-256 | Reference status |
| --- | --- | --- | --- | --- |
| A control, parent frame 0 | `补间 1@0 / 补间 2@0 / 补间 3@0` | `f78ff2af1894f595a5d3ba5844b9e9603d3e515bcba4e89713f7d7eb41a4afff` | `a049f7554b33a645398d981394e6c11fcff183197c512d7ebab3c4f3015b0900` | Exact SVG and PNG hashes equal the accepted #702 A control |
| Pose B candidate, parent frame 6 | `补间 1@0 / 补间 2@6 / 补间 3@0` | `fa52b27026dbe5b0bb4066fc73d2c31ab6b794e13fc248d05567d974037d1a5f` | `5bc7c406ba126fb6e503978caccee1e28d27032905458cd09989d0d8e87067df` | Visually corresponds to exact reference Pose B; maintainer acceptance pending |
| Pose C candidate, parent frame 7 | `补间 1@0 / 补间 2@7 / 补间 3@0` | `e2a532e2fd78f5d056777b7f221e54923f6966c16b6780f84f2a48517342605e` | `09ec439047388fe48ba95fe83041f0e48a333e6e1e4f05d81ee1af49c29527be` | Visually corresponds to exact reference Pose C; maintainer acceptance pending |
| H2 at parent frame 6 | `补间 1@0 / 补间 2@0 / 补间 3@0` | `f78ff2af1894f595a5d3ba5844b9e9603d3e515bcba4e89713f7d7eb41a4afff` | `a049f7554b33a645398d981394e6c11fcff183197c512d7ebab3c4f3015b0900` | Reproduces A, not B |
| H2 at parent frame 7 | `补间 1@0 / 补间 2@0 / 补间 3@0` | `f78ff2af1894f595a5d3ba5844b9e9603d3e515bcba4e89713f7d7eb41a4afff` | `a049f7554b33a645398d981394e6c11fcff183197c512d7ebab3c4f3015b0900` | Reproduces A, not C |

The exact reference image hash is `7c53292222edcd183bb0d40ee647435ef860f9894cd4203150317364ca679eac`. B/C output PNGs are 1920×1080, and repeated SVG/PNG rendering of frames 0, 6, and 7 was byte-identical. Full SVG/PNG files and the detailed machine receipt are in `D:\PandaStage-Acceptance\issue703-nested-graphic-20261004\`; the white-background B/C review previews are derived copies, while the hashed PNGs remain the original transparent production-rasterizer outputs.

## Negative controls and boundaries

- Original FLA SHA-256 before/after: `A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA`; unchanged.
- The original FLA’s ZIP central directory is rejected by JSZip as missing 54 bytes. The prototype reads XFL from the #702 normalized archive copy (`681237abb7b32e79ce89ff8e283b0573b4bf170c6b85830828c7a10911bc7a33`) and separately hashes the untouched original before and after.
- Exact reference hash before/after is unchanged. The source and normalized archive copy are also unchanged.
- No production source changed. #698 geometry behavior and #700 layer normalization are exercised through their existing production path; the A control SVG/PNG remains byte-identical to #702. The adapter’s back-to-front layer order is preserved.
- Rasterization reports `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`; generated SVGs contain no external resources.
- No tween interpolation, MovieClip behavior, ActionScript, UI, schema, or source-file mutation was implemented.

## Implications and next action

**#702:** B/C are no longer unknown at the nested-synchronization seam. The source-derived parent addresses are `元件 1@6 → 补间 1@0 / 补间 2@6 / 补间 3@0` and `元件 1@7 → 补间 1@0 / 补间 2@7 / 补间 3@0`. Keep human reference acceptance pending.

**Stage B2:** enumerate nested Graphic candidates from parent frame coordinates and each instance’s containing span, playback mode, first/last frame, and child frame count. Deduplicate resolved compositions; do not treat every raw timeline frame as a new complete pose.

**Next single action:** maintainer reviews the preserved B/C artifacts and authorizes a narrowly scoped implementation contract for documented Graphic span synchronization, including the untested boundaries listed above.

## Reproduction

The repository build command is `pnpm build`. With the Issue #702 source, normalized archive copy, and reference available locally, run:

```powershell
pnpm build
$census = Get-Content -Raw -Encoding UTF8 docs/research/issue-702-black-multi-pose-census.json | ConvertFrom-Json
$prior = 'D:\PandaStage-Acceptance\issue702-black-census-20261004'
$acceptance = 'D:\PandaStage-Acceptance\issue703-nested-graphic-20261004'
pnpm exec electron scripts/research/issue703-nested-graphic-sync-prototype.cjs --source $census.source.localPath --archive (Join-Path $prior 'normalized-source.fla') --reference $census.reference.localPath --out $acceptance
```

`electron` is a repository dependency. The runner writes only to the requested evidence directory and does not modify the input FLA or reference.
