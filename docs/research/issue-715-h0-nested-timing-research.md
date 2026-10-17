# Issue #715 — Stage B5-H / H0 Nested Graphic Timing Research

- Issue: [#715](https://github.com/Cognitive-Architect/panda-stage/issues/715)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Prerequisites: #713 (ACCEPTED / CLOSED), #714 (NO GENERALIZATION CLAIM)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head (H0): `da562befcf2c453d1f099a74d389514b2634c7ab`
- Baseline head (corrective): `2442e52a8ef7f381fdb87cb0dcc638c382dad5cf`
- Scope executed: **H0 only (research-only). No production behavior changed. H1+ not started.**
- Evidence-strength corrective: [#716](https://github.com/Cognitive-Architect/panda-stage/issues/716) — C1/C2 downgraded GO → PARTIAL, C3 split duration 4 / 29.

> The serial execution contract forbids starting H1 before the maintainer accepts a source-proven
> bounded rule. This document is the H0 evidence and receipt for that acceptance gate.
>
> **#716 calibration:** every conclusion below is stated no stronger than its evidence supports. The
> #716 results supersede the original H0-A / H0-C `GO` labels (both are now `PARTIAL`) and split the
> former joint duration `29/4` claim. Corrected evidence: `D:\PandaStage-Acceptance\issue716-h0-corrective-20261006\run-1\`.

## Fixtures

| | 向右走.fla | 跑步.fla | 人物倒地.fla (#713 control) |
| --- | --- | --- | --- |
| SHA-256 | `79f2cf98…` | `bbcbb479…` | `bad5f00c…` |
| source mutation | none (hash-stable before/after) | none | none |

All three were read through the shared production `dist-electron` modules; nothing was widened,
repaired, or branched by fixture name.

## Containment chains

`向右走`: Scene → `图层转元件_278` (30f, loop) → `便衣道士-cilisucai.com22` (30f, loop) →
`便衣道士-cilisucai.com18` (407f, **loop, firstFrame=206**).

`跑步`: Scene → `便衣道士-cilisucai.com22` (112f, loop) → nested rig instances
(`一键跑步750_左手动/右手动` 16f loop+firstFrame; `便衣道士-cilisucai.com2/3` 1f no loop).

## H0-A — Loop + explicit firstFrame

Source case: `便衣道士-cilisucai.com18`, `loop="loop"`, `firstFrame="206"`, child 407 frames,
sitting in `便衣道士-cilisucai.com22` on a single `[0..29]` static span.

Source-authored evidence:

- `…18`'s own timeline has an authored keyframe boundary at **frame 206**
  (`span [5+201]`, `span [206+201]`), i.e. `firstFrame=206` names a natural authored sub-clip
  boundary inside `…18`, not an arbitrary number.
- Because `…22` is driven 1:1 by the 30-frame root and `…18` is on a span starting at 0, the
  requested parent range for `…18` is root frames 0..29, giving an **upper bound** of child frames
  206..235 — always `< 407`.

Candidate bounded rule (structurally consistent with the accepted Play-Once offset structure and
the accepted 0-based default `firstFrame ?? 0`):

```text
loop + explicit firstFrame -> child = firstFrame + (parentFrameIndex - containingSpanStart)
```

> **Corrective C1 (#716):** the `206..235` checkpoints are generated *by this candidate formula* and
> therefore are **not independent proof** that Animate actually selects those child frames. No
> independent truth was found: the fixture archive contains no rendered/preview frame artifact; the
> existing trusted production selector implements the *same* structural formula for Play Once (so it
> is not independent of the candidate rule); and #703 observed `Loop` `child = elapsed` only for
> `firstFrame`-absent instances and explicitly declined to infer the `firstFrame` index base. The
> result is therefore downgraded.

| | value |
| --- | --- |
| mapping rule (candidate) | `child = firstFrame + elapsed` — source-consistent, **not independently proven** |
| wrap rule | **not exercised** by the source (`206..235 < 407`) |
| wrap target (0 vs firstFrame) | **UNPROVEN — must stay fail-closed** |
| checkpoints | **candidate-derived** (parentRootFrame 0..29 → child 206..235); not independent proof |
| proven | `firstFrame=206` is authored; child has 407 frames; candidate range `[206,235]` does not wrap |
| not proven | the exact Animate Loop child-selection rule; the Loop wrap target |
| result | **PARTIAL — source-consistent bounded candidate** |

The wrap rule cannot be proven from these fixtures because no requested frame reaches the child
end, and the child-selection rule itself is only source-consistent. Therefore the smallest safe
contract would be: treat `loop` + explicit `firstFrame` as a **partial** bounded candidate, accepted
**only when `firstFrame + elapsed < childFrameCount`**, keep wrap fail-closed, and require
independent evidence before upgrading to `GO`.

## H0-B — Missing playback mode

Source case: `便衣道士-cilisucai.com2` and `便衣道士-cilisucai.com3`, referenced by instances whose
only attributes are `libraryItemName` (+ `selected`). No `loop` attribute exists.

| | value |
| --- | --- |
| source-defined default | **NOT FOUND** |
| all missing-mode children | single-frame (`childFrameCount = 1`) |
| conclusion | general default **NO-GO: PLAYBACK_MODE_DEFAULT_UNPROVEN**; but a single-frame child displays its only frame under every mode, so the displayed child frame is **provably 0** (mode-invariant) |
| result | **PARTIAL** — bounded rule only for `childFrameCount === 1` |

The source does not state the intended mode, so no default is invented. The only provable statement
is that the result is mode-invariant for these single-frame children.

## H0-C — Per-keyframe (animated) firstFrame

Source spans (跑步 root `便衣道士-cilisucai.com22`, `一键跑步750_左手动/右手动`):

| containing span | authored firstFrame |
| --- | --- |
| 0 (dur 3) | absent (=0) |
| 3 (dur 4) | 3 |
| 7 (dur 4) | 7 |
| 11 (dur 4) | 11 |
| 15 (static) | 15 |

Authored fact: `firstFrame` equals the containing span start at every keyframe, so
`child = firstFrame(span) + elapsed` reproduces an exact 1:1 parent→child progression — the same
result as the unified Loop rule with a per-keyframe-constant offset. `firstFrame` is a discrete
per-keyframe integer instance property, not a transform scalar; no frame index is interpolated.

| | value |
| --- | --- |
| exact requested progression | child == parent (1:1) via the authored per-span `firstFrame` |
| interpolation / step | **NOT distinguishable here** — `child == parent` holds under stepped, held, or interpolated semantics |
| composition with Loop | same rule as H0-A |
| proven | authored `firstFrame` values `0/3/7/11/15`; the authored per-span value yields a source-consistent 1:1 candidate; no fractional frame index is required |
| unproven | whether Animate treats `firstFrame` as stepped, held, or otherwise updated between authored boundaries; the general animated-firstFrame semantic |
| result | **PARTIAL** |

> **Corrective C2 (#716):** the report already admitted `indistinguishable`, but still returned `GO`.
> Because `child == parent` holds under every competing timing semantics, this corpus cannot
> distinguish them, so the claim is downgraded to `PARTIAL`.

## H0-D — keyMode 9728

Profile of every `DOMFrame` `keyMode` across the three files:

| file | 22017 | 9728 | 15872 |
| --- | --- | --- | --- |
| 向右走 | 26 (all `tweenType=motion`, `motionTweenSnap=true`) | 56 content + 2 empty | 0 |
| 跑步 | 52 (all motion) | 37 content + 1 empty | 0 |
| 人物倒地 (#713) | 55 (all motion) | 24 content + 3 empty | 12 content |

Findings:

- `22017` **always** carries `tweenType="motion"` + `motionTweenSnap="true"` — the motion-tween start marker.
- `9728` and `15872` **never** carry `tweenType` / `motionTweenSnap` — both are **static keyframe markers**, and both occur on content or empty frames.
- `9728` and `15872` **co-occur inside the human-accepted #713 control**, and both appear as root motion-span terminals (向右走/跑步 use `9728`; #713 uses `15872`).
- `9728` is also the scene-root frame marker in all three files, including #713.

The fixtures do **not** decode the exact distinction between 9728 and 15872, and no authoritative
XFL definition was located. The issue explicitly forbids allowlisting 9728 merely because both
fixtures contain it.

| | value |
| --- | --- |
| visual semantic effect | none observed — renderer state comes from the authored instance, not keyMode |
| required for reconstruction | YES (both fixtures' root motion-span terminals use 9728) |
| safe to join accepted terminal family | structurally consistent, but **not proven** |
| result | **PARTIAL — allowlist decision deferred to H1 / maintainer** |

## H0-E — duration 29 / 4 endpoint family

Endpoint audit against the accepted transforms-only family (frame attrs ⊆ accepted set, instance
attrs ⊆ accepted set):

| fixture | span | duration | accepted? | frame attrs outside | instance attrs outside | terminal keyMode | endpoint firstFrame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 向右走 root | 0 | 29 | **no** | none | none | 9728 | — |
| 跑步 root | 0 | 3 | yes | none | none | 22017 | 0 → 3 (motion) |
| 跑步 root | 3 | 4 | **no** | none | none | 22017 | 3 → 7 (motion) |

For 向右走 the **only** divergences from the accepted family are the duration (`29`) and the
terminal `keyMode` (`9728`); all endpoint attributes are inside the accepted set. For 跑步 the
span endpoints are motion keyframes whose `firstFrame` advances — which the candidate Loop rule
(H0-A/H0-C) explains as a consumed **timing** attribute rather than a transform animation — leaving
the duration (`4`) as the residual bounded blocker.

> **Corrective C3 (#716):** duration `4` and duration `29` are not equally evidenced and must be
> judged separately. `duration 4` graduates as a bounded candidate; `duration 29` terminates on the
> undecoded `keyMode 9728` (H0-D) and therefore cannot graduate independently.

| | value |
| --- | --- |
| same transform-only family | **yes**, once nested timing is separated |
| duration 4 (跑步) | **GO** — bounded extension candidate (endpoints inside the accepted family) |
| duration 29 (向右走) | **CONDITIONAL / PARTIAL** — pending the `keyMode 9728` decision |
| reported as one extension? | **no** — the two durations are reported separately |

## H0-F — BlurFilter guard

Real `BlurFilter blurX="6" blurY="6" quality="3"` occurs inside the 1-frame symbols
`便衣道士-cilisucai.com4 / …6 / …15` (both fixtures); the filter sits on the nested
`便衣道士-cilisucai.com3` instance.

The production adapter reads no `<filters>` and the display-list element model has **no filter
field**, so authored-frame filters are **dropped with no fail-closed signal**.

| | value |
| --- | --- |
| silent-drop confirmed | **YES** |
| minimum safe handling | fail-closed, or an explicit PARTIAL/`UNSUPPORTED_FILTER` fidelity marker before any HUMAN PASS |
| implementation authorized here | **NO** |

## H0 required receipt

```text
H0 Nested Graphic timing research (evidence-strength corrected, issue #716)

Loop + explicit firstFrame:
source case: 便衣道士-cilisucai.com18 (loop=loop, firstFrame=206, childFrameCount=407) inside 便衣道士-cilisucai.com22
child frameCount: 407
candidate formula: child = firstFrame + (parentFrameIndex - containingSpanStart)
authored-derived bound: parentRootFrame 0..29 -> candidate child 206..235 (max 235 < 407 -> no wrap)
circular proof removed: YES (per-frame checkpoints are candidate-derived, not independent proof)
independent truth found: NO
proven: firstFrame=206 authored; child has 407 frames; candidate range [206,235] does not wrap
not proven: the exact Animate Loop child-selection rule; the Loop wrap target
result: PARTIAL  (source-consistent bounded candidate; wrap target UNPROVEN, must stay fail-closed)

Missing playback mode:
source case: 便衣道士-cilisucai.com2, 便衣道士-cilisucai.com3 (no loop attribute)
source-defined default: NOT FOUND
evidence: every missing-mode child is single-frame -> displayed frame provably 0 (mode-invariant)
result: PARTIAL  (general NO-GO: PLAYBACK_MODE_DEFAULT_UNPROVEN)

Animated firstFrame:
source spans: 便衣道士-cilisucai.com22 root spans 0/3/7/11/15 (一键跑步750_左手动/右手动)
exact requested progression: firstFrame == span start (0,3,7,11,15) -> candidate child == parent 1:1
step vs interpolation: NOT distinguishable in this fixture (child == parent holds under stepped/held/interpolated)
proven: authored firstFrame values 0/3/7/11/15; authored per-span value yields a source-consistent 1:1 candidate; no fractional frame index required
unproven: whether Animate treats firstFrame as stepped/held/updated between authored boundaries; the general animated-firstFrame semantic
result: PARTIAL

keyMode 9728:
source locations: static DOMFrame keyframes (no tweenType, no motionTweenSnap) in all three files
visual semantic effect: none observed (authored instance drives the visual state)
required for reconstruction: YES (both fixtures' root motion-span terminals use 9728)
result: PARTIAL  (allowlist decision deferred to H1)

duration 29 / 4:
duration 4 (跑步): GO bounded candidate (endpoints inside the accepted transform-only family)
duration 29 (向右走): CONDITIONAL (terminates on keyMode 9728, whose meaning is undecoded per H0-D)
separately judged: YES (corrective C3)

BlurFilter guard:
silent-drop confirmed: YES
minimum safe handling: fail-closed or explicit UNSUPPORTED_FILTER fidelity marker
implementation authorized here: NO

overall H0: PARTIAL (loop+firstFrame source-consistent candidate; animated-firstFrame source-consistent candidate; duration 4 bounded GO; duration 29 conditional)
residuals: wrap UNPROVEN; missing-mode default UNPROVEN; keyMode 9728 meaning undecoded; BlurFilter silent; Loop explicit-firstFrame selection rule not independently proven; animated-firstFrame step/held/interpolated not distinguishable
corrective: #716 C1/C2 downgraded GO -> PARTIAL; C3 split duration 4 (GO) from duration 29 (CONDITIONAL)
```

## Gate position

- **H0 complete (evidence-strength corrected by #716). H1 not started** — waiting for maintainer
  acceptance that a source-proven bounded timing rule exists. After the #716 calibration the two
  former `GO` results (H0-A / H0-C) are `PARTIAL` source-consistent candidates, so H1 is **NOT
  authorized** by H0 alone.
- No production file changed; no test/gate lowered; no Full CI triggered.
- Source fixtures byte-identical before/after.

## Evidence

- H0 (original): `D:\PandaStage-Acceptance\issue715-h0-20261006\run-1\`
- H0 (corrected, #716): `D:\PandaStage-Acceptance\issue716-h0-corrective-20261006\run-1\`

Each directory contains `h0-a-loop-firstframe.json`, `h0-b-missing-mode.json`,
`h0-c-animated-firstframe.json`, `h0-d-keymode.json`, `h0-e-durations.json`, `h0-f-filters.json`,
`completion-receipt.txt`, `completion-receipt.json`. The #716 corrective did not overwrite the #715
evidence, and the corrected receipt reproduces deterministically (two runs byte-identical).

Runner: [`scripts/research/issue715-h0-nested-timing-research.cjs`](../../scripts/research/issue715-h0-nested-timing-research.cjs)
(reuses only `dist-electron` production modules; writes outside the repository; never widens a check).

## Next single action

Maintainer reviews the #716-calibrated H0. Open residuals to rule on: nested Loop **wrap** target;
the Loop explicit-`firstFrame` selection rule (independent evidence still required before any `GO`);
the animated-`firstFrame` step/held/interpolated semantic; the missing-mode default; the `keyMode
9728` allowlist; and the `BlurFilter` fidelity guard. H1 remains **not authorized** until H0 is
accepted, and `duration 29` stays `CONDITIONAL` on the `keyMode 9728` decision.
