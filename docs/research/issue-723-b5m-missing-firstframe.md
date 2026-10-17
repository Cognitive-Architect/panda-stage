# Issue #723 — Stage B5-M: Missing Graphic firstFrame → Effective 0 → 向右走 Revalidation

- Issue: [#723](https://github.com/Cognitive-Architect/panda-stage/issues/723)
- Evidence parent: [#720 A4](https://github.com/Cognitive-Architect/panda-stage/issues/720) (BOUNDED_IMPLEMENTATION)
- Implementation parents: [#721](https://github.com/Cognitive-Architect/panda-stage/issues/721) / [#722](https://github.com/Cognitive-Architect/panda-stage/issues/722)
- Control: [#713](https://github.com/Cognitive-Architect/panda-stage/issues/713) · Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `0e9330ced129c24ca24f690627823cc039e92afe`
- Fixture: `D:\表情合集\向右走.fla` — SHA-256 `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`
- Serial plan: M0 seam → M1 bounded fallback → M2 tests/validation → M3 rerun → M4 classification

> 这一刀只补一个已经有外部证据支持的默认值：firstFrame 没写时，运行时按 0 算。
> 源文件「没写」这件事继续保留 —— 不粗暴改成「作者明确写了 0」。

## M0 — Existing seam and the exact residual path

Selector seam (unchanged since #721/#722): `selectAuthoredChildFrame()` in
`src/main/services/fla-nested-graphic-frame-selector.ts`, reached from
`prepareFlaNestedGraphicFrameSelections()`.

- **authored firstFrame presence**: `FlaDisplayListElement.symbol.firstFrame?: string` (`undefined` = attribute
  absent), parsed by `parseFrameIndex()` (strict `^\d+$`). Provenance is *not* lost today; it is only consumed by
  the rule branches.
- **owning-span metadata**: `sourceParentFrameIndex` / `sourceParentFrameSpanStart` and — since #722 —
  `sourceParentSpanTweenType` (`'none'` for a static authored/held span) are carried through
  `parseDisplayElements`; `childFrameCount` comes from the target symbol descriptor.
- **pre-#723 residual branch** (deleted in M1):

  ```ts
  if (mode === 'loop' && element.firstFrame === undefined) {
    if (childFrameCount === 1) return { ... 'loop-single-frame-constant' };
    if (parentSpanStart !== 0) return failure(   // <-- the com26 blocker
      `Loop Graphic whose containing span starts at ${parentSpanStart} is outside the proven origin boundary`);
    if (elapsed >= childFrameCount) return failure(`Loop Graphic wrap is outside the proven boundary …`);
    return { ok: true, frameIndex: elapsed, selectionRule: 'loop-zero-origin-no-wrap' };
  }
  ```

  i.e. a Loop **without** firstFrame was only proven at span origin 0 and only **without** wrap.

- **exact residual (M0 walk of the real fixture)**, root discovered from the Scene
  (`图层转元件_278`, 30 frames; layer-0 span `0..28` is a `motion` tween):

  | depth | symbol @ frame | mode | firstFrame | owning span tween | span start | child frames |
  | --- | --- | --- | --- | --- | --- | --- |
  | 0 | `图层转元件_278@0` | – | – | `motion` | 0 | 30 |
  | 1 | `…com22@0` | `loop` | absent | `motion` | 0 | 30 |
  | 2 | `…com18@206` | `loop` | `206` | `none` | 0 | 407 |
  | 3 | **`…com26@0`** | `loop` | **absent** | `none` | **206** | 21 |
  | 4 | `…com15@0` | `loop` | absent | `motion` | 0 | 1 |
  | 5 | `…com2@0` | **(missing)** | absent | `none` | 0 | 1 |

  The #720 A4 residual is depth 3 (`com26`): explicit forward `loop`, `firstFrame` absent, **static** owning span
  starting at 206. Smallest edit preserving provenance = extend the existing `loop` branch with
  `effectiveFirstFrame = authoredFirstFrame ?? 0` instead of adding a parallel branch.

> **Boundary decision (M0 evidence + #720 A4 wording).** #723's M1 sketch lists "owning span is safe/static for
> this bounded contract". A4's actual gate is *"firstFrame has no unresolved animated/tweened **override** in the
> owning span"* — an **absent** attribute carries no value a tween could animate, so the gate is vacuous for the
> defaulted path, and every M1-B / M2 negative control is scoped to *"animated/tweened **firstFrame**"* (which
> requires an authored firstFrame). Applying the #721 static-span gate to the missing-attribute path would
> fail-closed `com22` (depth 1, `motion` owning span) at root frame 0 — the run would never reach the authorized
> residual, contradicting the issue's own success condition. The gate therefore keeps guarding the **authored**
> firstFrame only; an intermediate variant that applied it to both paths was built, measured and discarded
> (see M3).

## M1 — Bounded fallback (`effectiveFirstFrame = 0`)

`src/main/services/fla-nested-graphic-frame-selector.ts` — one unified `loop` branch replaces both the #721
explicit branch and the old `loop-zero-origin-no-wrap` branch:

```ts
if (mode === 'loop') {
  const firstFrameWasExplicit = element.firstFrame !== undefined;
  const firstFrame = firstFrameWasExplicit ? parseFrameIndex(element.firstFrame) : 0;
  if (firstFrame === null) return failure('UNSUPPORTED_TIMING', 'Loop Graphic requires a valid source-authored firstFrame', …);
  if (firstFrameWasExplicit && element.sourceParentSpanTweenType !== 'none') {
    return failure('UNSUPPORTED_TIMING', 'Loop Graphic with an explicit firstFrame is only proven inside a static authored span; a tweened owning span (animated firstFrame) stays fail-closed', …);
  }
  if (!firstFrameWasExplicit && element.lastFrame === undefined && childFrameCount === 1) {
    return { ok: true, frameIndex: 0, selectionRule: 'loop-single-frame-constant', effectiveFirstFrame: 0 };
  }
  const lastFrame = element.lastFrame === undefined ? childFrameCount - 1 : parseFrameIndex(element.lastFrame);
  … bounds validation (unchanged) …
  return {
    ok: true,
    frameIndex: firstFrame + (elapsed % rangeLength),
    selectionRule: firstFrameWasExplicit ? 'loop-static-first-frame-modulo' : 'loop-missing-first-frame-modulo',
    effectiveFirstFrame: firstFrame,
  };
}
```

Implementation contract checks:

| requirement | status |
| --- | --- |
| fixture-name / symbol-name branch | **none** |
| hard-coded `206` / child count | **none** |
| parent absolute frame used as seed | **NO** (`elapsed = parentFrameIndex - parentSpanStart`) |
| spanStart used as implicit firstFrame | **NO** |
| erase raw authored absence | **NO** — `firstFrame` stays `undefined`; new `firstFrameWasExplicit` boolean + `effectiveFirstFrame` number record the provenance/derivation |
| parallel timing engine | **none** — reuses the #721 modulo selector |
| missing `loop` default | **not added** (A5 stays fail-closed) |
| animated/tweened firstFrame support | **not added** |

`FlaNestedGraphicFrameSelection` gains `firstFrameWasExplicit: boolean` and `effectiveFirstFrame: number`
(the issue's M1-A "preferred data shape", populated at the single selection push site); the rule union drops the
retired `loop-zero-origin-no-wrap` and adds `loop-missing-first-frame-modulo`.

## M2 — Focused tests, negatives and repository validation

`tests/unit/fla-nested-graphic-frame-selector.test.ts` — **27/27 PASS** (was 22).

New/changed under #723:

- **A — missing firstFrame, child 5, static span**: `elapsed 0→0, 1→1, 4→4, 5→0` (`loop-missing-first-frame-modulo`).
- **B — non-zero parent span origin**: `owningSpanStart = 206`, `parent 206→child 0`, `207→1`, `208→2`; asserts
  `effectiveFirstFrame: 0`, `firstFrameWasExplicit: false`, `firstFrame` absent, and `child ≠ 206`.
- **C — explicit firstFrame regression**: #721 `firstFrame=206 / childFrameCount 407` checkpoints unchanged
  (`0→206 … 201→206`, `402→206`).
- **D — provenance**: missing (`firstFrame` key absent, `firstFrameWasExplicit:false`, `effectiveFirstFrame:0`,
  rule `loop-missing-first-frame-modulo`) vs authored `firstFrame="0"` (`firstFrame:'0'`,
  `firstFrameWasExplicit:true`, rule `loop-static-first-frame-modulo`) — bounded-equivalent, provenance distinct.
- **explicit lastFrame as upper bound** for the missing-firstFrame family: `lastFrame="2"` → `0→0, 2→2, 3→0`.
- **negative controls**: malformed missing-firstFrame range (`lastFrame="xyz"`, `lastFrame="9"` outside child) →
  fail-closed; plus the retained `missing loop + multiframe`, `unknown playback mode`, malformed explicit bounds
  and `animated firstFrame on a tween` cases.
- **regressions**: #721 explicit-Loop suite, #722 Scene-root positive + tween negative, #713 Play Once,
  Single Frame, nested Graphic suite. Two pre-#723 negative controls
  (`fails closed when Loop would need an unproven nonzero span origin`, `fails closed instead of inferring a Loop
  wrap`) are superseded by the #723 contract and rewritten as positives (M2 cases A and B).

| step | command | result |
| --- | --- | --- |
| typecheck | `tsc -p tsconfig.json --noEmit` | PASS |
| lint | `pnpm lint` | PASS (exit 0) |
| unit | `pnpm test:unit` | **342 files / 2422 PASS** (no flake this run) |
| integration | `pnpm test:integration` | 2 files / 9 tests fail — `fla-corpus-collector` (brokered-fs temp `Temp\2\…` ENOENT) + `left-workspace` (spawns `pnpm build`; sandbox blocks `wmic.exe`); **reproduce identically on the stashed `0e9330c` baseline** |
| build | `pnpm build` | PASS (typecheck + renderer + electron) |
| whitespace | `git diff --check` | clean |

## M3 — 向右走.fla rerun (read-only, harness `scripts/research/issue723-walk-right-rerun.cjs`)

Root Graphic discovered from the Scene (never hard-coded), all 30 root frames through the shared production path
(`buildGraphicFrameContext → prepareFlaNestedGraphicFrameSelections → resolveFlaDisplayList`).

| field | before (`0e9330c`, #722 evidence) | after (#723) |
| --- | --- | --- |
| requested / resolved / blocked | 30 / 0 / 30 | 30 / 0 / 30 |
| state counts | `{"BLOCKED": 30}` | `{"BLOCKED": 30}` |
| first blocker (F0) | `NESTED_SELECTOR` — *Loop Graphic whose containing span starts at 206 is outside the proven origin boundary* | `NESTED_SELECTOR` — *Nested Graphic playback mode or bounds are outside the proven boundary (loop=(missing), firstFrame=(missing))* |
| target blocker present | yes (`…com18@206/layer-0-frame-206`) | **no — cleared** |
| deterministic repeat | PASS | PASS |
| source SHA before / after | `79f2cf98…` = `79f2cf98…` | `79f2cf98…` = `79f2cf98…` |
| outcome | `LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE` | **`MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE`** |

The post-run first-blocker address is the decisive evidence — it exposes the whole resolved chain, so the
authorized residual is proven **resolved**, not merely skipped:

```text
图层转元件_278@0/layer-0-frame-0/0
-> 便衣道士-cilisucai.com22@0/layer-1-frame-0/0        (loop, firstFrame absent, motion span, origin 0)   ✔
-> 便衣道士-cilisucai.com18@206/layer-0-frame-206/0    (loop, firstFrame=206)                             ✔
-> 便衣道士-cilisucai.com26@0/layer-4-frame-0/0        (loop, firstFrame absent, static span, origin 206) ✔  ← #720 A4 residual
-> 便衣道士-cilisucai.com15@0/layer-0-frame-0/0        (loop, firstFrame absent, childFrameCount 1)       ✔
-> 便衣道士-cilisucai.com2 …                           loop=(missing)  -> FAIL-CLOSED
```

The next real blocker is **depth 5: a Graphic instance with no `loop` attribute** (A5) — explicitly a #723
non-goal ("missing `loop` attribute => default Loop" is not authorized), so it is reported, not absorbed.
`30 / 0 / 30` is unchanged and no 30/30 is claimed.

## M4 — Outcome and roadmap delta

**Outcome: `MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE`** — the bounded residual is removed (the origin-boundary
failure appears in no frame, and `com26` is proven to resolve with `loop-missing-first-frame-modulo`), and a
deeper semantic blocker (A5 missing-`loop`) is exposed. Successful outcome per the issue's M4.

Roadmap delta — upgraded (only this one fact):

```text
Graphic explicit forward Loop
+ missing firstFrame
+ no unresolved animated/tweened firstFrame override in the owning span
-> effectiveFirstFrame = 0
-> PRODUCTION-PROVEN BOUNDED SUPPORT
```

Not upgraded: missing `loop` attribute default, animated/tweened firstFrame interpolation, reverse loop,
MovieClip timing, ActionScript, generic XFL omitted-attribute defaults, `duration 29`, `keyMode 9728` as a
runtime selector, Shape/Gradient work.

## Required completion receipt

```text
Issue: Stage B5-M Missing FirstFrame Bounded Implementation
evidence parent: #720 A4
implementation parents: #721 / #722
control: #713
mother PR: #677
baseline: 0e9330ced129c24ca24f690627823cc039e92afe

M0:
selector seam: src/main/services/fla-nested-graphic-frame-selector.ts :: selectAuthoredChildFrame()
raw firstFrame presence representation: FlaDisplayListElement.symbol.firstFrame?: string (undefined = absent);
  now also surfaced as FlaNestedGraphicFrameSelection.firstFrameWasExplicit / .effectiveFirstFrame
current residual: depth-3 com26 = explicit forward loop + firstFrame absent + STATIC owning span origin 206
  (childFrameCount 21); pre-#723 branch failed closed on parentSpanStart !== 0

M1:
production files changed: src/main/services/fla-nested-graphic-frame-selector.ts (only)
authoredFirstFrame: element.firstFrame (undefined when absent), preserved verbatim
effectiveFirstFrame fallback: authoredFirstFrame ?? 0  (per #720 A4)
firstFrameWasExplicit/provenance: firstFrameWasExplicit = (element.firstFrame !== undefined);
  firstFrame key omitted when absent -> missing != authored "0"
parent absolute frame used as seed: NO
spanStart used as implicit firstFrame: NO
missing-loop support added: NO
animated-firstFrame support added: NO
fixture-specific branch: NO

M2:
positive missing-firstFrame tests: elapsed 0->0, 1->1, 4->4, 5->0 (childFrameCount 5, static span)
non-zero span origin test: owningSpanStart 206 -> parent 206->child 0, 207->1, 208->2 (206 never the child firstFrame)
explicit-firstFrame regression: #721 firstFrame=206 / 407 unchanged (0->206, 201->206, 402->206)
provenance test: missing (no firstFrame key, firstFrameWasExplicit false) vs authored "0" (firstFrame '0', true)
#721/#722 regression: PASS (selector 27/27; Scene-root positive + tween negative retained)
#713 regression: PASS (play-once-relative-containing-span / play-once-hold-last-frame)
typecheck: PASS
lint: PASS
unit: PASS (342 files / 2422 tests)
integration: 2 files / 9 tests fail (pre-existing; identical on stashed 0e9330c baseline)
build: PASS
git diff --check: PASS (clean)
baseline/environment failures: fla-corpus-collector (brokered-fs temp Temp\2\ ENOENT),
  left-workspace (pnpm build spawn / wmic.exe sandbox block) — both reproduce on baseline;
  this run had no unit flake

M3:
fixture: D:\表情合集\向右走.fla
SHA before: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
SHA after:  79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
requested: 30
resolved: 0
AUTHORED: 0
TWEEN_RECONSTRUCTED: 0
HELD: 0
BLOCKED: 30
first blocker frame: F0
first blocker reason: Nested Graphic playback mode or bounds are outside the proven boundary
  (loop=(missing), firstFrame=(missing))  [depth 5 = com2, no loop attribute]
deterministic repeat: PASS

M4 outcome:
MISSING_FIRST_FRAME_CLEARED_PARTIAL_ADVANCE

source mutation: NO
Full CI manually triggered: NO
PR #677 remains Draft: YES

next single action:
Maintainer rules on the newly exposed A5 blocker: a Graphic instance with NO loop attribute
(childFrameCount 1 at depth 5). It stays fail-closed; #723 does not authorize the missing-loop default.
```

## Evidence

- `D:\PandaStage-Acceptance\issue723-b5m-missing-firstframe-20261007\after\`
  (`l3-walk-right-rerun.json`, `completion-receipt.txt`)
- Logs: `…\issue723-b5m-missing-firstframe-20261007\{_build,_lint,_unit,_integration}.log`
- Baseline (before) evidence: `D:\PandaStage-Acceptance\issue722-b5l-corrective-20261007\after\`
  (same production head `0e9330c` = #723 baseline)

## Next single action

Maintainer decision on the A5 residual exposed here (missing `loop` attribute on a single-frame/multi-frame
Graphic). No further production change is authorized by #723.
