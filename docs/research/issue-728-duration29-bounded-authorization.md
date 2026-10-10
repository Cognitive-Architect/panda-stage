# Issue #728 — Duration 29 bounded authorization

## Decision

**`DURATION29_BOUNDED_IMPLEMENTATION`**

The evidence supports considering duration 29 as one additional member of the existing strict, transform-only classic tween family. The authorization boundary is duration **29 only**, with all current source, endpoint, transform, and metadata guards retained. This research does not change production behavior or authorize arbitrary positive durations.

The next step is a separately scoped implementation issue for duration 29. Issue #728 itself is research-only and remains open for owner review.

## Scope and repository state

- Research baseline: `dde895698a3669603e9a53272f833db9bd0a8982` on `issue-676-p0-c01-display-list-resolver`.
- At the research baseline, mother PR [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) was open and Draft at the baseline head.
- Issue [#728](https://github.com/Cognitive-Architect/panda-stage/issues/728) remains open.
- No production files, allowlists, interpolation code, keyMode handling, or source FLA files were changed.
- The #720 terminal decision is applied as a research overlay only: `keyMode=22017` start → `keyMode=9728` terminal is already bounded terminal support for this strict family. It is not re-investigated here.

## D0 — Real F0–F29 span reconfirmed

Fixture: `D:\表情合集\向右走.fla`

SHA-256 before and after: `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`

Source metadata: Adobe Animate, Windows 21.0 build 35450. Its single `<scripts/>` container is empty.

| Field | Start | End |
| --- | --- | --- |
| Timeline / layer | `图层转元件_278` / layer 0 `图层_1` | same |
| Frame index | 0 | 29 |
| Span duration | 29 | — |
| `tweenType` | `motion` | absent |
| `motionTweenSnap` | `true` | absent |
| `keyMode` | `22017` | `9728` |
| Library identity | `便衣道士-cilisucai.com1/便衣道士-cilisucai.com22` | same |
| Matrix `(a,b,c,d,tx,ty)` | `(0.599990844726562, 0, 0, 0.599990844726562, -285.4, -299.55)` | `(0.599990844726562, 0, 0, 0.599990844726562, -29.9, -299.55)` |

The first requested frame remains F1. The unmodified production request fails there with `source metadata falls outside the bounded transform-only subset`. The #727 census found no easing/custom ease, MotionObject/path, rotation/orient-to-path, filter, color, shape-tween, script, or unknown endpoint-tag extras; matrices and transformation points parse under the existing supported structures.

## D1 — Gate isolation

The original production gate had 27 predicates: 25 passed, while duration membership and the terminal keyMode predicate failed. Applying the already-recorded #720 terminal decision makes 26 predicates pass. The sole remaining failure is:

```text
span duration belongs to accepted set {2,3,5,6,14}
```

Thus the decisive post-keyMode failure list is exactly `[duration-not-in-bounded-set]`. No other transform-only predicate remains unresolved for this span.

## D2 — Comparison with accepted #713 controls

The five accepted controls cover durations 2, 3, 5, 6, and 14. The accepted [#713 timeline census](issue-713-full-timeline-reconstruction.md) records all 55 motion spans using the same bounded transform-only metadata: one visible Graphic target at each endpoint, stable library identity, finite affine matrices, optional finite transformation points, and no easing/path or disallowed motion metadata. The five sampled pairs have matching identity, parseable matrices, clear unsupported-metadata checks, and passing manual gate plus production interior-build checks.

| Duration | Span | Start → end keyMode | Control result |
| ---: | --- | --- | --- |
| 2 | F20 → F22 | 22017 → 22017 | accepted; manual and production interior checks pass |
| 3 | F22 → F25 | 22017 → 22017 | accepted; manual and production interior checks pass |
| 5 | F25 → F30 | 22017 → 15872 | accepted; manual and production interior checks pass |
| 6 | F14 → F20 | 22017 → 22017 | accepted; manual and production interior checks pass |
| 14 | F0 → F14 | 22017 → 22017 | accepted; manual and production interior checks pass |
| **29 target** | **F0 → F29** | **22017 → 9728** | terminal family covered by #720; duration is the only remaining gate failure |

Across the target and controls, endpoint type/count, same-Graphic identity, supported matrices/transformation points, and the production interpolation function align. The target's different terminal keyMode is covered by #720's bounded terminal support. After that decision is applied, the remaining family difference under review is duration alone.

## D3 — Adobe duration semantics

Adobe's [Classic Tween Animation documentation](https://helpx.adobe.com/dk/animate/desktop/animation/classic-tween-animation.html) says changing the number of frames between keyframes retweens those frames; its default rate is constant, while Ease is a separate control. Adobe's archived [Flash CS4 Extending API](https://help.adobe.com/archive/en_US/flash/cs4/flash_cs4_extending.pdf) defines `tweenType="motion"` as interpolation from the current keyframe to the following keyframe, with easing, path, and rotation represented separately.

Together these support the conclusion that changing span length in the target's no-ease, no-path, no-rotation subset changes the number of samples along the same linear transform contract. They do not prove support for arbitrary durations or for classic tween features outside the current strict subset.

## D4 — Longer-span and duration-29 corroboration

1. **Adobe-published longer span:** Adobe's [Classic Tweens tutorial and downloadable sample](https://www.adobe.com/au/learn/animate/web/classic-tweens) includes an Adobe Animate-authored boat Graphic tween of duration 72. Its FLA SHA-256 is `c503025500e6c50f9fc16521744edc6da758c1f7f4d63b75c417f85f4c8ee4c0`. It has the same library identity at both endpoints and `tweenType="motion"`, but also has `keyMode=22273`, `motionTweenOrientToPath=true`, and a `Guide__boat` guide layer. The probe reports that it needed in-memory recovery normalization; the source file itself was read only. This is corroboration that Adobe authors long motion spans, **not** a direct match for the strict target family.
2. **Exact duration-29 fixture:** the primary Adobe Animate Windows fixture above has an exact F0→F29 span and matches the strict transform-only metadata after applying #720.
3. **Public duration-29 authoring corroboration:** a [public JSFL example](https://gist.github.com/hushin/2883195) calls `createMotionTween()` followed by `insertKeyframe(29)`. That places the ending keyframe at zero-based index 29; the example does not include a serialized FLA/XFL file, so it is not treated as an exact serialized-duration fixture.

## D5 — Interpolation invariance

Production computes normalized progress as:

```text
t = (frameIndex - startSpan.index) / startSpan.duration
```

The adapter passes only `progress` to the same `interpolateFlaLinearMotionTransform` used by accepted spans. The interpolator has no duration argument or duration-specific branch. Duration currently appears in the strict membership gate `{2, 3, 5, 6, 14}` and in normalized progress calculation.

| Frame | `t` | Result matrix `(a,b,c,d,tx,ty)` |
| ---: | ---: | --- |
| F0 | 0 | `(0.599990844726562, 0, 0, 0.599990844726562, -285.4, -299.55)` |
| F1 | 0.034482758620689655 | `(0.599990844726562, 0, 0, 0.599990844726562, -276.58965517241376, -299.55)` |
| F7 | 0.2413793103448276 | `(0.599990844726562, 0, 0, 0.599990844726562, -223.72758620689655, -299.55)` |
| F14 | 0.4827586206896552 | `(0.599990844726562, 0, 0, 0.599990844726562, -162.0551724137931, -299.55)` |
| F21 | 0.7241379310344828 | `(0.599990844726562, 0, 0, 0.599990844726562, -100.38275862068966, -299.55)` |
| F28 | 0.9655172413793104 | `(0.599990844726562, 0, 0, 0.599990844726562, -38.7103448275862, -299.55)` |
| F29 | 1 | `(0.599990844726562, 0, 0, 0.599990844726562, -29.9, -299.55)` |

All seven checkpoints succeeded in both complete harness passes and produced identical JSON hashes.

## D6–D7 — Authorization boundary and classification

Keep the existing explicit duration set and all strict guards. A future implementation may add **29 only**, conditional on the same supported transform-only family and the already-accepted start/terminal keyMode families. This research authorizes no other duration and changes no production allowlist.

```text
DURATION29_VS_ACCEPTED_FAMILY_DIFF = duration only
classification = DURATION29_BOUNDED_IMPLEMENTATION
```

## Validation and artifacts

- Deterministic harness: two full runs, identical SHA-256 `190f8988f687b0d74d46bf912fed803b50dadc8775832e9f62d4f37638d5cf04`.
- Fixture SHA before/after: walk-right and accepted-control FLA hashes matched; Adobe sample source hash matched.
- `node --check scripts/research/issue728-duration29-bounded-authorization.cjs`: pass.
- `pnpm exec eslint scripts/research/issue728-duration29-bounded-authorization.cjs`: pass.
- `git diff --check`: pass.
- Production-service diff from #727 baseline: empty.
- Full CI: not triggered.
- External deterministic output and completion receipt: `D:\PandaStage-Acceptance\issue728-duration29-final-20261007\` (`issue728-duration29-bounded-authorization.json`, `completion-receipt.txt`).
- Self-contained evidence harness: [`issue728-duration29-bounded-authorization.cjs`](../../scripts/research/issue728-duration29-bounded-authorization.cjs).

### Required completion receipt

```text
Issue: Stage B5-Q Duration29 Bounded Authorization
evidence record: #720
forensics parent: #727
real rerun parent: #726
control: #713
mother PR: #677
baseline: dde895698a3669603e9a53272f833db9bd0a8982

D0 real span:
fixture: D:\表情合集\向右走.fla
SHA before: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
SHA after: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
start/end: F0 -> F29
duration: 29
first blocked frame: F1

D1 gate isolation:
post-keyMode fail predicates: ["span duration belongs to accepted set {2,3,5,6,14}"]

D2 control comparison:
durations compared: 2, 3, 5, 6, 14
semantic differences: duration only (after applying #720 bounded terminal support)

D3 external evidence:
Adobe Classic Tween docs: changing frame spacing retweens the same keyframes; default rate is constant and Ease is separate.
Adobe Flash CS4 API: motion tween interpolates from current keyframe to following keyframe; easing/path/rotation are separate properties.

D4 duration29 evidence:
Adobe target fixture: exact duration 29, strict transform-only metadata.
Adobe sample: duration 72; path/guide and keyMode 22273 put it outside the target strict subset.
Public JSFL: insertKeyframe(29), but no serialized FLA/XFL supplied.

D5 interpolation:
formula: t = elapsed / duration
duration-specific branch: NO
checkpoints: F0, F1, F7, F14, F21, F28, F29; all successful and deterministic.
deterministic: PASS; two runs, identical SHA-256 190f8988f687b0d74d46bf912fed803b50dadc8775832e9f62d4f37638d5cf04

classification:
DURATION29_BOUNDED_IMPLEMENTATION

production files changed: NO
source mutation: NO
Full CI manually triggered: NO
PR #677 remains Draft: YES

next single action:
Create a separately scoped implementation issue for duration 29 only, retaining all strict transform-only guards.
```
