# Issue #729 — Duration 29 + terminal 9728 implementation

## Outcome

**`ROOT_MOTION_DURATION29_PARTIAL_ADVANCE`**

The production adapter now admits duration 29 within the existing explicit,
transform-only family and accepts terminal `keyMode=9728` only in the authorized
non-motion terminal role. The real root F0→F29 tween clears its former adapter
blocker and produces the expected F1, F14, and F28 transforms. Full nested
resolution then stops at a separate duration-5 child tween whose endpoint frames
carry `parentLayerIndex`, metadata that remains outside the bounded adapter
contract. This issue does not authorize that additional metadata, so the work
stops at this partial advance.

## Scope and repository state

- Issue [#729](https://github.com/Cognitive-Architect/panda-stage/issues/729) remains open for owner review.
- Mother PR [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) remains open and Draft.
- Baseline: `0b9a36b365192803ff37fe9e6c7967fe60b94337` on `issue-676-p0-c01-display-list-resolver`.
- The change is limited to the bounded production gate, its unit coverage, and this production revalidation harness/report.
- The source fixture was read-only. No fixture-specific production branch or manually authored frame transform was added.

## R0 — Baseline and production seam

The implementation seam is `isBoundedMotionFramePair()` in
[`fla-static-snapshot-display-list-adapter.ts`](../../src/main/services/fla-static-snapshot-display-list-adapter.ts).
Before the change, the explicit duration set was `{2,3,5,6,14}` and a
non-motion terminal required absent `tweenType` or `tweenType=none`, absent
`motionTweenSnap`, and `keyMode=15872`. The #726 baseline stopped at F1 with
`source metadata falls outside the bounded transform-only subset`.

Files changed for this issue:

- `src/main/services/fla-static-snapshot-display-list-adapter.ts`
- `tests/unit/fla-static-snapshot-display-list-adapter.test.ts`
- `scripts/research/issue729-duration29-root-motion-rerun.cjs`
- `docs/research/issue-729-duration29-terminal9728-implementation.md`

## R1–R2 — Bounded production change

The accepted duration set is now `{2,3,5,6,14,29}`. Duration 29 is the only
new duration; all existing endpoint, identity, transform, and unsupported
metadata checks remain in place.

The terminal keyMode set is `{15872,9728}` only when the terminal frame has
absent/`none` `tweenType` and absent `motionTweenSnap`. A motion start still
requires `tweenType=motion`, `motionTweenSnap=true`, and `keyMode=22017`.
Unknown keyModes, `9728` as a start, and `9728` with an invalid terminal role
remain rejected.

## R3 — Focused coverage and validation

The adapter unit suite adds a duration-29/terminal-9728 positive case and checks
interpolated transforms at F1, F14, and F28. It also checks explicit
`tweenType=none`, duration 30 and 72 rejection, terminal snap/motion-role
rejection, unknown terminal keyMode, start keyMode 9728, easing and MotionPath
metadata, and changed endpoint identity. Existing duration and 15872 terminal
coverage remains in place.

| Check | Result |
| --- | --- |
| Focused adapter unit suite | PASS — 8 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:unit` | PASS — 342 files, 2,431 tests |
| `pnpm test:integration` | PASS — 38 files, 189 tests |
| `pnpm build` | PASS |
| `node --check scripts/research/issue729-duration29-root-motion-rerun.cjs` | PASS |
| `pnpm exec eslint scripts/research/issue729-duration29-root-motion-rerun.cjs` | PASS |
| `git diff --check` | PASS |
| Focused existing Electron verifier | None directly covers this bounded adapter path; the production-path harness below exercises it directly. |
| Full CI / `pnpm verify:project` | Not run, per repository scope rules. |

The integration run and build completed with existing empty CSS import and
chunk-size warnings; neither command failed.

## R4 — Production rerun of `向右走.fla` F0–F29

The harness re-runs every root frame through the production adapter, nested
Graphic selector, and display-list resolver. It repeats each frame and compares
root transforms, nested selections, and display-list hashes.

- Fixture: `D:\表情合集\向右走.fla`
- SHA-256 before and after: `79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098`
- Requested: 30; resolved: 3; blocked: 27.
- Status counts: `AUTHORED=2`, `TWEEN_RECONSTRUCTED=1`, `HELD=0`, `BLOCKED=27`.
- Deterministic repeat: PASS.

| Root frame | Status | Root child transform `(tx,ty)` | Resolved chain before blocker |
| ---: | --- | --- | --- |
| F1 | BLOCKED | `(-276.58965517241376,-299.55)` | `图层转元件_278@1 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@1 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@207` |
| F14 | BLOCKED | `(-162.0551724137931,-299.55)` | `图层转元件_278@14 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@14 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@220` |
| F28 | BLOCKED | `(-38.7103448275862,-299.55)` | `图层转元件_278@28 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com22@28 → 便衣道士-cilisucai.com1/便衣道士-cilisucai.com18@234` |

The first blocker is F1 at `NESTED_SELECTOR`:

```text
Graphic frame 1 requires unsupported motion tween interpolation on layer 1:
source metadata falls outside the bounded transform-only subset
```

The failing child is `便衣道士-cilisucai.com1/便衣道士-cilisucai.com26`,
selected at child frame 1 from a static parent span beginning at frame 206. Its
layer 1 motion span is F0–F4, duration 5, with start and end frames carrying
`tweenType=motion`, `motionTweenSnap=true`, `keyMode=22017`, and
`parentLayerIndex=1`. `parentLayerIndex` is the only disallowed attribute on
both endpoints under the current adapter allowlist. The same bounded-motion
failure recurs at F14 and F28; F28's selected child frame is 7.

No change was made to admit `parentLayerIndex`. That is a new source-metadata
question outside #729's duration-29 and terminal-keyMode authorization.

External evidence output and completion receipt:
`D:\PandaStage-Acceptance\issue729-root-motion-finalized-20261007\`
(`issue729-walk-right-f0-f29.json`, `completion-receipt.txt`).

The reproducible harness is
[`issue729-duration29-root-motion-rerun.cjs`](../../scripts/research/issue729-duration29-root-motion-rerun.cjs).

## Required completion receipt

```text
Issue: Stage B5-R duration29 + terminal9728 bounded root-motion implementation
evidence record: #720
duration authorization: #728
forensics parent: #727
real rerun parent: #726
control: #713
mother PR: #677
baseline: 0b9a36b365192803ff37fe9e6c7967fe60b94337

R0:
actual starting head: 0b9a36b365192803ff37fe9e6c7967fe60b94337
production seam: isBoundedMotionFramePair() in fla-static-snapshot-display-list-adapter.ts
files planned: adapter, focused unit test, production rerun harness, implementation report

R1 duration:
old bounded set: {2,3,5,6,14}
new bounded set: {2,3,5,6,14,29}
arbitrary duration support added: NO

R2 terminal:
old terminal rule: absent/none tweenType + absent motionTweenSnap + keyMode 15872
new terminal rule: absent/none tweenType + absent motionTweenSnap + keyMode 15872 or 9728
9728 accepted as motion start: NO
global keyMode relaxation: NO

R3 tests:
duration29+9728 positive: PASS; F1/F14/F28 transform interpolation
15872 regression: PASS
2/3/5/6/14 regressions: PASS
duration30 negative: PASS
duration72 negative: PASS
9728 invalid-role negatives: PASS
unsupported-metadata negative: PASS
identity negative: PASS
#713 regression: PASS in unit/integration suites
#721/#722/#723/#724/#726 regressions: PASS in unit/integration suites
typecheck: PASS
lint: PASS
unit: PASS; 342 files, 2431 tests
integration: PASS; 38 files, 189 tests
build: PASS
git diff --check: PASS
focused Electron verifier: none directly covers this adapter path; production-path harness run instead
baseline/environment failures: none observed; integration/build emitted existing CSS-import and chunk-size warnings

R4 向右走:
fixture: D:\表情合集\向右走.fla
SHA before: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
SHA after: 79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098
requested: 30
resolved: 3
AUTHORED: 2
TWEEN_RECONSTRUCTED: 1
HELD: 0
BLOCKED: 27
F1 receipt: root@1 -> com22@1 -> com18@207; then com26 child frame 1 is blocked by parentLayerIndex on both duration-5 tween endpoints
F14 receipt: root@14 -> com22@14 -> com18@220; blocked by the same bounded adapter metadata gate
F28 receipt: root@28 -> com22@28 -> com18@234; child frame 7 blocked by the same bounded adapter metadata gate
first blocker: F1 / NESTED_SELECTOR / source metadata falls outside the bounded transform-only subset
deterministic repeat: PASS

R5 classification:
ROOT_MOTION_DURATION29_PARTIAL_ADVANCE

production files changed: YES, bounded adapter gate only
fixture-specific branch: NO
manual frame transforms: NO
source mutation: NO
Full CI manually triggered: NO
PR #677 remains Draft: YES

next single action:
Create a separately scoped research/authorization issue for the exact parentLayerIndex metadata on the nested duration-5 child span; preserve the current strict gate until then.
```
