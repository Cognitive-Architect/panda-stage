# Issue #722 — Stage B5-L Corrective: Scene Parent Span Metadata + Validation Closure

- Issue: [#722](https://github.com/Cognitive-Architect/panda-stage/issues/722)
- Parent: [#721](https://github.com/Cognitive-Architect/panda-stage/issues/721) (bounded explicit Graphic Loop)
- Evidence: [#720](https://github.com/Cognitive-Architect/panda-stage/issues/720) · Control: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `8cbe4fe30c49bd4545ea559735cd4f8364ddc17a`
- Scope: close two bounded review findings from #721 — (1) carry `sourceParentSpanTweenType` through the Scene-root path; (2) complete the repository-required validation. **No timing-semantics widening.**

> #721 got the Loop rule right. This corrective wires the Scene "static read-card reader" onto the
> same already-proven contract and finishes the required lint/build matrix. It does **not** touch the
> next wall (missing firstFrame / non-zero origin).

## C1 — Scene metadata propagation

`buildFrameContext()` (the Scene timeline path) carried `sourceParentFrameIndex` and
`sourceParentFrameSpanStart` but **not** `sourceParentSpanTweenType`, so a Scene-owned Graphic
instance could never reach the #721 bounded Loop branch (`sourceParentSpanTweenType !== 'none'` →
`UNSUPPORTED_TIMING` "animated firstFrame").

Change — `src/main/services/fla-static-snapshot-display-list-adapter.ts`, +4 lines:

```ts
sourceParentSpanTweenType: frame.attributes.tweenType ?? 'none',
```

propagated through the same `parseDisplayElements` metadata path the nested Graphic selection uses.

Invariant (verified): static Scene span → selector sees `'none'`; tweened Scene span → selector sees
`'motion'` (never `'none'`); a frame with no `tweenType` attribute defaults to `'none'`.

## C2 — Scene-root bounded regression tests

`tests/unit/fla-nested-graphic-frame-selector.test.ts` (+2), via new `adaptScene` / `sceneRoot` helpers:

- **positive** — Scene root, static authored span, child Graphic `loop="loop" firstFrame="3"`, child
  frameCount 8 → `selectionRule: 'loop-static-first-frame-modulo'`, `selectedChildFrameIndex: 3`.
- **negative** — Scene root, tweened (`tweenType="motion"`) owning span, `loop="loop" firstFrame="1"`
  → `ok: false`, `UNSUPPORTED_TIMING`, message contains `animated firstFrame`.

`tests/unit/fla-static-snapshot-display-list-adapter.test.ts` (+2) asserts the raw metadata directly:
static → `'none'`; tweened → `'motion'` (`!== 'none'`); no-attribute frame → `'none'`.

> Note on the Scene frame model: `buildFrameContext` indexes a layer's authored `DOMFrame` elements by
> array position and uses `frame.attributes.index` as the owning span start. A static Scene layer is a
> single `DOMFrame` (e.g. the real `向右走` Scene is one `index="0" duration="31" keyMode="9728"` frame),
> so `elapsed = parentFrameIndex - spanStart` is `0` at the Scene root and the observable checkpoint is
> `childFrame = F`. The full modulo wrap (`elapsed` 0..402) is already proven on the Graphic-root path in
> #721 — both paths share the exact same `selectAuthoredChildFrame` seam.

## C3 — boundaries preserved

Unchanged / still fail-closed: loop-without-firstFrame on a non-zero containing-span origin (#720 A4
residual), animated/tweened firstFrame beyond the static-span guard, missing-loop multi-frame default,
`duration 29`, `keyMode 9728` as a runtime selector, reverse playback, MovieClip clock, ActionScript,
generic Animate timing runtime. The real `向右走` residual is **not** absorbed.

## C4 — repository validation matrix

| step | command | result |
| --- | --- | --- |
| typecheck | `pnpm typecheck` (via `pnpm build`) | PASS |
| lint | `pnpm lint` | PASS (exit 0) |
| unit | `pnpm test:unit` | 2416 PASS / 1 fail — `fla-import-recovery.test.ts` 5000 ms timeout, **passes 4/4 in isolation** → parallel-resource flake |
| integration | `pnpm test:integration` | 2 files / 9 tests fail — `fla-corpus-collector` (brokered-fs temp `Temp\2\…` ENOENT) + `left-workspace` (spawns `pnpm build`; sandbox blocks `wmic.exe`); **reproduce identically on the stashed `8cbe4fe` baseline** |
| build | `pnpm build` | PASS (typecheck + renderer + electron) |

`git diff --check`: clean.

## C5 — 向右走.fla rerun (read-only)

Same harness (`scripts/research/issue721-walk-right-rerun.cjs`), fresh external directory.

| field | value |
| --- | --- |
| requested / resolved / blocked | 30 / 0 / 30 |
| state counts | `{"BLOCKED": 30}` |
| first blocker | F0 `NESTED_SELECTOR` — *Loop Graphic whose containing span starts at 206 is outside the proven origin boundary* @ `…com18@206/layer-0-frame-206` |
| explicit Loop + firstFrame blocker cleared | **YES** |
| deterministic repeat | PASS |
| source SHA before / after | `79f2cf98…` = `79f2cf98…` (unchanged) |
| outcome | **`LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE`** |

Unchanged from #721 — as expected: the Scene metadata change does not enter the deeper `com18`/`com26`
nesting path. The real `向右走` Scene root is a static single span whose instance is `loop` **without**
firstFrame, so it takes the existing `loop-zero-origin-no-wrap` branch and the new metadata does not
alter its selection.

## Required completion receipt

```text
Issue: #721 bounded corrective — Scene metadata + validation closure
parent: #721
evidence: #720
control: #713
mother PR: #677
baseline: 8cbe4fe30c49bd4545ea559735cd4f8364ddc17a

C1 Scene metadata:
production files changed: src/main/services/fla-static-snapshot-display-list-adapter.ts (+4)
Scene static tween metadata: sourceParentSpanTweenType = frame.attributes.tweenType ?? 'none' -> 'none'
Scene tween metadata: 'motion' (never 'none'); no-attribute frame -> 'none'

C2 tests:
Scene-root positive: static Scene span + loop=loop firstFrame=3 -> loop-static-first-frame-modulo, childFrame 3
Scene-root tween negative: motion Scene span + loop=loop firstFrame=1 -> UNSUPPORTED_TIMING "animated firstFrame"
#721 selector regression: 22/22 PASS (was 20/20)
#713 Play Once regression: PASS
adapter metadata tests: static 'none' / tween 'motion' / no-attr 'none'

C4 validation:
pnpm typecheck: PASS
pnpm lint: PASS
pnpm test:unit: 2416 PASS / 1 fail (fla-import-recovery 5000ms timeout; 4/4 isolated -> flake)
pnpm test:integration: 2 files / 9 tests fail (pre-existing; identical on stashed baseline)
pnpm build: PASS
git diff --check: PASS (clean)
baseline/environment failures: fla-corpus-collector (brokered-fs temp ENOENT),
  left-workspace (pnpm build spawn / wmic.exe sandbox block), fla-import-recovery timeout flake
  — all reproduce on baseline 8cbe4fe; none related to this corrective

C5 向右走 rerun:
source SHA before: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
source SHA after:  79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
requested: 30
resolved: 0
blocked: 30
first blocker: F0 NESTED_SELECTOR "Loop Graphic whose containing span starts at 206 is outside the
  proven origin boundary" @ ...com18@206/layer-0-frame-206
outcome: LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE
deterministic repeat: PASS

missing-firstFrame semantics added: NO
duration29 added: NO
keyMode9728 runtime selector added: NO
Full CI manually triggered: NO
PR #677 remains Draft: YES

final result:
The #721 bounded explicit Loop + static/span-local firstFrame contract is now reachable from BOTH the
Graphic-parent path and the Scene-parent static path. The required validation matrix is accounted for;
the two integration files and one unit timeout are pre-existing environment failures reproduced on the
baseline. The real 向右走.fla evidence still honestly stops at the next #720 A4 blocker
(loop-without-firstFrame on a non-zero span origin).

next single action:
Maintainer rules on the #720 A4 residual (nested loop without firstFrame on a non-zero containing-span
origin, com26 span start 206). It stays fail-closed until independent external truth for the
missing/implied Loop origin semantic is accepted. No further production change is authorized here.
```

## Evidence

- `D:\PandaStage-Acceptance\issue722-b5l-corrective-20261007\after\`
  (`l3-walk-right-rerun.json`, `completion-receipt.txt`)
- Logs: `…\issue722-b5l-corrective-20261007\{_build,_lint,_unit,_integration}.log`

## Next single action

Maintainer decision on the #720 A4 residual exposed since #721. This corrective changes no timing
semantics beyond making the already-proven #721 metadata reachable from the Scene path.
