# Issue #715 — Stage B5-H / H0 Nested Graphic Timing Research

- Issue: [#715](https://github.com/Cognitive-Architect/panda-stage/issues/715)
- Parents: [#696](https://github.com/Cognitive-Architect/panda-stage/issues/696) / [#701](https://github.com/Cognitive-Architect/panda-stage/issues/701)
- Prerequisites: #713 (ACCEPTED / CLOSED), #714 (NO GENERALIZATION CLAIM)
- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT)
- Baseline head: `da562befcf2c453d1f099a74d389514b2634c7ab`
- Scope executed: **H0 only (research-only). No production behavior changed. H1+ not started.**

> The serial execution contract forbids starting H1 before the maintainer accepts a source-proven
> bounded rule. This document is the H0 evidence and receipt for that acceptance gate.

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

Candidate bounded rule (consistent with the accepted Play-Once offset structure and the accepted
0-based default `firstFrame ?? 0`):

```text
loop + explicit firstFrame -> child = firstFrame + (parentFrameIndex - containingSpanStart)
```

| | value |
| --- | --- |
| mapping rule | `child = firstFrame + elapsed` |
| wrap rule | **not exercised** by the source (`206..235 < 407`) |
| wrap target (0 vs firstFrame) | **UNPROVEN — must stay fail-closed** |
| checkpoints | parentRootFrame 0..29 → child 206..235 (upper bound) |
| result | **GO — no-wrap offset only** |

The wrap rule cannot be proven from these fixtures because no requested frame reaches the child
end. Therefore the smallest safe contract is: accept `loop` + explicit `firstFrame` **only when
`firstFrame + elapsed < childFrameCount`**, and keep wrap fail-closed.

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
| exact requested progression | child == parent (1:1) via `firstFrame + elapsed` |
| interpolation / step | indistinguishable here (per-span ΔfirstFrame == Δparent); the bounded rule uses the span-authored `firstFrame`, never a fractional index |
| composition with Loop | same rule as H0-A |
| result | **GO (bounded, no frame-index interpolation)** |

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
span endpoints are motion keyframes whose `firstFrame` advances — which the new Loop rule (H0-A/H0-C)
explains as a consumed **timing** attribute rather than a transform animation — leaving the
duration (`4`) as the residual bounded blocker.

| | value |
| --- | --- |
| same transform-only family | **yes**, once nested timing is separated |
| result | **GO (bounded extension candidate; evidence-bounded duration set)** |

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
H0 Nested Graphic timing research

Loop + explicit firstFrame:
source case: 便衣道士-cilisucai.com18 (loop=loop, firstFrame=206, childFrameCount=407) inside 便衣道士-cilisucai.com22
child frameCount: 407
mapping rule: child = firstFrame + (parentFrameIndex - containingSpanStart)
wrap rule: not exercised in source (206..235 < 407); wrap target UNPROVEN
checkpoints: parentRootFrame 0..29 -> child 206..235 (upper bound)
result: GO  (no-wrap offset only)

Missing playback mode:
source case: 便衣道士-cilisucai.com2, 便衣道士-cilisucai.com3 (no loop attribute)
source-defined default: NOT FOUND
evidence: every missing-mode child is single-frame -> displayed frame provably 0 (mode-invariant)
result: PARTIAL  (general NO-GO: PLAYBACK_MODE_DEFAULT_UNPROVEN)

Animated firstFrame:
source spans: 便衣道士-cilisucai.com22 root spans 0/3/7/11/15 (一键跑步750_左手动/右手动)
exact requested progression: firstFrame == span start (0,3,7,11,15) -> child == parent 1:1
interpolation/step semantics: per-keyframe authored integer; no frame-index interpolation
composition with Loop: child = firstFrame(span) + elapsed
result: GO

keyMode 9728:
source locations: static DOMFrame keyframes (no tweenType, no motionTweenSnap) in all three files
visual semantic effect: none observed (authored instance drives the visual state)
required for reconstruction: YES (both fixtures' root motion-span terminals use 9728)
result: PARTIAL  (allowlist decision deferred to H1)

duration 29 / 4:
same transform-only family: yes; only duration (+ terminal keyMode 9728) differ
result: GO

BlurFilter guard:
silent-drop confirmed: YES
minimum safe handling: fail-closed or explicit UNSUPPORTED_FILTER fidelity marker
implementation authorized here: NO

overall H0: GO (Loop+firstFrame no-wrap offset; per-keyframe firstFrame; bounded durations)
residuals: wrap UNPROVEN; missing-mode default UNPROVEN; keyMode 9728 meaning undecoded; BlurFilter silent
```

## Gate position

- **H0 complete. H1 not started** — waiting for maintainer acceptance that a source-proven bounded
  timing rule exists (H0-A / H0-C).
- No production file changed; no test/gate lowered; no Full CI triggered.
- Source fixtures byte-identical before/after.

## Evidence

`D:\PandaStage-Acceptance\issue715-h0-20261006\run-1\`

- `h0-a-loop-firstframe.json`, `h0-b-missing-mode.json`, `h0-c-animated-firstframe.json`,
  `h0-d-keymode.json`, `h0-e-durations.json`, `h0-f-filters.json`
- `completion-receipt.txt`, `completion-receipt.json`

Runner: [`scripts/research/issue715-h0-nested-timing-research.cjs`](../../scripts/research/issue715-h0-nested-timing-research.cjs)
(reuses only `dist-electron` production modules; writes outside the repository; never widens a check).

## Next single action

Maintainer decides whether to accept the H0 bounded rules and freeze them (H1). Open residuals to
rule on: nested Loop **wrap** target, missing-mode default, `keyMode 9728` allowlist, and the
`BlurFilter` fidelity guard.
