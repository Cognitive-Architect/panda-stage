# Issue #710 — transformationPoint fail-closed gate

Date: 2026-10-06

Status: **BLOCKED** — the exact-equality rule rejects the primary #709 source at frame 21, while this Issue also requires the accepted frame-21 output to remain unchanged.

Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (existing Draft)

Baseline head: `0fd4630a009a4dc096132bb7e938d9c48a7ed490`

## Required rule

Issue #710 allows bounded matrix interpolation only when both authored `transformationPoint` records are absent or both contain the same finite numeric `x` and `y`. A missing endpoint, changed coordinate, malformed value, or duplicate point structure must fail closed. The Issue prohibits tolerance, normalization, pivot interpolation, and fixture-specific exceptions.

A temporary local implementation followed this rule. Its focused tests covered equal points, both points absent, `(5,7)` to `(9,12)`, one-sided absence, missing and empty coordinates, non-finite and malformed numeric strings, and duplicate point nodes.

## Primary-source evidence

Source: `D:\表情合集\人物倒地.fla`

SHA-256 before and after inspection: `bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d` (unchanged).

The archive was normalized in memory using the existing +54-byte EOCD central-directory-size correction; the source file was not written. The root Graphic has 11 active motion layers in `[20,22)`. Their authored point records are:

| Active layer | Graphic target | Frame 20 point `(x,y)` | Frame 22 point `(x,y)` | Result under Issue #710 |
| ---: | --- | --- | --- | --- |
| 1 | `肌肉男-cilisucai.com11 9` | `(103, 91.1)` | `(103.05, 91.05)` | Changed |
| 2 | `肌肉男-cilisucai.com11 15` | `(27, 7.85)` | `(27, 7.85)` | Equal |
| 3 | `肌肉男-cilisucai.com11 10` | `(-26.8, -54.5)` | `(-26.9, -54.6)` | Changed |
| 4 | `肌肉男-cilisucai.com11 8` | `(blank, -0.05)` | `(blank, -0.05)` | Malformed: empty `x` |
| 5 | `肌肉男-cilisucai.com11 7` | `(-10.25, -40.5)` | `(-10.25, -40.55)` | Changed |
| 6 | `肌肉男-cilisucai.com11 6` | `(14.2, -68.4)` | `(14.2, -68.45)` | Changed |
| 7 | `肌肉男-cilisucai.com11 5` | `(6.3, -40.25)` | `(6.25, -40.25)` | Changed |
| 8 | `肌肉男-cilisucai.com11 4` | `(14.65, -60.3)` | `(14.6, -60.3)` | Changed |
| 9 | `肌肉男-cilisucai.com11 11` | `(blank, blank)` | `(blank, -0.05)` | Malformed: empty `x` and `y` |
| 10 | `肌肉男-cilisucai.com11 16` | `(33.15, 9.8)` | `(33.15, 9.75)` | Changed |
| 11 | `肌肉男-cilisucai.com11 14` | `(12.4, -55.9)` | `(12.35, -55.9)` | Changed |

Thus 8 active layers have changed authored coordinates, 2 contain empty coordinate values, and only 1 has an equal point. The exact rule rejects the first changing motion layer before the root Graphic can resolve frame 21.

## Production-path check

The temporary patch passed:

- focused adapter, interpolator, and SVG-builder tests: **38 passed**;
- `pnpm typecheck`: **passed**;
- `pnpm lint`: **passed**;
- `pnpm build`: **passed**.

The Issue #709 production Electron runner then rejected root frame 21 at active layer 1 with:

```text
Graphic frame 21 requires unsupported motion tween interpolation on layer 1:
source metadata falls outside the bounded transform-only subset
```

The accepted #709 baseline artifacts and receipts remain unchanged under `D:\PandaStage-Acceptance\issue709-tween-20261005\production-run-4`:

| Frame | Accepted PNG SHA-256 |
| ---: | --- |
| 20 | `61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6` |
| 21 | `fcbbf077a1097144a0a0f757c84f0a5ffcbc7664c4ed949b1c9ff8066605f827` |
| 22 | `95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2` |

No new frame-21 output was produced by the temporary patch. The code and test changes were reverted; no production change was committed. #707/#708 controls were not rerun after the primary #709 frame-21 stop condition failed. No CI was run against the temporary patch.

## Related review evidence

Issue #710 says #709 received HUMAN VISUAL PASS. Current repository evidence disagrees: [Issue #709](https://github.com/Cognitive-Architect/panda-stage/issues/709) has no comments, PR #677 has no reviews or comments, and the accepted production-run-4 receipt records `humanVisualReview: PENDING_MAINTAINER`. This report does not infer a visual PASS from the rendered frame alone.

## Required decision

The current acceptance criteria cannot both pass on the primary FLA:

- applying exact fail-closed comparison makes root frame 21 unsupported;
- preserving the accepted #709 frame-21 output requires the production path to continue resolving that same source.

No tolerance, interpolation, or fixture exception is authorized. The temporary implementation was therefore not submitted. The maintainer must reconcile the #710 rule with the required #709 frame-21 control and the conflicting #709 review record before production changes continue.

```text
Issue: #710 transformationPoint fail-closed corrective
parent: #709
mother PR: #677
baseline head: 0fd4630a009a4dc096132bb7e938d9c48a7ed490

both endpoints absent: allowed by focused test
both endpoints present and equal: allowed by focused test
one endpoint absent: rejected by focused test
both endpoints differ: rejected by focused test; (5,7) -> (9,12)
malformed / non-finite / duplicate structures: rejected by focused tests

#709 frame 20 / 21 / 22 after temporary patch:
frame 20: existing accepted artifact unchanged; no post-patch render
frame 21: rejected by production resolver at active layer 1
frame 22: existing accepted artifact unchanged; no post-patch render
#707 / #708 after temporary patch: not rerun after the frame-21 stop gate
CI on temporary patch: not run

source mutation: NO
dynamic pivot interpolation added: NO
fixture-specific branch added: NO
production change submitted: NO

result: BLOCKED — exact pivot comparison rejects the required #709 frame-21 control.
next single action: maintainer reconciles the acceptance criteria and review record.
```
