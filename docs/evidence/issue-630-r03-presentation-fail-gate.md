# Issue #630 / S09-F07 R03: bounded presentation experiment failed

Roadmap #626 · diagnosis #629 · delivery PR #628 · starting branch `issue-627-s09-r01` · actual live starting head `ecbf86b2f0791306c356bf3c2371b77958c7d2c2`. This is a **REPAIR HYPOTHESIS FAILED / NEEDS NEW DIAGNOSIS** receipt, not a performance-repair claim. The experimental production code was removed before handoff; the final commit contains evidence only.

## Experiment and comparison

The first bounded Part A experiment kept one formal `StageRenderer`, one Konva `Stage`, the existing 1920×1080 backing resolution, formal frame evaluation, image-resource session, and readiness logic. It separated the unanimated background into its own internal Konva `Layer`, leaving moving content and subtitle above it in their original z-order. No canvas was hidden, no pixel ratio or easing changed. This was intended to keep unchanged background pixels out of the moving layer's redraw. It did **not** attempt Part B composite-cache repair.

The same R02 schema-valid synthetic A/B/C runner (`pnpm exec electron scripts/diagnose-issue629.cjs`) ran on the same Windows Server 2022 / AspDod-AspIdd virtual-display machine, Electron 43.1.1, 1600×1000 outer / 1586×938 inner window, device scale 1.5, 1920×1080 canvas. Raw event and fixture files: `D:\PandaStage-Acceptance\issue629-N5PcIt\` (`summary.json` and per-scene JSON). R02 baseline raw evidence: `D:\PandaStage-Acceptance\issue629-1wstMB\summary.json`. The runner had already queued B/C when A failed, so those results were collected; no further implementation was performed.

| Scene | R02 rAF median / p95 | Experiment rAF median / p95 | R02 Stage commit median / p95 | Experiment Stage commit median / p95 |
| --- | ---: | ---: | ---: | ---: |
| A: background + ordinary moving image | 99.7 / 106.3 ms | **158.9 / 167.4 ms** | 100.0 / 105.8 ms | **159.1 / 169.7 ms** |
| B: background + composite Character | 102.8 / 112.2 ms | 166.2 / 175.8 ms | 102.7 / 113.9 ms | 164.3 / 174.2 ms |
| C: seven Layers, composite, Mouth, Expression, subtitle, audio | 101.7 / 117.3 ms | 166.6 / 180.6 ms | 102.6 / 113.2 ms | 167.2 / 184.0 ms |

The frozen A gate required rAF median and Stage commit median ≤33.4 ms, and rAF p95 ≤50 ms. It failed by a wide margin and regressed from the R02 baseline. All scenes reported ready/non-degraded. A's paused rAF remained 15.6 ms median and there were no clamped, hidden or unfocused callbacks. During the experimental A run, hiding only the first/background canvas yielded ~100.1 ms rAF median, while hiding the whole Stage yielded 15.7 ms. This is consistent with the remaining visible moving canvas still imposing substantial presentation cost; it does not directly measure a GPU/compositor function. The split added another full-resolution visible canvas and made the total cadence worse. The experiment therefore rejects **this specific static-background layer split** as a sufficient repair on this machine; it does not rule out all possible presentation-plane strategies.

## Gate accounting and safety

- Primary A gate: **FAIL** (158.9 ms median rAF, 159.1 ms median Stage commit, 167.4 ms rAF p95).
- Composite B gate: **NOT ATTEMPTED** after the Part A fail gate. B still showed 36 rebuilds with one unchanged visual signature, median 20.6 ms; the known secondary waste remains.
- C regression gate: **FAIL for the experimental split** (rAF median 166.6 ms vs 101.7 ms baseline). C audio/visual samples were recorded but cannot rescue the failed A/C cadence; no claim of audible smoothness is made.
- Visual correctness, Body+Face/shared opacity, Expression/Mouth/Body/Face Placement invalidation, Layer/subtitle ordering, readiness/fallback/exact capture: the experimental change was **not delivered** and these were not asserted as accepted. The original implementation and contracts remain untouched in the submitted branch.
- Human Windows Electron visual acceptance: **not requested as a passing repair**, because the performance fail gate stopped this implementation before delivery.
- Targeted validation: the experimental source passed `pnpm build` (including typecheck). The Electron A/B/C diagnostic was the decisive check. After removing the failed code, verify with `git diff --check` and the normal build; no manual Full CI, `verify:project`, or historical verifier sweep is warranted. Normal automatic CI may run after this documentation-only commit; report its actual status separately.
- Known unrelated CI failure: R02 run `36282266157` failed in historical `verify:issue579`, whose 0ms Expression assertion conflicts with its own 0ms Expression fixture. This issue does not alter that verifier or formal Expression semantics.

## Handoff

R03 result: **REPAIR HYPOTHESIS FAILED / NEEDS NEW DIAGNOSIS**. Unverified: exact compositor/GPU substage and performance on the owner's physical Windows display. The next single action is owner decision on a focused compositor/GPU trace or separately scoped investigation. Do not broaden #630 into a renderer rewrite, lower resolution, hide the canvas, alter Position timing, or remove composite caching to chase the frozen threshold. PR #628 remains Draft/Open; no merge or Ready action is implied.
