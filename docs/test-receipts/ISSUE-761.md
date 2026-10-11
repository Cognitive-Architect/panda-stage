# Issue #761 — FLA static snapshot reliability receipt

Delivery continues on Draft PR #677 and its existing branch
issue-676-p0-c01-display-list-resolver; no stacked PR was opened. The starting
HEAD was 97d1c63. The implementation keeps candidate-list thumbnails bounded
to 160 px, loads a full-resolution image for the focused candidate through the
existing Main/Preview path, serializes preview/commit/cancel transactions, and
preserves the confirmed-preview SHA check before commit. Batch receipts keep
committed results truthful when callbacks or cleanup fail. The default details
no longer show the preview SHA or “预览去重”.

## Validation

- pnpm typecheck — passed.
- pnpm lint — passed.
- pnpm test:unit — 347 files / 2,508 tests passed on the final run. An earlier
  concurrent run hit one 5-second timeout in
  tests/unit/fla-import-recovery.test.ts; that file passed alone and the
  isolated full-suite rerun passed.
- pnpm test:integration — 38 files / 189 tests passed.
- pnpm build — passed. Vite emitted warnings for unchanged empty legacy CSS
  imports and the existing large bundle size.
- Focused FLA unit tests — 2 files / 9 tests passed after adding explicit scan
  cleanup-rejection coverage.
- node --check scripts/verify-issue396-stage-d.cjs and git diff --check —
  passed.

## Windows Electron Stage D

The successful synthetic run used the production Main process and Renderer
with an isolated project. Receipt:

D:\PandaStage-Acceptance\issue761-stage-d-20261011-run04\issue761-stage-d-receipt.json

The 25-candidate scan took 1,460 ms. Cancelling during scan left assets and
revision unchanged. Three rapid focus changes ended on the correct full-size
preview (91 × 177 px; natural dimensions matched the generated dimensions and
exceeded the 160 px thumbnail bound). The default visible details contained no
SHA or “预览去重”; all 81 observed preview Blob URLs were revoked. The
duplicate-group import receipt reported one new asset, one reused asset, zero
failures, and zero unattempted items; the project revision advanced once and
the Asset Library reflected the committed asset.

Top and bottom layout screenshots are in the run's evidence directory:

- D:\PandaStage-Acceptance\issue761-stage-d-20261011-run04\evidence\stage-d-top-target.png
- D:\PandaStage-Acceptance\issue761-stage-d-20261011-run04\evidence\stage-d-bottom-target.png

## Real FLA scan measurement

The production Windows Electron route read the existing
汉服修仙女.fla source (3,264,205 bytes) without modifying it. Its SHA-256
was identical before and after the run:
6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535.

- Candidates scanned: 35.
- Candidate scan time: 235,513 ms (3 min 55.5 sec; about 6.73 sec per candidate).
- Full-resolution preview verified: yes; 15 focused previews were checked, up
  to 1920 × 1080, with natural dimensions matching Main's generated dimensions.
- Project mutation: none; persisted assets remained 0 and revision remained 0.
- Preview resources: all 52 observed Blob URLs were revoked.

Full JSON receipt:

D:\PandaStage-Acceptance\issue761-real-fla-measurement-20261011-run01\issue761-fla-scan-measurement.json

The measured wait is tracked separately in
[Issue #762](https://github.com/Cognitive-Architect/panda-stage/issues/762).
This follow-up profiles the per-candidate cost while preserving the 64-item
budget and current cancellation/security constraints.

## Acceptance status

Engineering checks and automated Windows Electron Stage D evidence passed.
The Panda Stage development window remains running for owner review. No human
visual PASS is claimed; final real-material acceptance remains with the owner.
