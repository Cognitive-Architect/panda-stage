# Issue 778 C03 evidence — 2026-10-15

This folder records the bounded Windows Electron evidence for the authorized C03 correction on PR #677. It does not claim owner visual acceptance or parent #775 Gate C acceptance.

## Local Stage D run

Command: `pnpm verify:issue396-stage-d -- --acceptance-root "D:\PandaStage-Acceptance\issue778-stage-d-final7-20261015"`

The [Stage D receipt](stage-d-receipt.json) reports `response.ok: true`; every named response, layout, and deletion check is true. It records 27/27 supported targets, three generated sequence frames, preserved A→B→A selection, keyboard and touch reachability, one newly committed asset plus one exact duplicate reuse, revision advance, and source SHA-256 unchanged. The committed asset count belongs to the disposable verifier project, not the user's project.

Native Windows Electron display scale was 150% (DPR 1.5). The sequence layout was captured at 1186×724 and at a genuinely narrow 787×525 viewport. Receipt reachability was checked at 846×653 and 787×525, including native CDP touch scrolling with the import action visible. Native 125% display scaling was **NOT RUN**.

- [Target list at top](stage-d-targets-top.png) · [target list at bottom](stage-d-targets-bottom.png)
- [Sequence controls, wide](stage-d-sequence-wide.png) · [narrow at top](stage-d-sequence-narrow-top.png) · [narrow after scroll](stage-d-sequence-narrow-scrolled.png)
- [Receipt at 846×653, top](stage-d-receipt-846x653-top.png) · [after touch scroll](stage-d-receipt-846x653-scrolled.png)
- [Receipt narrow, top](stage-d-receipt-narrow-top.png) · [after touch scroll](stage-d-receipt-narrow-scrolled.png)

## Bitmap candidates while thumbnails are pending

The existing contract supports this state; no checkability change was made. The raster candidate is built from parser-validated IR media. When thumbnail URL creation has not finished, it reports preview `checking` while remaining selectable ([candidate construction](../../../../src/renderer/fla-import/fla-workbench-candidates.ts#L175), [focused unit test](../../../../tests/unit/fla-workbench-candidates.test.ts#L255)). The IR schema bounds PNG payload bytes and dimensions ([shared IR schema](../../../../src/shared/fla-import-api.ts#L92)); Main revalidates PNG content, dimensions, and pixel/byte limits before commit ([commit validation](../../../../src/main/services/FlaAssetCommitService.ts#L436)). Thus a pending thumbnail is a presentation-readiness state, not an unverified import payload. Snapshot and sequence candidates still fail closed until their operation-bound previews are verified.

## Before and after

These paired screenshots use the actual supplied FLA for capture-only preview. The source hash remained `86EB123FDD42F1DAC80754C9260B793404072BE70523B41D012598138C35C6D2`; the capture-only run persisted zero assets. The source FLA itself is not included here.

- Wide: [before](before-sequence-wide.png) · [after](after-sequence-wide.png)
- Narrow: [before](before-sequence-narrow.png) · [after](after-sequence-narrow.png)

## Repository validation

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test:unit` — PASS, 351 files / 2,565 tests
- `pnpm test:integration` — PASS, 38 files / 189 tests (completed after renderer changes; subsequent edits were confined to the bounded verifier and its static assertions)
- `pnpm build` — PASS; existing empty legacy CSS imports and a large-chunk warning remain
- `pnpm verify:issue396-stage-d` — PASS by the receipt checks above

GitHub policy CI is triggered by pushing this commit; its run ID will be added to Issue #778 after it completes.

## Remaining review boundary

The S2 progress-schema error is traced read-only in [S2-currentFrameIndex-trace.md](S2-currentFrameIndex-trace.md). It remains unresolved and needs separate owner authorization for a contract fix. PR #677 remains Draft/Open. Stop here for independent review; do not mark #775 Gate C accepted.
