# Issue #967 AP-REAL-02 review follow-up

Date: 2026-11-04

Follow-up commit: `e5ad405309e67fd73a519e40367e1e7060212fe4`

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
baseline reproduces the failure, classifying it as pre-existing and outside
the AP-REAL-02 loop-retention change. No Issue #607 production fix or assertion
change was made.

The automatic CI run for `e5ad405` was still in progress when this note was
written. No manual full-suite CI run or retry was started.

## Acceptance status

`SOURCE_CAUSE_CONFIRMED` and `SYNTHETIC_PASS` remain. Real com8 / `.fla`
smoothness acceptance remains `OWNER_SMOOTHNESS_FAIL / PENDING_UAT`. PR #967
remains Draft pending independent review and owner UAT.
