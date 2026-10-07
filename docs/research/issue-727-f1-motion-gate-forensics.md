# Issue #727 — F1 Root Motion Gate Forensics

**Classification:** `BOUNDED_EXTENSION_CANDIDATE_WITH_KEYMODE`

**Baseline:** `608db0240e3170c9981c21ae60579ad6eca15da3` (#726)

**Mother PR:** [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), still Draft at the checked baseline
**Scope:** read-only research; no production implementation is authorized by this issue.

## Finding

The real F1 rejection is the root Graphic motion span `图层转元件_278`, layer 0 (`图层_1`), from keyframe F0 through the adjacent end keyframe F29. The motion span has duration 29 and resolves both authored endpoint symbols through the production adapter. The two endpoint instances have the same Graphic identity, supported matrices, and supported transformation points. The authored endpoint frames contain no unsupported motion, easing, rotation, filter, color-transform, or shape-tween metadata recognized by the current gate.

The current adapter rejects the pair on exactly two predicates:

1. Duration 29 is outside the accepted set `{2, 3, 5, 6, 14}`.
2. The end keyframe has `keyMode="9728"`. Its `tweenType` and `motionTweenSnap` are absent, so the current non-motion end-state rule requires `keyMode="15872"`.

The current transform interpolator does not read `keyMode`; it interpolates the endpoint matrices successfully at F0, F1, F14, F28, and F29. That demonstrates representability by this linear transform function, but it does not establish what the source authoring/serialization mode `9728` means. The one authorized outcome is therefore a bounded extension candidate requiring source/serializer evidence about `keyMode` before any implementation decision.

## Fixtures and method

The harness used the production recovery classifier, XFL adapter, frame-span index, endpoint parser, and transform interpolator compiled from the baseline. The walk fixture is classified as a recovery candidate and is normalized in memory before archive parsing; the original `.fla` is never written. Hashes below are of the original files before and after both complete census runs.

| Fixture | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `D:\表情合集\向右走.fla` | `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098` | `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098` |
| `D:\表情合集\人物倒地.fla` (#713 accepted control) | `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` | `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` |

The Scene root was discovered from the source and maps to `LIBRARY/图层转元件_278.xml`, a 30-frame Graphic. A direct production request for F1 reproduces the #726 failure:

```text
Graphic frame 1 requires unsupported motion tween interpolation on layer 0: source metadata falls outside the bounded transform-only subset
```

That request fails before nested symbol selection and therefore has no failure `sourceAddress`. Separate production builds of the authored F0 and F29 endpoints each resolve exactly one symbol:

- F0: `issue727-source-address:图层转元件_278@0/layer-0-frame-0/0`
- F29: `issue727-source-address:图层转元件_278@29/layer-0-frame-29/0`

## Exact authored endpoint data

| Field | Start keyframe F0 | End keyframe F29 |
| --- | --- | --- |
| Frame attributes | `index=0`, `duration=29`, `tweenType=motion`, `motionTweenSnap=true`, `keyMode=22017` | `index=29`, `keyMode=9728` |
| Display list | one visible `DOMSymbolInstance` | one visible `DOMSymbolInstance` |
| Library item | `便衣道士-cilisucai.com1/便衣道士-cilisucai.com22` | same |
| Symbol type | `graphic` | `graphic` |
| Instance metadata | `selected=true`, center `(-220, -8.55)`, `loop=loop` | center `(35.5, -8.55)`, `loop=loop` |
| Matrix | `a=d=0.599990844726562`, `tx=-285.4`, `ty=-299.55` | `a=d=0.599990844726562`, `tx=-29.9`, `ty=-299.55` |
| Transformation point | `(139.15, 491.45)` | `(139.15, 491.45)` |

The endpoint instance attributes match after excluding the adapter's documented authoring-only fields `selected` and `centerPoint3D*`. The authored tags and attributes for both complete `DOMFrame` subtrees are preserved in the JSON evidence. There are no unknown endpoint tags, and the unsupported metadata detector finds no matching motion/easing/path/rotation tags or attributes on either endpoint.

## Current bounded-pair gate matrix

This matrix evaluates every current `isBoundedMotionFramePair` condition against the F0/F29 authored pair and records the adjacent production endpoint parse checks used by the investigation.

| Predicate | Result |
| --- | --- |
| Start frame attributes are allowlisted | PASS |
| End frame attributes are allowlisted | PASS |
| Start frame has exactly one `elements` container | PASS |
| End frame has exactly one `elements` container | PASS |
| Span duration belongs to `{2, 3, 5, 6, 14}` | **FAIL — duration 29** |
| Start index equals span start | PASS — 0 = 0 |
| End index equals start plus duration | PASS — 29 = 0 + 29 |
| Start `tweenType` is `motion` | PASS |
| Start `motionTweenSnap` is `true` | PASS |
| Start `keyMode` is `22017` | PASS |
| End `tweenType` is `none`/missing or `motion` | PASS — missing |
| End snap/keyMode matches its outgoing-state family | **FAIL — missing tween/snap with `keyMode=9728`; expected `15872`** |
| Unsupported motion metadata detector is clear on start | PASS |
| Unsupported motion metadata detector is clear on end | PASS |
| Start endpoint has exactly one display element | PASS |
| End endpoint has exactly one display element | PASS |
| Start endpoint is `DOMSymbolInstance` | PASS |
| End endpoint is `DOMSymbolInstance` | PASS |
| Both endpoint instances are visible | PASS |
| Endpoint instance attributes are allowlisted | PASS |
| Endpoint symbol/library identity matches | PASS |
| Both endpoint `symbolType` values are explicitly `graphic` | PASS |
| Present `centerPoint3D*` values are finite | PASS |
| Endpoint instance attributes match except `selected`/`centerPoint3D*` | PASS |
| Matrix and transformation-point structures are supported | PASS |
| Production endpoint source parsing succeeds | PASS |
| Production endpoint transforms are available | PASS |

Result: **25 of 27 predicates pass; only duration and the end keyMode state fail.**

## `keyMode=9728` location and effect

The only `keyMode=9728` frame in the root Graphic timeline is its F29 end keyframe. That occurrence has no authored `duration`, `tweenType`, or `motionTweenSnap`. An archive-wide census found 58 occurrences in `向右走.fla` and 27 in the accepted #713 control fixture; the JSON evidence records every occurrence with source entry, timeline path, layer, frame index, and authored position. The count alone does not establish common semantics because these occurrences belong to different timelines and frame roles.

At the current production boundary, `keyMode` is checked by `isBoundedMotionFramePair` as gate metadata. For a missing/non-motion end `tweenType`, the function accepts only missing `motionTweenSnap` plus `keyMode=15872`; thus F29's `9728` causes the second rejection above. `interpolateFlaLinearMotionTransform` receives only the parsed endpoint matrices and progress value and does not consume `keyMode`.

The exact end state is distinct from every accepted #713 representative: the 2-, 3-, 6-, and 14-frame controls end on motion keyframes with `keyMode=22017`; the 5-frame control ends on a non-motion keyframe with `keyMode=15872`. All five manual pair checks and production interior builds pass.

| #713 control duration | Start → end keyframe | Start / end keyMode | Pair gate | Interior production build |
| ---: | --- | --- | --- | --- |
| 2 | F20 → F22 | `22017 / 22017` | PASS | PASS |
| 3 | F22 → F25 | `22017 / 22017` | PASS | PASS |
| 5 | F25 → F30 | `22017 / 15872` | PASS | PASS |
| 6 | F14 → F20 | `22017 / 22017` | PASS | PASS |
| 14 | F0 → F14 | `22017 / 22017` | PASS | PASS |

## Linear transform checkpoints

The current production interpolator returns a matrix successfully at all requested checkpoints. Scale remains `0.599990844726562` on both axes and `ty=-299.55`; `tx` changes linearly from `-285.4` at F0 to `-29.9` at F29.

| Frame | Progress `t` | `tx` | `ty` | Result |
| ---: | ---: | ---: | ---: | --- |
| F0 | 0 | -285.4 | -299.55 | PASS |
| F1 | 0.0344827586 | -276.5896552 | -299.55 | PASS |
| F14 | 0.4827586207 | -162.0551724 | -299.55 | PASS |
| F28 | 0.9655172414 | -38.7103448 | -299.55 | PASS |
| F29 | 1 | -29.9 | -299.55 | PASS |

These results show what the existing linear transform function computes; they are not proof that the FLA authoring mode has linear semantics.

## Classification and next action

**`BOUNDED_EXTENSION_CANDIDATE_WITH_KEYMODE`** — the pair's identity, endpoint structures, and current linear transform calculation are supported, but the span exceeds the accepted duration set and its end keyframe uses a distinct `keyMode`. The next action is bounded source/serializer research to establish the meaning and effect of `keyMode=9728`. Keep production behavior fail-closed until that evidence exists. This research issue does not authorize a duration-29 allowlist, a keyMode allowlist, or an interpolation change.

## Reproduction and receipts

Run the self-contained [read-only harness](../../scripts/research/issue727-f1-motion-gate-forensics.cjs) from the repository root with the two paths and expected hashes shown in the fixture table, and a new output directory outside the repository. The final run wrote:

```text
D:\PandaStage-Acceptance\issue727-f1-forensics-final2-20261007\issue727-f1-motion-gate-forensics.json
D:\PandaStage-Acceptance\issue727-f1-forensics-final2-20261007\completion-receipt.txt
```

The harness completed two complete censuses with identical report SHA-256 `9e3996ef979b7c2135f61f455ec02adf425af6bebb82aa02bdb06ed531a3008c`. `node --check` and targeted ESLint passed. No production source was changed, neither fixture was mutated, and Full CI / `pnpm verify:project` was not run.
