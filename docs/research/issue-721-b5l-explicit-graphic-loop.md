# Issue #721 — Stage B5-L / Explicit Graphic Loop + Static firstFrame

- Issue: [#721](https://github.com/Cognitive-Architect/panda-stage/issues/721)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Prerequisites: [#720](https://github.com/Cognitive-Architect/panda-stage/issues/720) (A1 contract freeze, SOURCE/EXTERNAL-PROVEN), [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713) (ACCEPTED)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `0c5ad04eed2aafba2f9fcd3fd5ba94f19bdcbe41`
- Scope executed: **L0 → L4, serial. Production code authorized for the single bounded subset below.**
- Fixture: `D:\表情合集\向右走.fla` (SHA-256 `79f2cf98…`)

> The serial execution contract permits production change only for the frozen `#720 A1` subset:
> **an explicit Loop with an explicit static/span-local firstFrame over a known child range.**
> Every neighbouring semantic (animated/tweened firstFrame, missing-loop multi-frame default,
> generic lastFrame animation, reverse playback, arbitrary modes, MovieClip clock) stays
> fail-closed and is explicitly **not** absorbed here.

## Frozen contract (#720 A1, SOURCE/EXTERNAL-PROVEN)

```text
F = explicit firstFrame
L = explicit lastFrame ?? childFrameCount - 1
e = integer elapsed parent frame (parentFrameIndex - containingSpanStart)
N = L - F + 1
selector: childFrame = F + (e mod N)
validity: 0 <= F <= L < childFrameCount, N > 0, e >= 0
wrap target = firstFrame   (NEVER child frame 0)
```

Real case: `F = 206`, `L = 406`, `N = 201`. Checkpoints `e=0→206, e=1→207, e=29→235,
e=200→406, e=201→206, e=202→207`. Explicit-lastFrame synthetic case `F=3, L=5`: `e=0→3, 1→4,
2→5, 3→3`.

## L0 — Seam identification (no code change)

The single seam responsible for nested Graphic child-frame selection is
[`src/main/services/fla-nested-graphic-frame-selector.ts`](../../src/main/services/fla-nested-graphic-frame-selector.ts),
specifically `selectAuthoredChildFrame(element, childFrameCount)`.

Pre-#721 behaviour recorded:

| playback mode | pre-#721 rule |
| --- | --- |
| `single frame` | `child = firstFrame ?? 0` (constant) |
| `loop`, firstFrame absent, span origin 0 | `child = elapsed` (`loop-zero-origin-no-wrap`) |
| `loop`, firstFrame absent, span origin != 0 | **fail-closed** `UNSUPPORTED_TIMING` |
| `loop`, firstFrame present | **fail-closed** (pre-empted by the `lastFrame !== undefined` guard) |
| `play once` | `child = min(F + elapsed, L)` (`play-once-relative-containing-span` / `play-once-hold-last-frame`) |
| unknown / tween interior | **fail-closed** `UNSUPPORTED_TIMING` / `UNSUPPORTED_TWEEN` |

`elapsed = parentFrameIndex - parentSpanStart`; `parentSpanStart` is the containing parent DOMFrame
span index carried on the element as `sourceParentFrameSpanStart`. The pre-#721 guard
`if (element.lastFrame !== undefined) return failure(...)` fired **before** any mode branch, so no
explicit-lastFrame path existed at all.

## L1 — Implementation (production, 3 files)

The new branch is the **only** code path authorized to consume an authored `lastFrame`, and it is
gated on a **static/span-local firstFrame**.

1. `fla-nested-graphic-frame-selector.ts` — added the `loop-static-first-frame-modulo` selection
   rule and the bounded branch: parse `firstFrame`; require the owning parent span tween type to be
   `'none'` (an animated/tweened owning span → `UNSUPPORTED_TIMING` "animated firstFrame…");
   resolve `lastFrame` (explicit or `childFrameCount - 1`); reject malformed / out-of-range /
   inverted bounds; then `child = F + (elapsed % N)` with the wrap target = `firstFrame`. The old
   unconditional `lastFrame` fail-closed guard is retained **after** this branch (so a `lastFrame`
   outside an explicit Loop still fails closed).
2. `fla-display-list-resolver.ts` — added the optional `sourceParentSpanTweenType?: string` field to
   the `FlaDisplayListElement` `symbol` variant (metadata only).
3. `fla-static-snapshot-display-list-adapter.ts` — carried `sourceParentSpanTweenType` from the
   owning span into every display element: `selection.span.tweenType ?? 'none'` for the authored-frame
   path, `?? 'motion'` for the tween-interior path, and propagated through recursive `DOMGroup`
   parsing. Omitted → `undefined` → not `'none'` → conservative fail-closed.

Guardrails confirmed: no fixture-name or symbol-name branch; no hard-coded `206` / `407`; animated
firstFrame fail-closed; missing-loop multi-frame fail-closed; `keyMode 9728` never used as a
selector; no MovieClip/ActionScript/reverse/generic runtime.

## L2 — Focused tests (all green)

`tests/unit/fla-nested-graphic-frame-selector.test.ts` — **19/19 PASS** (6 new + 1 corrected control):

- `wraps an explicit-Loop static firstFrame range modulo N, targeting firstFrame` — `firstFrame=206`,
  child 407 frames; checkpoints `0→206, 1→207, 29→235, 200→406, 201→206, 202→207, 402→206`.
- `honours an explicit lastFrame as the bounded Loop upper bound` — `firstFrame=3 lastFrame=5`:
  `0→3, 1→4, 2→5, 3→3`.
- `fails closed for a malformed explicit-Loop range` (`it.each`: invalid lastFrame / bounds outside
  child / inverted bounds).
- `keeps an animated firstFrame fail-closed when the owning span is a tween` (asserts the message
  contains `animated firstFrame`).
- `fails closed for a missing loop attribute on a multi-frame Graphic`.
- `keeps Play Once advancing min(F + elapsed, L) across the containing span (#713 regression)`.
- Control: `{ mode: 'loop', firstFrame: '1' }` moved out of the negative matrix to
  `firstFrame: 'not-an-index'` (#721 legalizes loop + a **valid** firstFrame).

Related regression surface: 4 files, **47/47 PASS**
(`fla-nested-graphic-frame-selector`, `fla-static-snapshot-display-list-adapter`,
`fla-display-list-resolver`, `fla-static-snapshot-svg-builder`).

Repository verification (what the repo normally requires — **not** Full CI):

| step | result |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | PASS |
| targeted ESLint (5 changed/new files) | PASS (exit 0) |
| focused unit (4 files) | 47/47 PASS |
| full unit suite | 2411 PASS / 1 fail — `fla-import-recovery.test.ts` **5000 ms timeout**, passes 4/4 in isolation → parallel-resource flake, unrelated domain |
| integration suite | 2 files fail / 9 tests — `fla-corpus-collector.test.ts` (brokered-fs temp `Temp\2\…` ENOENT) and `left-workspace.test.ts` (spawns `pnpm build`; sandbox blocks `wmic.exe`) — **reproduce identically on the stashed baseline** → pre-existing environment failures |
| `build:electron` | PASS (used to produce the L3 evidence) |

## L3 — Revalidation of 向右走 (before / after)

The read-only harness
[`scripts/research/issue721-walk-right-rerun.cjs`](../../scripts/research/issue721-walk-right-rerun.cjs)
re-drives the shared production reconstruction path (`buildGraphicFrameContext` →
`prepareFlaNestedGraphicFrameSelections` → `resolveFlaDisplayList`) over every root frame of
`图层转元件_278` (30 frames). It discovers the root symbol from the Scene (never invented), and reuses
the #713 frame-status model. Deterministic signature includes blocked frames; both runs are repeated
and byte-compared.

Containment chain: Scene → `图层转元件_278` (30f, loop) → `便衣道士-cilisucai.com22` (30f, loop) →
`便衣道士-cilisucai.com18` (407f, **loop, firstFrame=206**).

| | before (pre-#721) | after (#721) |
| --- | --- | --- |
| requested | 30 | 30 |
| resolved | 0 | 0 |
| blocked | 30 | 30 |
| first blocker | F0 `NESTED_SELECTOR` — *Nested Graphic playback mode or bounds are outside the proven boundary (loop=loop, firstFrame=206)* @ `…com22@0/layer-1-frame-0` | F0 `NESTED_SELECTOR` — *Loop Graphic whose containing span starts at 206 is outside the proven origin boundary* @ `…com18@206/layer-0-frame-206` |
| target blocker (`loop=` explicit) present | YES (`targetBlockerFrames=[0]`) | **NO** (`targetBlockerFrames=[]`) |
| explicitLoopBlockerCleared | false | **true** |
| deterministic repeat | PASS | PASS |
| source mutation | NO (byte-identical) | NO (byte-identical) |
| outcome | `LOOP_BLOCKER_NOT_CLEARED` | **`LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE`** |

Interpretation: the explicit `loop=loop, firstFrame=206` blocker **is cleared**. The blocker moved
one nesting level deeper — `com18` now successfully selects child frame 206, and the failure is now
*inside* `com18`'s own timeline, where a further nested instance is `loop` **without** a firstFrame
whose containing span starts at 206 (a non-zero origin). That residual is the **#720 A4 unproven
missing/implied Loop origin semantic**; per the STOP gates it must stay fail-closed and is **not
absorbed here**. Frame 1..28 blockers are the pre-existing ADAPTER motion-tween-interpolation boundary
(identical before/after); frame 29 is the pre-existing non-zero-origin loop boundary (identical
before/after).

## L4 — Roadmap position

Exactly **one** fact is upgraded to production-proven:

> **Explicit Graphic Loop + explicit static/span-local firstFrame over a known child range selects
> `firstFrame + (elapsed mod N)` with the wrap target at `firstFrame`.**

Explicitly **not** upgraded (remain fail-closed / unchanged):

- animated or tweened firstFrame (owning span is a tween);
- missing-loop multi-frame default (the `com26` / non-zero-origin residual);
- generic lastFrame animation outside an explicit Loop;
- reverse playback, arbitrary playback modes, MovieClip autonomous clock, ActionScript;
- `duration 29` graduation, `keyMode 9728` as a selector;
- product playback UI.

## Required completion receipt

```text
Stage B5-L — Explicit Graphic Loop + static firstFrame (issue #721)
baseline head: 0c5ad04eed2aafba2f9fcd3fd5ba94f19bdcbe41
fixture: D:\表情合集\向右走.fla
fixture sha256: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098 (unchanged before/after)

L0 seam: src/main/services/fla-nested-graphic-frame-selector.ts :: selectAuthoredChildFrame
L1 production files changed: 3 (selector, display-list-resolver, display-list-adapter)
   new selection rule: loop-static-first-frame-modulo
   formula: child = F + (elapsed mod N), N = L - F + 1, L = lastFrame ?? childFrameCount - 1
   wrap target: firstFrame (NOT child frame 0)
   gated on static/span-local owning span (sourceParentSpanTweenType == 'none')
L2 focused unit: fla-nested-graphic-frame-selector.test.ts 19/19 PASS
   4-file regression surface: 47/47 PASS
   typecheck: PASS   targeted eslint: PASS
   full unit: 2411 PASS / 1 timeout flake (fla-import-recovery, passes isolated) - unrelated domain
   integration: 2 env-failing files reproduce identically on baseline (pre-existing)
   build:electron: PASS
L3 revalidation (research-only, no production toggle by the script):
   requested frames: 30   resolved: 0   blocked: 30
   before first blocker: F0 NESTED_SELECTOR loop=loop firstFrame=206 @ ...com22@0/layer-1-frame-0
   after  first blocker: F0 NESTED_SELECTOR non-zero loop origin (span start 206) @ ...com18@206/layer-0-frame-206
   explicit loop+firstFrame blocker cleared: YES
   deterministic repeat: PASS (two runs byte-identical)
   source mutation: NO
   outcome: LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE
L4 roadmap: upgraded single fact = explicit Loop + explicit static/span-local firstFrame.
   NOT upgraded: animated firstFrame, missing-loop multi-frame default, generic lastFrame,
   reverse/arbitrary modes, MovieClip clock, ActionScript, duration 29, keyMode 9728, product UI.

residual blocker (NOT absorbed, STOP-gated): loop without firstFrame on a non-zero containing-span
   origin (com26; #720 A4 missing/implied Loop origin) - remains fail-closed.
PR #677: unchanged (OPEN / DRAFT). No PR Ready/merge. No Full CI / pnpm verify:project triggered.
```

## Evidence

- L3 before: `D:\PandaStage-Acceptance\issue721-b5l-walk-right-20261007\before\`
  (`l3-walk-right-rerun.json`, `completion-receipt.txt`)
- L3 after: `D:\PandaStage-Acceptance\issue721-b5l-walk-right-20261007\after\`
  (`l3-walk-right-rerun.json`, `completion-receipt.txt`)
- Full unit log: `…\issue721-b5l-walk-right-20261007\_unit.log`

Runner reuses only `dist-electron` production modules, writes outside the repository, and never
widens a check. Both runs reproduce byte-identically.

## Next single action

Maintainer rules on the **#720 A4 residual** exposed by this slice: a nested `loop` instance with no
`firstFrame` whose containing span starts at a non-zero origin (`com26`, span origin 206). It is the
next blocker beyond the now-cleared explicit-Loop subset and stays fail-closed until independent
evidence for the missing/implied Loop origin semantic is accepted. No further production change is
authorized by #721.
