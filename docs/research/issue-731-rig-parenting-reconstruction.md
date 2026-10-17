# Issue #731 — Animate layer parenting / rig transform reconstruction

**Baseline:** `60af3a2bedba1351d70f48da501fb72be6e885bf`

**Mother PR:** [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), remains OPEN / Draft
**Scope:** research only; no production code or FLA changes.

## Finding

The `com26` data strongly links each child’s frame-level `parentLayerIndex` to a sibling parent layer’s `layerRiggingIndex`. The strongest target mapping is `SERIALIZATION_STRONGLY_INFERRED`: it is repeated at every child key and has no surviving ordinal interpretation in the target timeline. This is not a documented XFL schema guarantee.

Model B provides a coherent research prototype and preserves the saved child matrices at every key by construction. That result does not prove Animate’s intermediate output. Adobe documents per-keyframe parenting and exposes JSFL rig-parent/rig-matrix APIs, but the documentation does not specify the exact saved-matrix coordinate space, affine composition, or `transformationPoint` formula. No Animate runtime query or reference render of this fixture was available. The implementation decision therefore remains **`RIG_PARENTING_EXTERNAL_TRUTH_REQUIRED`**.

## T0 — Frozen `com26` rig graph

The source is `D:\表情合集\向右走.fla`, SHA-256 `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098` before and after the study. The control is `D:\表情合集\人物倒地.fla`, SHA-256 `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` before and after. The 14-file corpus was also hashed before and after; all hashes matched.

DOM order and Panda painter order are both shown because the adapter reverses XFL timeline layers for back-to-front painting.

| DOM ordinal | Painter index | Layer | Type | `layerRiggingIndex` | Frame-level relationship | Visible Graphic |
| ---: | ---: | --- | --- | --- | --- | --- |
| 0 | 4 | `补间_19` | normal/default | — | — | — |
| 1 | 3 | `元件_10` | normal/default | — | `parentLayerIndex=1` at F0/F5/F10/F15/F20 | `com24` |
| 2 | 2 | `补间_21` | normal/default | `1` | candidate parent for `元件_10` | `com14` |
| 3 | 1 | `元件_11` | normal/default | — | `parentLayerIndex=0` at F0/F5/F10/F15/F20 | `com25` |
| 4 | 0 | `补间_22` | normal/default | `0` | candidate parent for `元件_11` | `com15` |

All five layers are visible. Neither child nor candidate parent is a guide, folder, mask, or camera layer. Each matched child and parent key contains one visible Graphic instance. The children and candidate parents have motion spans at F0/F5/F10/F15, each duration 5; all use `keyMode=22017`, and the child spans set `motionTweenSnap=true`. Parent identity stays constant across all five child keys.

The following matrices use `[a,b,c,d,tx,ty]`. The point column records the corresponding `transformationPoint`. Every row is an authored key from the source archive.

### `com24` child under `com14`

| Frame | `元件_10` / `com24` matrix | Child point | `补间_21` / `com14` matrix | Parent point |
| ---: | --- | --- | --- | --- |
| 0 | `[1,0,0,1,-28.3,70.65]` | `[57.45,8.8]` | `[1,0,0,1,165,139.95]` | `[17.35,-82.5]` |
| 5 | `[0.51934814453125,-0.854400634765625,0.854400634765625,0.51934814453125,-8.05,123.9]` | `[57.45,8.8]` | `[0.8768310546875,0.48077392578125,-0.48077392578125,0.8768310546875,127.45,121.45]` | `[17.4,-82.45]` |
| 10 | `[0.9669189453125,-0.254608154296875,0.254608154296875,0.9669189453125,-28.65,85.6]` | `[57.4,8.85]` | `[0.88134765625,0.472412109375,-0.472412109375,0.88134765625,128.1,121.95]` | `[17.4,-82.45]` |
| 15 | `[0.9669189453125,-0.254608154296875,0.254608154296875,0.9669189453125,-28.65,85.6]` | `[57.4,8.85]` | `[0.9351806640625,0.35406494140625,-0.35406494140625,0.9351806640625,136.9,128.45]` | `[17.45,-82.4]` |
| 20 | `[0.9990234375,-0.04290771484375,0.04290771484375,0.9990234375,-28.5,73.1]` | `[57.35,8.9]` | `[0.998138427734375,0.0602874755859375,-0.0602874755859375,0.998138427734375,159.9,138.7]` | `[17.45,-82.4]` |

### `com25` child under `com15`

| Frame | `元件_11` / `com25` matrix | Child point | `补间_22` / `com15` matrix | Parent point |
| ---: | --- | --- | --- | --- |
| 0 | `[0.999984741210938,0,0,0.999984741210938,-77.1,74.9]` | `[80.4,3.4]` | `[0.99505615234375,0.09930419921875,-0.09930419921875,0.99505615234375,68.2,143.65]` | `[-26.85,-89.4]` |
| 5 | `[0.9833984375,-0.1810302734375,0.1810302734375,0.9833984375,-76.2,89.55]` | `[80.35,3.25]` | `[0.9990234375,-0.0436859130859375,0.0436859130859375,0.9990234375,81.05,140.15]` | `[-26.85,-89.4]` |
| 10 | `[0.949951171875,-0.3118896484375,0.3118896484375,0.949951171875,-73.8,100.15]` | `[80.3,3.3]` | `[0.979736328125,-0.200180053710938,0.200180053710938,0.979736328125,94.6,134.15]` | `[-26.85,-89.35]` |
| 15 | `[0.40838623046875,-0.912506103515625,0.912506103515625,0.40838623046875,-32.2,150.1]` | `[80.25,3.25]` | `[0.95709228515625,0.28961181640625,-0.28961181640625,0.95709228515625,50.25,145.2]` | `[-26.85,-89.25]` |
| 20 | `[0.9873046875,-0.158355712890625,0.158355712890625,0.9873046875,-76.45,87.7]` | `[80.2,3.35]` | `[0.994873046875,0.1005706787109375,-0.1005706787109375,0.994873046875,68.1,143.55]` | `[-26.8,-89.25]` |

The JSON generated by [the research harness](../../scripts/research/issue731-rig-parenting-reconstruction.cjs) records every layer’s raw frame attributes, visibility flags, painter index, matrix attributes, points, and both model outputs.

## T1 — Parent index mapping

The harness scanned 14 local FLAs. It found 62 `parentLayerIndex` occurrences: 60 on `DOMFrame` and 2 on `DOMLayer`. All 60 frame-level references had exactly one same-timeline `layerRiggingIndex` match; none were ambiguous or unmatched. Fifteen frame references also resolve to the child itself under a raw zero-based DOM ordinal interpretation. Six timelines have rigging indexes reordered relative to DOM order; no sparse rigging-index sequence was found in this corpus.

For the target `com26` timeline, the ten child-key references are stable and resolve as follows:

| Child | `parentLayerIndex` at all keys | Raw zero-based ordinal candidate | One-based ordinal candidate | Unique rigging-index match |
| --- | ---: | --- | --- | --- |
| `元件_10` (`com24`) | 1 | `元件_10` itself | `补间_19` | `补间_21` (`layerRiggingIndex=1`) |
| `元件_11` (`com25`) | 0 | `补间_19` | no candidate | `补间_22` (`layerRiggingIndex=0`) |

Neither ordinal interpretation identifies the animated parent candidates. The rigging-index interpretation uniquely identifies both candidates at every key, and their symbols and transforms fit the parent/child structure. This is strong serialization evidence for this family, but neither Adobe’s API docs nor a schema document equates this raw `DOMFrame` attribute with `DOMLayer.layerRiggingIndex` in all XFL versions. The mapping is therefore `SERIALIZATION_STRONGLY_INFERRED`, not schema-proven or API-corroborated.

## T2 — Adobe / JSFL semantics

Evidence labels are kept separate:

| Label | Source | Supported conclusion | Limit |
| --- | --- | --- | --- |
| `DIRECT_ADOBE` | [Adobe Animate timeline-layer guide](https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html) | Child layers inherit parent position and rotation; parenting is associated with child keyframes; Animate 2022+ can also propagate scale, skew, and flip. The guide describes a pivot condition for warped objects. | It does not identify the target `DOMFrame.parentLayerIndex` serialization, provide a 2D matrix formula, or explain `transformationPoint` composition. The source FLA’s authoring generation is not established. |
| `DIRECT_ADOBE` | [Adobe layer-parenting tutorial](https://www.adobe.com/in/learn/animate/web/layer-parenting-tween-animation) | The workflow can apply Classic Tweens to parent and child layers together, and recommends setting the transform center before keyframes. | It demonstrates the workflow, not the saved-matrix coordinate space or interpolation formula. |
| `ADOBE_API` | [JSFL `getRigParentAtFrame`](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting1.md), [`setRigParentAtFrame`](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting2.md) | Animate 2020 APIs expose the rig parent at a frame and let scripts set a parent for a particular frame. This corroborates frame-specific parent identity. | The API docs do not define how this target XFL field maps to those APIs. No Animate runtime query was run. |
| `ADOBE_API` | [JSFL `getRigMatrixAtFrame`](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting3.md) | A per-frame rig matrix is exposed. | The docs do not define its relation to the saved `Matrix` or `transformationPoint`. |
| `RUNTIME_EVIDENCE` | None | None claimed. | No Adobe Animate runtime or JSFL query was available for this exact fixture. |

The evidence confirms that Animate has per-frame parenting and permits simultaneous parent/child tweening. It does not settle the transform equation for this saved file. The source version is also unknown, so the version-dependent scale/skew/flip rule cannot be selected for implementation.

## T3 — Coordinate-space audit

The target’s serialized matrices are classified `UNKNOWN` as Animate rig-space for both child and parent. The strongest current Panda-side observation is narrower: [`localizeAbsoluteLeafMatrix`](../../src/main/services/fla-static-snapshot-display-list-adapter.ts) documents XFL leaf matrices as absolute within their owning timeline; it converts a leaf to group-local coordinates only when descending through a nested `DOMGroup`. The adapter interpolates each layer’s instance matrices independently. The [`fla-display-list-resolver`](../../src/main/services/fla-display-list-resolver.ts) composes nested symbol ancestors, but has no same-timeline sibling rig-parent stage.

This establishes Panda’s current parser behavior, not Adobe’s rig coordinate contract. It is not safe to conclude that these child keys are parent-relative or stage/world-baked solely from the results of multiplying matrices. The adapter captures `transformationPoint`, but that point is not currently applied as a rig pivot. Layer painter order is reversed independently of transform composition.

## T4 — Composition models

The harness evaluates each model on every integer frame in all four aligned spans (F0–F5, F5–F10, F10–F15, F15–F20), using the existing [`interpolateFlaLinearMotionTransform`](../../src/main/services/fla-motion-tween-transform-interpolator.ts). The prototype is outside production rendering and does not alter the allowlist or parser.

**Model A — naive hierarchy**

```text
childWorld(t) = parentWorld(t) * interpolate(childKey0, childKey1, t)
```

This treats the saved child matrices as parent-local. At the authored endpoints, the maximum matrix error is 165 for `com24/com14` and about 146.894 for `com25/com15`. It is not consistent with reproducing these matrices if they are already in the owning timeline’s coordinate system; this numerical mismatch alone does not prove Adobe’s coordinate convention.

**Model B — rebase endpoints into parent space**

```text
relative0 = inverse(parent0) * child0
relative1 = inverse(parent1) * child1
childWorld(t) = parent(t) * interpolate(relative0, relative1, t)
```

Model B reproduces both authored endpoints to a maximum absolute coefficient error of `2.84e-14` for each pair. Shared F5/F10/F15 boundaries are continuous in the prototype (maximum adjacent-segment error `0`). This follows algebraically from rebasing the endpoints; it is not independent evidence that Animate uses the same formula. At F1 in the first segment, the prototype yields:

| Pair | Model B matrix at F1 `[a,b,c,d,tx,ty]` |
| --- | --- |
| `com24/com14` | `[0.97904915598,-0.20348792252,0.20348792252,0.97904915598,-15.57708847,76.63834822]` |
| `com25/com15` | `[0.99930949721,-0.03640059557,0.03640059557,0.99930949721,-77.08438189,77.65251593]` |

**Model C:** no third evidence-backed Animate formula was found. The harness records child-only interpolation as a null control; it ignores the parent and is not proposed as a parenting model.

No production model is selected. Model B remains a research candidate until an Animate runtime oracle confirms intermediate frames.

## T5 — Pivot / transformationPoint

Both target pairs record `transformationPoint` at each key (tables in T0). The points vary slightly across keys, as do the matrices. Adobe’s guide gives a pivot condition for warped objects but does not specify how this affine rig family combines a child point, parent point, and matrix. Panda currently captures the points without using them in same-timeline rig composition.

Pivot classification is `UNKNOWN`. The current evidence cannot distinguish whether the pivot is fully baked into the saved matrix or needs a separate parent-aware operation.

## T6 — Simultaneous parent and child tweens

In the target, both parent and child have motion spans at the same keys: 0, 5, 10, 15, and 20. Each child/parent interval is five frames, their progress is aligned, and the child’s parent identity does not change across the keys. Model B computes parent and child-relative interpolation at that shared progress.

The 14-file local corpus contains 12 uniquely mapped child layers with stable parent identity. Across 48 mapped child motion spans, 48 have an aligned parent motion span; the census found no misaligned or non-motion parent span, no parent-held/child-tween span, and no child-held/parent-tween span. This is a result for the available corpus only. It does not authorize arbitrary span misalignment, reparenting within a tween, or held/tween combinations.

## T7 — External implementation comparison

The pinned [`lifeart/fla-viewer` renderer](https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/renderer.ts) resolves a normal-layer parent, evaluates the parent’s current world matrix recursively, rebases both child tween endpoints using inverse parent matrices, interpolates in parent space, and composes the current parent transform. Its held-child branch applies the current parent transform to the child’s stored parent-relative offset. This is Model B for tweened children.

Its [`layer-utils.ts`](https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/layer-utils.ts) only treats normal-to-normal layer links as rig parents, and its tests cover synthetic tween, chain, cycle, and boundary cases. But the renderer’s parser reads `parentLayerIndex` from `DOMLayer` for layer/mask relationships; it does not read the target’s frame-level `DOMFrame.parentLayerIndex` or `layerRiggingIndex`. It therefore does not run the target fixture through the same serialization path.

There is also an evidence-provenance conflict: current master test comments call “The Weird Al Show - Intro.fla” an empirical source, but the checked-in tests construct synthetic display lists and the repository contains no matching FLA. The original [PR #48 description](https://github.com/lifeart/fla-viewer/pull/48) says the formula was based on Adobe documentation/forum reports, not a real parented FLA, and asks for real-file verification. Treat the renderer as `SOURCE_CODE` and its tests as synthetic test evidence, not as Adobe runtime truth for `com26`.

## T8 — Bounded reconstruction prototype

The prototype family is limited to the two `com26` pairs: a stable frame-level parent value; one unique same-timeline rigging-index candidate; visible normal/default layers; one visible Graphic per key; aligned, five-frame motion spans; and no guide/folder/mask/camera relationship. It computes F1–F4 in every span for each pair and retains exact F0/F5/F10/F15/F20 key matrices.

The two final harness runs produced byte-identical JSON and receipt hashes. The source, control, and all 14 corpus FLA hashes were unchanged. No research SVG/PNG was made because there is no Adobe render to compare against; generated pictures would not add ground truth.

## T9 — Minimal Panda seam

If external truth confirms Model B and the mapping/pivot contract, use a narrow `FlaRigParentComposer`, not a generic animation graph.

```text
INPUT:
  resolved same-timeline layer/frame state, per-frame parent identity,
  parent/child authored endpoints, local tween results, and pivot data

OUTPUT:
  parent-aware child symbol instance transform

OWNER:
  focused composer called by the static-snapshot adapter

ORDER:
  frame selection -> local tween reconstruction -> parenting composition
  -> nested/ancestor symbol composition
```

The current adapter is the candidate caller because it has the same-timeline frames and local tween results. Keep the existing fail-closed path until the external contract is established. Do not put frame selection semantics in the nested Graphic loop selector.

## Evidence table and classification

| Field | Result |
| --- | --- |
| Fixture SHA | `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`, unchanged |
| `com26` layer graph | Five normal/default visible layers; two child/parent pairs; complete key matrices and points recorded above |
| Child `parentLayerIndex` | `元件_10=1`, `元件_11=0`, stable at F0/F5/F10/F15/F20 |
| Parent `layerRiggingIndex` | `补间_21=1`, `补间_22=0` |
| Mapping classification | `SERIALIZATION_STRONGLY_INFERRED` |
| Adobe parenting semantics | Per-keyframe parent identity and simultaneous Classic Tweening documented; exact matrix/pivot formula is not |
| Child matrix coordinate space | `UNKNOWN` as Animate rig-space; Panda reads owning-timeline leaf matrices as absolute |
| Parent matrix coordinate space | `UNKNOWN` as Animate rig-space; same Panda parser observation |
| Pivot classification | `UNKNOWN` |
| Model A result | Fails authored endpoint reproduction; max error 165 / 146.894 |
| Model B result | Endpoint max error `2.84e-14`; shared key boundaries continuous by construction |
| External implementation result | Implements Model B, but parser/test evidence does not validate this raw target serialization or fixture |
| Chosen composition model | None selected for production; Model B is a prototype candidate only |
| Prototype endpoint preservation | Yes for Model B, algebraically; not an Animate runtime comparison |
| Prototype deterministic | Yes; JSON SHA-256 `6598fddb661b52694ab373be7d781449b9664d4cc8efaa5ed910e762e8e24e29` and receipt SHA-256 `a1c4a36fa170bf7214d7e503055f049dfd69c38ceb5a608bd381887ff45840ca` match across two final runs |
| Proposed Panda owner/seam | Focused `FlaRigParentComposer` after local tween reconstruction, before nested symbol composition |
| Final classification | **`RIG_PARENTING_EXTERNAL_TRUTH_REQUIRED`** |

## Fail-closed neighbors

This study does not authorize parent changes within a tween, guide/motion-guide links, mask/folder/camera relationships, deeper chains or cycles, malformed or unmatched parent references, scale/skew/flip when the source version is unknown, custom ease/path/orient-to-path, MovieClip or ActionScript behavior, or arbitrary span misalignment and held/tween combinations.

## Validation and scope

- `node --check scripts/research/issue731-rig-parenting-reconstruction.cjs` — PASS.
- `pnpm exec eslint scripts/research/issue731-rig-parenting-reconstruction.cjs` — PASS.
- Harness, run 2 and run 3 — same source/control/corpus hashes; JSON SHA-256 `6598FDDB661...`; receipt SHA-256 `D6BDD109BCD...`.
- `git diff --check` — PASS at delivery.
- Production files changed: **NO**.
- Source/control/corpus FLA mutation: **NO**.
- Full CI / `pnpm verify:project`: **not run**.
- PR #677: **OPEN / Draft**; no Ready/merge action.
