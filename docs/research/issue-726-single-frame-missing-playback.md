# Issue #726 — missing playback mode, single-frame Graphic

- Issue: [#726](https://github.com/Cognitive-Architect/panda-stage/issues/726)
- Evidence policy: [#720 A5](https://github.com/Cognitive-Architect/panda-stage/issues/720)
- Census: [#725](https://github.com/Cognitive-Architect/panda-stage/issues/725)
- Real-chain corrective: [#724](https://github.com/Cognitive-Architect/panda-stage/issues/724)
- Play Once regression control: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677), OPEN / DRAFT
- Baseline: `8da86fc959477162501b2b92ff341bbaeaad73f6`
- Fixture: `D:\表情合集\向右走.fla`
- Fixture SHA-256 before and after: `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`

## N0 — Existing seam

Before this change, `selectAuthoredChildFrame` rejected a missing playback mode at its final fail-closed branch. `prepareFlaNestedGraphicFrameSelections` obtains `childFrameCount` from the exact `graphicSymbols` descriptor's `frameCount`. The XFL adapter omits the `playbackMode` field when the authored `loop` attribute is absent; the selected-result projection previously collapsed that absence to an empty string.

The #725 blocker was at F0, with this exact selector address:

```text
nested:nested:nested:nested:issue724-c5:图层转元件_278@0/layer-0-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@0/layer-1-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@206/layer-0-frame-206/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com26@0/layer-4-frame-0/0->便衣道士-cilisucai.com1/便衣道士-cilisucai.com15@0/layer-0-frame-0/0/1
```

Its exact child descriptor is `便衣道士-cilisucai.com1/便衣道士-cilisucai.com2`, with production `childFrameCount = 1`; the source omits `loop`, `firstFrame`, and `lastFrame`. The smallest production edit point was the missing-mode branch in `selectAuthoredChildFrame` plus its selection-result provenance projection.

Baseline rerun at `8da86fc` reproduced 30/30 blocked frames; F0 failed with the missing-playback reason above. Baseline receipt and JSON are in:

```text
D:\PandaStage-Acceptance\issue726-baseline-20261007\
```

## N1 — Bounded implementation

`selectAuthoredChildFrame` now handles only an absent mode with one valid child frame by returning child frame 0 and:

```text
selectionRule = mode-invariant-single-frame
selectionBasis = mode-invariant-single-frame
effectiveFirstFrame = 0
```

The selection omits `playbackMode` when the source omitted it, and the prepared display-list instance retains that same absence. No `loop="loop"` value or `firstFrame` value is synthesized. A missing mode with more than one child frame now fails with the explicit `UNKNOWN_PLAYBACK_DEFAULT` code. A zero-frame child remains blocked by the invalid-frame-range guard.

The branch is independent of fixture and symbol names and only runs for effective `graphic` elements, as already enforced by the selector caller. The adapter's existing `symbolType` behavior was not changed.

## N2 — Tests and validation

Focused selector tests cover:

- missing playback + one child frame selects frame 0 and preserves missing `playbackMode` / `firstFrame` provenance;
- missing playback + two child frames returns `UNKNOWN_PLAYBACK_DEFAULT`;
- zero child frames remain blocked;
- explicit Loop, Play Once, and Single Frame on a one-frame child keep their existing selection rules;
- unknown explicit playback remains fail-closed.

The same selector suite also retains the #721, #722, #723, #724, and #713 controls.

| Check | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/fla-nested-graphic-frame-selector.test.ts` | PASS — 35 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:unit` | PASS — 342 files / 2,430 tests |
| `pnpm test:integration` | PASS — 38 files / 189 tests |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| Manual Full CI / `pnpm verify:project` | Not run |

## N3 — Real `向右走.fla` rerun

The shared #724 production-path harness re-ran F0–F29 after the build. Its F0 selection for the exact `com2` sourceAddress is:

```text
playbackMode: absent
childFrameCount: 1
selectedChildFrameIndex: 0
selectionRule: mode-invariant-single-frame
```

The full chain through `com2` now resolves. The 30-frame census found the first remaining blocker at F1; the investigation stops at that boundary:

| Measure | Result |
| --- | ---: |
| Requested | 30 |
| Resolved | 2 |
| Blocked | 28 |
| AUTHORED | 2 |
| TWEEN_RECONSTRUCTED | 0 |
| HELD | 0 |
| BLOCKED | 28 |

First remaining blocker:

```text
frame: F1
stage: ADAPTER
reason: Graphic frame 1 requires unsupported motion tween interpolation on layer 0: source metadata falls outside the bounded transform-only subset
sourceAddress: unavailable (the adapter failed before nested symbol selection)
resolved ancestors: unavailable for the same reason
```

F0 and F29 are AUTHORED and resolve. The rerun is deterministic; the source SHA-256 is unchanged. Evidence:

```text
D:\PandaStage-Acceptance\issue726-after-20261007\l3-walk-right-rerun.json
D:\PandaStage-Acceptance\issue726-after-20261007\completion-receipt.txt
```

## N4 — Outcome and boundary

```text
SINGLE_FRAME_MISSING_PLAYBACK_CLEARED_PARTIAL_ADVANCE
```

The one-frame missing-playback blocker is cleared, and the first remaining blocker is the F1 adapter rejection above. The newly proven production boundary is only:

```text
missing playback mode + effective Graphic + childFrameCount == 1
-> mode-invariant child frame 0
```

Missing playback on multi-frame children remains `UNKNOWN_PLAYBACK_DEFAULT` and fail-closed. No default mode was inferred; no source FLA mutation occurred; PR #677 remains Draft. The next single action is to scope the F1 motion-interpolation blocker separately.
