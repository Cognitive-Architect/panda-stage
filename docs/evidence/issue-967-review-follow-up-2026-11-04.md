# Issue #967 AP-REAL-02 review follow-up

Date: 2026-11-04

P2 review follow-up commit: `e5ad405309e67fd73a519e40367e1e7060212fe4`

PR: [#967](https://github.com/Cognitive-Architect/panda-stage/pull/967)

## Review findings addressed

- The Product Preview hook scope key now includes retained animation IDs paired
  with the corresponding SHA-256 values. Because both effects depend on that
  key, a retention-only change updates the session scope. A hook-level
  happy-dom test covers removing a previously retained, ready URL while the
  required asset IDs stay unchanged.
- Loop retention inspects at most 64 frame references per plan and returns a
  sliding window beginning at the current loop frame. Frame-to-asset membership
  is indexed once per immutable animation object in a `WeakMap`, avoiding a
  full frame-ID map on each evaluated frame. Existing Preview and Stage cache
  budgets remain unchanged.
- The guard test uses a 256-frame in-memory animation and checks a 64-frame
  window plus one full membership-index build across two evaluated times. The
  persisted Project schema currently caps animations at 24 frames, so this
  synthetic structure tests the planner's guard against future schema growth;
  it does not represent a currently persistable project.

## Focused validation

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test:unit`: 395 files, 3,183 tests passed.
- `pnpm test:integration -- tests/integration/ap03-animation-image-prewarm.test.ts`:
  6 tests passed.
- `pnpm build`: passed.
- `git diff --check`: passed.

## Same-host Issue #606 verifier comparison

Both runs used Windows, Node `v24.19.0`, pnpm `10.13.1`, and the same focused
command, `pnpm verify:issue606`, with separate acceptance output roots.

| Source | Commit recorded by verifier | Result |
| --- | --- | --- |
| main baseline | `c5da50a7c32f77c01676b4ac0e295ccf3ccda659` | `passed: false` |
| PR #967 head | `e5ad405309e67fd73a519e40367e1e7060212fe4` | `passed: false` |

Both `results.json` files report Issue #607 and the identical error:
`Mouth decode fallback did not return to its requested initial frame.` The
baseline reproduced the failure. This was the pre-fix record, made before the
owner later authorized expanding PR #967 to repair Issue #607.

The automatic CI run for `e5ad405` was still in progress when this note was
written. No manual full-suite CI run or retry was started.

## Acceptance status

`SOURCE_CAUSE_CONFIRMED` and `SYNTHETIC_PASS` remain. Real com8 / `.fla`
smoothness acceptance remains `OWNER_SMOOTHNESS_FAIL / PENDING_UAT`. PR #967 is
Ready for review at user direction; no merge was requested.

## Issue #607 follow-up — authorized scope expansion

The owner authorized repairing the Issue #607 failures through green CI. The
production fix is commit `0831fa0`.

The local Issue #606 verifier exposed a Stage frame-selection mismatch: the
StageRenderer committed a complete display-ready fallback but selected frames
using exact readiness. During Mouth decode failure, the overlay reached 0 ms
while Stage kept the previously committed 15 ms frame. Stage now selects by
`displayReady`; exact `stage-ready` remains false for the degraded frame.

The verifier now includes preview time, play state, scrubber value, Stage state,
and the captured layout baseline in failure evidence. Before taking its
desktop or narrow Preview baseline, it waits for editor geometry to remain
stable for two animation frames. The geometry equality and drawable-canvas
assertions remain unchanged.

Focused validation on the fix:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test:unit`: 395 files, 3,183 tests passed.
- `pnpm test:integration`: 43 files, 210 tests passed.
- `pnpm verify:issue606`: passed; the build and Issue #607 Electron acceptance
  completed. Mouth decode fallback reported Stage time `0`, display-ready
  `true`, exact-ready `false`, visible warning, and expected Body/Expression
  pixels. Desktop and narrow geometry matched their captured baselines.
- `git diff --check`: passed.

The Ready-triggered automatic run `41813226694` remains historical evidence
for the failures before this fix. No post-fix CI run existed when this note was
written; pushing the PR head will trigger the automatic route. No manual Full
CI or `pnpm verify:project` run was started. If CI is red, rerun failed jobs
only.
