# Issue #725 — `com2` childFrameCount census

- Issue: [#725](https://github.com/Cognitive-Architect/panda-stage/issues/725)
- Evidence policy: [#720 A5](https://github.com/Cognitive-Architect/panda-stage/issues/720)
- Latest blocker chain: [#724](https://github.com/Cognitive-Architect/panda-stage/issues/724)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), OPEN / DRAFT
- Baseline and mother PR head at investigation: `f2dbb8cd4ba1b81fd68697d063e555d3ee2c2d27`
- Fixture: `D:\表情合集\向右走.fla`
- Fixture SHA-256 before and after both censuses: `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`

## Result

```text
classification: SINGLE_FRAME_SAFE_CASE
exact Graphic childFrameCount: 1
missing loop implementation: NOT AUTHORIZED BY THIS RESEARCH ISSUE
next step under #720 A5: bounded tiny implementation; Deep Research is not required for this blocker
```

The exact depth-5 blocker is a one-frame Graphic. Under the frozen #720 A5 boundary, every playback mode selects its only child frame, so this instance qualifies for the mode-invariant single-frame safe case. This does not establish a default for missing `loop` on multi-frame Graphics.

## Exact identity and source address

The shared #724 production selector reproduced the missing-loop failure and the same resolved ancestor chain:

```text
图层转元件_278@0
-> 便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@0
-> 便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@206
-> 便衣道士-cilisucai.com1/便衣道士-cilisucai.com26@0
-> 便衣道士-cilisucai.com1/便衣道士-cilisucai.com15@0
-> blocked DOMSymbolInstance at layer 0, authored frame 0, element path [0, 1]
```

Exact selector `sourceAddress`:

```text
nested:nested:nested:nested:issue724-c5:图层转元件_278@0/layer-0-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@0/layer-1-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@206/layer-0-frame-206/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com26@0/layer-4-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com15@0/layer-0-frame-0/0/1
```

The parent XFL node is in `LIBRARY/便衣道士-cilisucai.com1/便衣道士-cilisucai.com15.xml`, at `DOMSymbolItem/timelines/DOMTimeline`, layer 0, authored frame 0, nested group/member indexes `[0, 1]`. That exact `DOMSymbolInstance` references:

```text
便衣道士-cilisucai.com1/便衣道士-cilisucai.com2
```

The child timeline source is `LIBRARY/便衣道士-cilisucai.com1/便衣道士-cilisucai.com2.xml`, at `DOMSymbolItem/timelines/DOMTimeline`. The source node has no explicit `symbolType`; the production adapter classifies the instance as `graphic` using its existing default.

## Census

The exact blocked instance has these authored attributes and parent-span values:

| Field | Authored / production value |
| --- | --- |
| `loop` | Missing |
| `firstFrame` | Missing |
| `lastFrame` | Missing |
| `symbolType` | Attribute missing; production effective type `graphic` |
| Owning parent frame | 0 |
| Owning span start | 0 |
| Owning span `tweenType` | `none` |

The child Graphic has one visible layer (`图层_1`) and one authored `DOMFrame` span:

| Layer | DOMFrame count | Authored index | Authored duration | Production index / duration | End exclusive |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 (`图层_1`) | 1 | `0` | Attribute missing | 0 / 1 | 1 |

The production `frameSpanIndex` derives an effective child timeline length of 1. The `graphicSymbols` descriptor reports `frameCount = 1`, and the nested selector consumes that descriptor value as `childFrameCount = 1`.

## Method and repeatability

[`scripts/research/issue725-com2-childframe-census.cjs`](../../scripts/research/issue725-com2-childframe-census.cjs) follows the #724 source loader and shared production descriptor path:

```text
source FLA
-> recovery classifier / in-memory normalization
-> adaptFlaXflDisplaySource
-> graphicSymbols descriptor + frameSpanIndex
-> prepareFlaNestedGraphicFrameSelections
```

The harness resolved the exact failing `sourceAddress`, rebuilt the parent frame from its production descriptor, matched that address to one production symbol element, then followed its authored XFL path to the raw `DOMSymbolInstance` and child library entry. It independently reopened and censused the source twice; the two complete structural results were identical. Both runs recorded the expected source SHA before and after. Recovery normalization was applied in memory, matching the #724 harness path; the source FLA itself was not written.

External evidence:

```text
D:\PandaStage-Acceptance\issue725-com2-census-20261007-final\com2-childframe-census.json
D:\PandaStage-Acceptance\issue725-com2-census-20261007-final\completion-receipt.txt
```

## Scope and next action

- Production files changed: **NO**
- A5 behavior implemented: **NO**
- Source FLA mutated: **NO**
- Full CI or `pnpm verify:project` run: **NO**
- PR #677: remains OPEN / DRAFT

This census satisfies the #725 success condition. Per #720 A5, the next single action is a bounded implementation of the one-frame mode-invariant safe case under its own scoped authorization. Do not generalize this result to a missing `loop` attribute on multi-frame children; those remain `UNKNOWN_PLAYBACK_DEFAULT` and fail-closed.
