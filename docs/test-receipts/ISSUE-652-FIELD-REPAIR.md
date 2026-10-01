# Issue #652 — #611 field-acceptance repair receipt

Baseline: PR #628 serial branch `issue-627-s09-r01` at `f31aef9c10cb0eae26987830ba7d733369c3efae`. #651 F001/F002 are the Windows field findings. Human re-check remains pending.

## R01 — Preview close safe area

The Product Preview metadata row now uses a local grid with an explicit inline-end reservation of `--ui-touch-icon + --ui-space-3` for the independent absolute close action. The reservation includes box sizing and remains in force at narrow widths, where range and Speaker Focus flow into separate rows. The existing control labels, state, and visual language are unchanged. `tests/unit/speaker-focus-preview-contract.test.ts` checks the JSX ownership and CSS safe-area/narrow-layout contracts. A real Windows screenshot/interaction re-check is still required before F001 can be marked PASS.

## R02 — bounded decoded Stage source reuse

`StageImageResourceSession` now keeps at most 16 superseded decoded sources per mounted Stage, keyed by rendered part and source URL. A return to a retained source enters the exact desired frame without a second `HTMLImageElement` decode. First-time sources still use the existing pending/atomic-commit readiness gate. Loaded pending resources canceled by a later desired frame can be retained under the same bound; the retained pool is released with the Stage session. No global cache, Camera timer/history, Project write, or schema change was added.

`tests/unit/stage-image-resource-session.test.ts` covers A→B→A reuse, first-time B holding the last complete frame, Body/Face atomicity, finite eviction, session disposal, and A→B→text-only A Camera handoff with Mouth/Expression replacements. Existing Camera tests continue to cover 1.5x, 250 ms, Dialogue winner, Position, Shake exclusion, seek, and fallback semantics. Real-machine A→B→A timing still requires human re-check before F002 can be marked PASS.

## Automated validation

- Focused Stage/Preview/Camera tests: 6 files / 59 tests passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (324 files / 2190 tests), `pnpm test:integration` (37 files / 188 tests), and `pnpm build`: passed.
- `git diff --check`: passed.
- No manual Full CI, `pnpm verify:project`, or repository-wide verifier sweep was run.

This receipt is automated evidence, not a Windows human PASS. #651 F001/F002 should remain VERIFY until the maintainer re-checks the actual Product Preview.
