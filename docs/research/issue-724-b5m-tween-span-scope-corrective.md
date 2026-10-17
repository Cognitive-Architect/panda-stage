# Issue #724 — Stage B5-M Corrective: Re-tighten Missing-firstFrame Loop on Tween Owning Spans

- Issue: [#724](https://github.com/Cognitive-Architect/panda-stage/issues/724)
- Parent implementation: [#723](https://github.com/Cognitive-Architect/panda-stage/issues/723) · Evidence: [#720 A4](https://github.com/Cognitive-Architect/panda-stage/issues/720)
- Prior bounded implementations: [#721](https://github.com/Cognitive-Architect/panda-stage/issues/721) / [#722](https://github.com/Cognitive-Architect/panda-stage/issues/722) · Control: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Corrective baseline head: `2f70547c5d207c9d30e9bf807ad98cb68e3b2415`
- Fixture: `D:\表情合集\向右走.fla` — SHA-256 `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`
- Serial plan: C1 selector split → C2 controls → C3 regressions → C4 validation → C5 rerun

> #723 已经把 `com26` 这堵真墙拆掉了，这个成果要保住。现在只把「顺手把 motion span 也一起毕业了」
> 的范围收回来：static 才吃新 modulo；motion 只保留之前已经存在、已经证明不会越界的
> origin=0 / no-wrap 小通道。

## Review finding being corrected

#723 collapsed every Loop case into **one** unified `mode === 'loop'` branch. For an
**explicit** firstFrame it still required `sourceParentSpanTweenType === 'none'`, but for an
**absent** firstFrame it granted the new modulo behaviour even on a **motion/tween** owning
span — and let such an instance consume an authored `lastFrame` through that modulo without
separate evidence. That widened the frozen #723 contract, whose authorized family is
`missing firstFrame + static/span-local owning span`. This corrective removes the widening.

## C1 — Bounded selector split

`src/main/services/fla-nested-graphic-frame-selector.ts` — the single #723 branch is split
back into three explicitly bounded cases, decided in this order:

```ts
if (mode === 'loop') {
  const firstFrameWasExplicit = element.firstFrame !== undefined;
  const owningSpanIsStatic = element.sourceParentSpanTweenType === 'none';

  if (firstFrameWasExplicit) {                       // #721: explicit firstFrame + static span
    … require owningSpanIsStatic; modulo over [F, L = lastFrame ?? childFrameCount-1] …
    return { …, selectionRule: 'loop-static-first-frame-modulo', effectiveFirstFrame: firstFrame };
  }

  if (owningSpanIsStatic) {                          // #723: missing firstFrame + static span
    if (element.lastFrame === undefined && childFrameCount === 1)
      return { …, selectionRule: 'loop-single-frame-constant', effectiveFirstFrame: 0 };
    … modulo over [0, L] …
    return { …, selectionRule: 'loop-missing-first-frame-modulo', effectiveFirstFrame: 0 };
  }

  // #724: missing firstFrame + motion/tween span -> ONLY the legacy bounded path
  if (parentSpanStart !== 0) return failure(`… containing span starts at … is outside the proven origin boundary`);
  if (element.lastFrame !== undefined) return failure(`… lastFrame is not proven inside a tween-owned span: …`);
  const elapsed = parentFrameIndex - parentSpanStart;
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) return failure(`… invalid child timeline range`);
  if (elapsed >= childFrameCount) return failure(`… wrap is outside the proven boundary …`);
  return { ok: true, frameIndex: elapsed, selectionRule: 'loop-zero-origin-no-wrap', effectiveFirstFrame: 0 };
}
```

Behavioural contract:

| sub-case | owning span | result |
| --- | --- | --- |
| explicit firstFrame | static | `loop-static-first-frame-modulo` (#721, unchanged) |
| explicit firstFrame | tween | **fail-closed** (`animated firstFrame`, #721/#722, unchanged) |
| missing firstFrame | static | `loop-missing-first-frame-modulo` / `loop-single-frame-constant` (#723 A4, preserved) |
| missing firstFrame | tween, origin 0, no lastFrame, no wrap | `loop-zero-origin-no-wrap` (**legacy com22 path**) |
| missing firstFrame | tween, non-zero origin | **fail-closed** |
| missing firstFrame | tween, authored lastFrame | **fail-closed** |
| missing firstFrame | tween, wrap required | **fail-closed** |

Implementation checks:

| requirement | status |
| --- | --- |
| fixture-name / symbol-name branch | **none** |
| hard-coded `206` / child count | **none** |
| `#721` explicit-firstFrame formula changed | **NO** |
| generic tween-span missing-firstFrame modulo | **removed** |
| authored lastFrame consumed in a tween-owned path | **NO** |
| provenance erased | **NO** — `firstFrame` stays `undefined`; `firstFrameWasExplicit` / `effectiveFirstFrame` retained |

The rule union re-adds the retired `loop-zero-origin-no-wrap` and keeps
`loop-static-first-frame-modulo` / `loop-missing-first-frame-modulo`.

## C2 — Tween-span controls

`tests/unit/fla-nested-graphic-frame-selector.test.ts` — **30/30 PASS** (was 27; −1 superseded
#723 positive, +4 #724 cases). The `#723` fixture helper `animatedParentFramesMissingFirstFrame()`
is generalised into `motionOwnedMissingFirstFrame({ origin, spanDuration, lastFrame })`.

| control | shape | expectation |
| --- | --- | --- |
| **positive legacy** | tween span, origin 0, `elapsed` 0/1 < child count 4, no lastFrame | `childFrame = elapsed` (`0→0, 1→1`), rule `loop-zero-origin-no-wrap`, `firstFrame` absent, `effectiveFirstFrame` 0 |
| **negative A — wrap required** | tween span, origin 0, child count 4, `elapsed` 4 | fail-closed (`wrap is outside the proven boundary`) |
| **negative B — non-zero origin** | tween span, origin 206 | fail-closed (`span starts at 206`) |
| **negative C — authored lastFrame** | tween span, origin 0, `lastFrame="2"` | fail-closed (`not proven inside a tween-owned span`) |
| **positive static A4** (retained) | static span, origin 206, missing firstFrame | `206→0, 207→1, 208→2`, rule `loop-missing-first-frame-modulo` |

These negatives prove that a missing `firstFrame` does **not** silently graduate the whole
tween-owning-span family: only the pre-existing origin=0/no-wrap path survives.

## C3 — Provenance and prior regressions (all retained)

- missing raw `firstFrame` stays **absent** (`firstFrame` key omitted; `firstFrameWasExplicit:false`);
- authored `firstFrame="0"` remains distinguishable (`firstFrame:'0'`, `firstFrameWasExplicit:true`);
- `effectiveFirstFrame:0` for the authorized static A4 path;
- **#721** explicit-firstFrame modulo unchanged (`firstFrame=206 / childFrameCount 407` checkpoints);
- **#722** Scene-root positive (`loop-static-first-frame-modulo`) + tween negative (`animated firstFrame`) unchanged;
- **#713** Play Once (`relative-containing-span` / `hold-last-frame`) unchanged;
- missing `loop` + multiframe ⇒ fail-closed; unknown playback mode ⇒ fail-closed.

## C4 — Validation

| step | command | result |
| --- | --- | --- |
| typecheck | `tsc -p tsconfig.json --noEmit` | PASS (exit 0) |
| lint | `pnpm lint` | PASS (exit 0) |
| unit | `pnpm test:unit` | **342 files / 2425 PASS** (no flake this run; 2425 = #723's 2422 + 3 net) |
| integration | `pnpm test:integration` | 2 files / 2 tests fail: `asset-metadata-revision-safety` (5000 ms timeout) + `left-workspace` (`Cannot find module 'electron'`) |
| build | `pnpm build` | PASS (typecheck + renderer + electron) |
| whitespace | `git diff --check` | clean |

Baseline / environment failures (reproduced against `2f70547…`):

- `asset-metadata-revision-safety` — **8/8 PASS in isolation** both with and without the #724
  change; the full-parallel failure is a 5000 ms resource-contention timeout (flake).
- `left-workspace` — **fails identically on the stashed `2f70547…` baseline**; the test spawns a
  temp-dir Node script that cannot resolve `electron` inside the sandbox temp (`Temp\2\…`).

Neither is caused by #724; no scope widening. (The full-run failure set varies run to run:
#723 saw `fla-corpus-collector` + `left-workspace`, this run saw `asset-metadata` +
`left-workspace` — both environment classes.)

## C5 — 向右走.fla rerun

Read-only harness `scripts/research/issue724-walk-right-rerun.cjs` (self-contained per-issue copy;
#723 evidence untouched). Root Graphic discovered from the Scene (never hard-coded), all 30 root
frames through the shared production path (`buildGraphicFrameContext → prepareFlaNestedGraphicFrameSelections → resolveFlaDisplayList`).

| field | #723 (baseline `2f70547`) | after (#724) |
| --- | --- | --- |
| requested / resolved / blocked | 30 / 0 / 30 | 30 / 0 / 30 |
| state counts | `{"BLOCKED": 30}` | `{"BLOCKED": 30}` |
| first blocker (F0) | `NESTED_SELECTOR` — *… (loop=(missing), firstFrame=(missing))* | **identical** |
| deterministic repeat | PASS | PASS |
| source SHA before / after | `79f2cf98…` = `79f2cf98…` | `79f2cf98…` = `79f2cf98…` |
| outcome | `MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE` | **`MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE`** |

The `#724` run is byte-identical to `#723` apart from the request-id prefix
(`issue723-m3` → `issue724-c5`). The first blocker's `sourceAddress` exposes the whole resolved
chain, proving `com22` (legacy tween path) and `com26` (static A4 modulo) both still resolve:

```text
图层转元件_278@0/layer-0-frame-0/0
-> 便衣道士-cilisucai.com22@0/layer-1-frame-0/0      (loop, firstFrame absent, MOTION span, origin 0)  ✔ legacy
-> 便衣道士-cilisucai.com18@206/layer-0-frame-206/0  (loop, firstFrame=206)                            ✔ #721
-> 便衣道士-cilisucai.com26@0/layer-4-frame-0/0      (loop, firstFrame absent, STATIC span, origin 206) ✔ #723 A4
-> 便衣道士-cilisucai.com15@0/layer-0-frame-0/0      (loop, firstFrame absent, childFrameCount 1)       ✔ legacy
-> 便衣道士-cilisucai.com2 …                         loop=(missing)  -> FAIL-CLOSED
```

`resolvedAncestors` (recorded in the evidence) = `图层转元件_278@0 → com22@0 → com18@206 → com26@0
→ com15@0`. The next real blocker remains **depth-5 `com2` with a missing `loop` attribute** (A5,
out of scope) — reported, not absorbed.

## Roadmap delta

Upgraded (unchanged from #723, no new graduation):

```text
Graphic explicit forward Loop
+ missing firstFrame
+ static/span-local owning span (sourceParentSpanTweenType === 'none')
-> effectiveFirstFrame = 0
-> PRODUCTION-PROVEN BOUNDED SUPPORT
```

Re-tightened (#724): the same missing-firstFrame modulo is **NOT** granted to a motion/tween
owning span. A tween-owned missing-firstFrame Loop keeps only the pre-existing origin=0/no-wrap
bounded path. Not upgraded: missing `loop` default (A5), animated/tweened firstFrame, tween-span
wrap/non-zero-origin/authored-lastFrame, reverse, MovieClip, ActionScript, generic omitted-attribute
defaults, `duration 29`, `keyMode 9728` as a runtime selector.

## Required completion receipt

```text
Issue: #723 bounded corrective — tween-span scope restoration
parent: #723
evidence: #720
parents: #721 / #722
control: #713
mother PR: #677
baseline: 2f70547c5d207c9d30e9bf807ad98cb68e3b2415

C1 selector:
production files changed: src/main/services/fla-nested-graphic-frame-selector.ts (only)
static missing-firstFrame modulo: preserved (loop-missing-first-frame-modulo; loop-single-frame-constant)
tween legacy origin0/no-wrap path: preserved (loop-zero-origin-no-wrap, rule re-added)
generic tween modulo removed: YES (tween-owned missing-firstFrame no longer reaches modulo)
tween+lastFrame behavior: fail-closed (lastFrame not proven inside a tween-owned span)

C2 tests:
tween wrap negative: PASS (spanDuration 5, elapsed 4 -> wrap is outside the proven boundary)
tween non-zero-origin negative: PASS (origin 206 -> span starts at 206)
tween lastFrame negative: PASS (lastFrame="2" -> not proven inside a tween-owned span)
legacy positive: PASS (origin 0, elapsed 0/1 -> childFrame 0/1, loop-zero-origin-no-wrap)
static A4 positive: PASS (origin 206 -> 206->0, 207->1, 208->2, loop-missing-first-frame-modulo)

C3 regressions:
provenance: INTACT (missing firstFrame stays absent; effectiveFirstFrame 0; explicit "0" distinct)
#721: PASS (explicit-firstFrame modulo 206/407 unchanged)
#722: PASS (Scene-root positive + tween negative unchanged)
#713: PASS (play-once-relative-containing-span / play-once-hold-last-frame)
missing-loop control: PASS (fail-closed); unknown playback mode: PASS (fail-closed)

C4 validation:
typecheck: PASS
lint: PASS
unit: PASS (342 files / 2425 tests)
integration: 2 files / 2 tests fail (pre-existing environment classes; not caused by #724)
build: PASS
git diff --check: PASS (clean)
baseline/environment failures: asset-metadata-revision-safety 5000ms timeout in full parallel run
  (8/8 PASS isolated) + left-workspace electron temp-dir resolution (fails identically on stashed
  2f70547 baseline)

C5 向右走:
SHA before: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
SHA after:  79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
requested: 30
resolved: 0
blocked: 30
com22 path: PASS via legacy loop-zero-origin-no-wrap (resolved ancestor com22@0)
com26 path: PASS via static A4 loop-missing-first-frame-modulo (resolved ancestor com26@0)
first blocker: F0 NESTED_SELECTOR — Nested Graphic playback mode or bounds are outside the
  proven boundary (loop=(missing), firstFrame=(missing))  [depth 5 = com2, no loop attribute]
outcome: MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE
deterministic repeat: PASS

A5 implemented: NO
source mutation: NO
Full CI manually triggered: NO
PR #677 remains Draft: YES

final result:
#723 A4 static capability preserved
+ motion/tween scope re-tightened
+ com22 legacy bounded path preserved
+ com26 still cleared
+ com2 missing-loop still first blocker
+ no new timing semantic graduated

next single action:
Maintainer rules on the A5 blocker (Graphic instance with NO loop attribute at depth 5).
It stays fail-closed; #724 does not authorize the missing-loop default.
```

## Evidence

- `D:\PandaStage-Acceptance\issue724-b5m-corrective-20261007\after\`
  (`l3-walk-right-rerun.json`, `completion-receipt.txt`)
- Logs: `…\issue724-b5m-corrective-20261007\{_build,_lint,_unit,_integration}.log`
- Baseline `before` (identical production head `2f70547` = #723): `…\issue723-b5m-missing-firstframe-20261007\after\`

## Next single action

Maintainer decision on the A5 residual (missing `loop` attribute on a Graphic instance at depth 5).
No further production change is authorized by #724.
