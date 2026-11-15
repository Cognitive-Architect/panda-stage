# Issue #1112 checkpoint — paused

2026-11-15. OWNER requested submission before the usage window expires. Work is paused, not complete. The only P1 mother PR is [Draft #1113](https://github.com/Cognitive-Architect/panda-stage/pull/1113); Ready/Merge and human acceptance remain with OWNER.

Baseline: main `04e69581d0b2160d578fdd9a6cc4ce61decf2c13`. Branch: `feat/issue-1112-struct05-p1`. Worktree: `D:\PandaStage-Worktrees\issue-1112-graphic-frame-picker`. The original dirty `D:\panda-stage-main` and previous applications/worktrees were preserved.

Implemented:

- Existing single-image/composite Expressions and Mouth accept Graphic Definition ID + zero-based firstFrame. Legacy image fields remain supported; Graphic defaults omit the image alias.
- Frozen v19 Character/Project/Shot readers, explicit v19→v20 migration, original v19 writer fixture with narrator data, and updated IPC version envelope.
- Existing Expression/Mouth locations have a main Graphic preview and clickable numbered frames, lazy raster loading and 12-frame pages. No persisted thumbnail PNGs or new evaluator/store/history owner.
- Shared single-frame evaluation, visualParts, stable source-canvas placement, local SVG fallback, resource/reference scans, placement, existing history, and Preview mouth recovery are connected.

Evidence collected:

- `pnpm test:unit`: 421 files, 3426 passed. A subsequent small composite-mouth update was checked by the focused Graphic face suite (8 passed); the full suite has not been rerun after that final update.
- `pnpm test:integration`: 46 files, 216 passed, 1 skipped.
- `pnpm build` (includes typecheck) passed after the final code updates. `pnpm lint` passed on the preceding snapshot; the latest lint process was still running when submission began.
- An actual pre-change v19 reader rejected v20 as UnsupportedSchemaVersionError. Its v19 writer produced `tests/fixtures/project-v19-image-face.json`.
- Self-authored four-frame FLA imported through production Preload/Main/parser/Graphic commit. Native UI selection persisted frame 2 as firstFrame=1 and mouth frame 4 as firstFrame=3; Undo/Redo and another Character's independent reference were checked.

Unfinished / not proven:

- The end-to-end product script stopped at Preview seek. It originally acted before the Preview handoff was active; the script now waits for active handoff and stops playback, but this correction has not been rerun. Native Preview/Export pixel comparison and complete runtime Save→Close→Reopen are therefore NOT claimed passing.
- Recheck the final Frame Picker layout and composite product interaction. Human acceptance and OWNER material acceptance are pending; no human PASS is recorded.
- Initial CI on commit `81ba5b7` failed on regressions subsequently fixed locally. New-head natural Core CI still needs review after this checkpoint push. Do not rerun Full CI or a repository-wide verifier sweep.

Local evidence and continuation handles:

- `D:\PandaStage-Acceptance\issue1112-runtime\`: `import.cjs`, `prepare.cjs`, `product.cjs`, generated FLA, `fixture.json`, imported project folders, operation logs/screenshots. These use a self-authored sample and repository demo images/audio; they are not OWNER acceptance.
- `D:\PandaStage-Acceptance\issue1112-{unit,integration,build,lint}.log`.
- Original v19 writer/reader evidence generator: `D:\PandaStage-Acceptance\issue1112-freeze-v19.cjs`.

Resume on this branch/PR. First inspect current Git status, latest lint/CI results and the existing runtime scripts. Continue the corrected product operation through Preview/Export and reopen; fix only directly exposed P1 defects, then return evidence to [Issue #1112](https://github.com/Cognitive-Architect/panda-stage/issues/1112) and hand off the built application for OWNER acceptance.
