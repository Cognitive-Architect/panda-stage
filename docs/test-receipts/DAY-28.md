# Panda Stage Day 28 / Issues #223, #224, and #226 final receipt

## Identity and status

- Parent execution issue: [#221](https://github.com/Cognitive-Architect/panda-stage/issues/221)
- Rework issue: [#223](https://github.com/Cognitive-Architect/panda-stage/issues/223)
- Zero-delta resize blocker: [#224](https://github.com/Cognitive-Architect/panda-stage/issues/224)
- Exact-adjacency blocker: [#226](https://github.com/Cognitive-Architect/panda-stage/issues/226)
- Pull request: [#222](https://github.com/Cognitive-Architect/panda-stage/pull/222)
- Branch: `agent/day28-dialogue-timing-subtitle-track`
- Baseline: `origin/main@90bb37cb975147ca7d17efdd8d9d00a1993bdd34`
- Canonical task: `new agent task/DAY-28-AGENT-TASK.md`
- Canonical Git tree blob: `cd04c247facf32e068a888bfedc718f36e66b500`
- PR head before rework: `501c8272b63b41caf8e7bfafdf348f119fe3f30b`
- Rework implementation commit: `0141ad25d40b263c60e9f1c3dca54e1fcca73b8e`
- Issue #224 implementation commit: `29729f2030ef9ca4e05850e73799176d17105553`
- Issue #226 implementation commit: `957a7a5d516744b2c1e04cefda501df97dc58bad`
- Human-validated implementation head: `aa4529f607deaba876c96d8dff0f5daf9334cbce`
- Day 26 prerequisite: `e4eeb551721864b0c2f3e2596d35d3d1dc2de323`
- Day 27 prerequisite: `6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`
- Automated/structural status: `PASS`, with the full-repository local lint exception recorded below.
- Maintainer Windows Electron acceptance: `PASS`.
- Overall Day 28 status: `PASS`.

This receipt records the Issue #223 correction, the focused Issue #224/#226 fixes, and the completed real Windows Electron maintainer acceptance for PR #222. Automated Electron verification and CI are recorded separately from human acceptance.

## Issue #224 zero-delta resize blocker

- Root cause: an identical resize boundary still passed through `replaceDialogueTiming()` and `finish()`, changing `updatedAt`; the resulting Project was therefore not equal to the saved Project and produced a fake `Resize dialogue` History command.
- Fix: the shared timing replacement path compares the committed Dialogue `startMs/endMs` with the validated candidate and returns the original Project when both are identical. No History suppression or coordinate special case was added.
- No-op automated evidence: `0–42 → 0–42` returns the same Project and keeps the same editor snapshot, `dirty=false`, `revision=0`, History `0/0`, selection, and playhead.
- Real resize automated evidence: `0–42 → 0–84` produces exactly one `Resize dialogue` command; Undo restores `0–42` and saved state, and Redo restores `0–84` and dirty state.
- Focused regression: dialogue service/store/gesture — 3 files / 32 tests PASS.
- Maintainer Windows Electron re-test: `PASS`. From a saved `0–42 ms`, History `0/0` baseline, click/release on the resize handle with no effective movement kept timing `0–42 ms`, History `0/0`, and saved state unchanged.
- Real pointer follow-up: a non-zero end-boundary resize produced one History command; later a non-zero start-boundary resize changed only `startMs`, kept `endMs` fixed, and Undo/Redo restored the two states correctly.

## Issue #226 exact manual timing blocker

- Root cause: `DialogueInspector.commitTiming()` silently passed manual integer-ms fields through `snapToFrame()` before domain validation, changing `459` and `460` to `458` at 24 FPS and creating a real 1 ms overlap with `[167,459)`.
- Fix: the manual Inspector path now requires non-empty, finite integer milliseconds, clamps those exact integers to shot bounds, and passes them unchanged to `dialogueStore.setTiming()`. Timeline pointer drag/resize snapping is unchanged.
- Automated adjacency evidence: existing A `[167,459)` plus manual B `[459,833)` persists exactly and creates one `Set dialogue timing` History command.
- Automated overlap evidence: manual B `[458,833)` is rejected; Project snapshot, dirty, revision, and History remain unchanged.
- Pointer evidence: the Timeline geometry regression still proves `snapToFrame(459) === 458` and `snapToFrame(460) === 458`, preserving pointer-driven frame snapping.
- Focused regression: Inspector helper, store, service, geometry, and gesture — 5 files / 53 tests PASS.
- Maintainer Windows Electron re-test: `PASS`. With existing A=`167–459 ms`, manual B=`459–833 ms` committed successfully and remained exactly `459–833 ms`. Changing B start to `458 ms` was rejected as overlap; committed timing and History remained unchanged.

## R1-R9 rework ledger

- **R1 — PASS:** `DialogueService.create()` persists one clamped Untimed point (`startMs === endMs`); `createMany()` gives every line the same captured point and the store commits the batch as one History command. Unit tests cover `1200/1200`, both clamps, an eight-line short-shot batch, and one Undo for the batch.
- **R2 — PASS:** only the explicit Untimed-to-Timed action creates a positive span. `integerFrameSpanMs()` derives the integer span from Day 26 `frameDurationMs()` / `snapToFrame()` geometry (42 ms at 24 FPS), passes it to the domain as plain data, backfills at shot end, rejects overlap at commit, and permits adjacency.
- **R3 — PASS:** PR-introduced audio attachment/scheduling and mouth-motion behavior, IPC, services, UI, and tests were removed rather than completed in Day 28.
- **R4 — PASS:** `git diff --name-status origin/main -- src/domain/models src/domain/constants.ts` is empty. No `strokeColor`, `strokeWidth`, schema-version workaround, or other persisted Project-shape expansion remains.
- **R5 — PASS:** `buildDialogueSubtitleCues()` is the single editor/Preview Dialogue-to-cue projection and both consumers call shared `evaluateSubtitleAtTime()`. Boundary and deterministic legacy-overlap winner tests cover before/start/inside/end/adjacency/overlap plus trim and 500-character projection.
- **R6 — PASS:** Timeline renders every Dialogue. Untimed entries use an 18 px non-persisted marker, remain selectable through `dialogueSelectionStore` and the existing RightInspector, and expose the explicit one-frame arrange action. Store tests prove render/selection does not change timing, dirty, revision, or History; arrange is one command.
- **R7 — PASS:** each gesture captures `projectRoot + shotId + dialogueId`; commit rechecks current project, shot, selection, and entity existence. Tests cover project switch, shot switch, deletion, selection change, pointer cancel, Escape/unmount cancellation, and one successful pointerup callback.
- **R8 — PASS:** clip/handle pointer isolation calls preventDefault/stopPropagation while ruler seeking remains owned by the existing Timeline. Clips and ruler receive the same `pixelsPerMs` and scroll container. Automated `verify:timeline` passed wide, narrow, compact, collapse/reopen, ruler seek, zoom, and empty-Timeline checks without increasing BottomWorkspace height; final real Windows wide→narrow→wide acceptance also passed.
- **R9 — PASS:** this receipt and PR #222 truth ledger now record the reworked scope, final automated evidence, both blocker re-tests, and completed maintainer Windows Electron acceptance. `maintainer Windows Electron = PASS` and `overall = PASS` are based on completed human evidence, not CI alone.

## Final files changed relative to origin/main

The Day 28 delivery remains 28 changed files including this receipt; product/test scope is unchanged by this final receipt-only bookkeeping commit:

- `docs/test-receipts/DAY-28.md`
- `src/domain/services/DialogueService.ts`
- `src/renderer/features/canvas/CanvasStage.tsx`
- `src/renderer/features/dialogue/DialogueInspector.tsx`
- `src/renderer/features/subtitles/SubtitleRenderer.tsx`
- `src/renderer/features/timeline/DialogueClip.tsx`
- `src/renderer/features/timeline/TimelineDock.tsx`
- `src/renderer/features/timeline/dialogueGesture.ts`
- `src/renderer/features/timeline/timeGeometry.ts`
- `src/renderer/shell/ProductPreviewOverlay.tsx`
- `src/renderer/shell/productPreviewModel.ts`
- `src/renderer/stage/CanvasStage.tsx`
- `src/renderer/stage/StageRenderer.tsx`
- `src/renderer/stores/dialogueStore.ts`
- `src/renderer/styles.css`
- `src/shared/preview/dialogue-subtitle.ts`
- `src/shared/preview/subtitle-engine.ts`
- `src/shared/preview/subtitle-layout.ts`
- `tests/contract/issue220-dialogue-layout.test.ts`
- `tests/contract/issue221-day28.test.ts`
- `tests/unit/dialogue-gesture.test.ts`
- `tests/unit/dialogue-inspector-timing.test.ts`
- `tests/unit/dialogue-service.test.ts`
- `tests/unit/dialogue-store.test.ts`
- `tests/unit/dialogue-subtitle.test.ts`
- `tests/unit/features/timeline/timeGeometry.test.ts`
- `tests/unit/subtitle-layout.test.ts`
- `tests/unit/subtitle-renderer.test.ts`

## Files removed from the old PR scope

- `src/domain/evaluators/dialogueEvaluator.ts`
- `src/domain/evaluators/mouthMotionEvaluator.ts`
- `src/main/services/AssetAudioSourceService.ts`
- `src/renderer/features/dialogue/DialogueEditor.tsx`
- `src/renderer/features/preview/AudioScheduler.ts`
- `src/shared/asset-audio-api.ts`
- `tests/unit/asset-audio-source-service.test.ts`
- `tests/unit/audio-scheduler.test.ts`
- `tests/unit/dialogue-evaluator.test.ts`
- `tests/unit/product-preview-audio.test.ts`

Existing files touched by the discarded audio/mouth/schema implementation were restored to their `origin/main` behavior and therefore do not appear in the final changed-file list.

## Validation evidence

| Check | Result | Evidence |
|---|---|---|
| `pnpm typecheck` | PASS | Renderer and Electron TypeScript checks exited 0 after the rework. |
| `pnpm exec eslint src tests` | PASS | Final product source and test scope exited 0. |
| Focused Day28 regression | PASS | Final Issue #226 scope: 5 files / 53 tests. |
| `pnpm test:unit` | PASS | 112 files / 792 tests. |
| `pnpm test:integration` | PASS | 26 files / 147 tests. |
| `pnpm build` | PASS | Renderer transformed 301 modules; Electron/preload builds exited 0; only the existing chunk-size warning remained. |
| `pnpm verify:timeline` | PASS | Automated Windows Electron verifier passed Issue #197 wide/narrow/compact layout, Issue #199 ruler/zoom/save-state behavior, and Issue #207 empty-Timeline behavior. |
| `git diff --check` | PASS | No whitespace errors in the implementation/receipt validation runs. |
| GitHub CI on human-validated implementation head `aa4529f...` | PASS | CI run `31981675583`, attempt 2, completed `success`; attempt 1 hit the unchanged fixed 5-second asset-metadata timeout after the main gates had passed, and the same commit passed on rerun without code/test changes. |
| `pnpm lint` | FAIL (local artifact contamination) | 1031 errors: 1020 under pre-existing out-of-scope `.workbuddy/artifacts/*` and 11 in `scripts/diag-preload.cjs`. Those paths were not modified, deleted, staged, or hidden with ignore changes. The CI-equivalent `pnpm exec eslint src tests` passes. |

Integration emitted the existing `asset-thumbnail:read No handler registered` fixture noise while still exiting 0. Automated Timeline verification is regression evidence and is not substituted for the completed maintainer human checks below.

## Maintainer Windows Electron acceptance — PASS

Human acceptance was completed against implementation head `aa4529f607deaba876c96d8dff0f5daf9334cbce` in a real Windows Electron session.

- **Untimed authoring — PASS:** newly created Dialogue remained Untimed, stayed visible/selectable on Timeline, reused the existing RightInspector, and exposed the explicit `安排为一帧` action.
- **Explicit one-frame arrange — PASS:** Untimed `0/0 ms` became `0–42 ms` at 24 FPS and added exactly one History command.
- **Subtitle evaluation — PASS:** subtitle appeared inside the active interval and disappeared outside it. With a later interval ending at `459 ms`, the subtitle was visible at `458 ms` and absent by `500 ms`; exact end half-open behavior is additionally covered by automated boundary tests.
- **Ruler/selection no-op behavior — PASS:** pure ruler seek did not add History; selecting a Dialogue clip did not add History.
- **Overlap rejection — PASS:** arranging/setting timing into an occupied interval produced a readable overlap rejection and did not pollute Project/History.
- **Persistence — PASS:** Save → close project → reopen preserved the timed Dialogue and its subtitle behavior.
- **Issue #224 zero-delta resize — PASS:** click/release without effective movement kept `0–42 ms`, History `0/0`, and saved state unchanged.
- **End-boundary resize — PASS:** a real end resize changed timing once and produced one History command.
- **Move — PASS:** `0–292 ms → 167–459 ms` preserved the 292 ms duration, produced one independent History command, and did not accidentally seek the playhead. Undo/Redo restored each state correctly.
- **Shot switch — PASS:** switching to a newly created empty shot cleared the previous shot's subtitle with no stale caption.
- **Issue #226 exact adjacency — PASS:** A=`[167,459)`, B=`[459,833)` committed successfully and remained exact; B=`[458,833)` was rejected and did not change committed timing or History.
- **Start-boundary resize — PASS:** a real start resize changed only `startMs` (`625→542`) while keeping `endMs=999`; it added exactly one History command. Undo restored `625–999`; Redo restored `542–999`.
- **Subtitle click-through / Konva hit-test — PASS:** while the subtitle was visible, underlying Panda layers remained selectable; Transformer selection appeared and the existing layer RightInspector updated, proving the subtitle overlay did not consume the layer pointer hit.
- **Responsive layout — PASS:** wide baseline was usable; narrowing the Electron window correctly collapsed side workspaces while Canvas, subtitle, Timeline, Dialogue clips, and History remained reachable; the narrow RightInspector opened normally; widening again restored the full left workspace, Canvas, RightInspector, Timeline, and clips without residual narrow-layout corruption.

No remaining Day28 Windows Electron checklist item is pending.

## Ownership and behavior decisions

- Project mutations remain owned by `DialogueService` through `dialogueStore` and `EditorProjectStore`; there is no second Project or History store.
- Selection remains session state in `dialogueSelectionStore`; the existing RightInspector is the only dialogue inspector owner.
- Timeline geometry remains owned by `TimelineDock`, `timelineUiStore`, and `timeGeometry`; no second Timeline or playhead was introduced.
- Untimed is a persisted point state. Visual marker width is UI-only and does not modify Project data.
- New timed authoring uses half-open intervals, rejects overlap, permits exact adjacency, and never ripples another Dialogue.
- Manual RightInspector numeric timing preserves exact integer-ms input after validation/clamp; pointer-driven Timeline move/resize continues to frame-snap.
- Subtitle time selection is owned by shared `evaluateSubtitleAtTime()` after the shared dialogue projection. Legacy overlaps remain loadable and use one deterministic winner policy.
- Shared `SubtitleRenderer` is non-listening and uses the existing safe area and persisted style fields only.
- Gesture preview is transient; only a valid, effective pointerup produces one Project/History mutation.

## Remaining debt / non-goals

- Full local `pnpm lint` remains polluted by unrelated local `.workbuddy/artifacts/*` and `scripts/diag-preload.cjs`; no ignore rule was changed to conceal that fact. CI-equivalent source/test lint and GitHub CI are green on the human-validated implementation head.
- Day 28 does not implement TTS, audio scheduling/mixing, mouth animation, waveform editing, ActionPreset editing, ripple editing, a second Timeline, or a second Project store.
- The final receipt update is documentation-only; it does not invalidate the completed product-code human acceptance. The PR's final HEAD CI should still be checked before merge.

## Conclusion

Day 28 implementation, automated/structural validation, Issue #224/#226 blocker re-tests, and maintainer Windows Electron acceptance are all `PASS`. `overall = PASS`.

PR #222 remains Open and unmerged pending final bookkeeping / final-head CI confirmation. Parent Issue #221 remains open until the final PR merge. Rework/blocker Issues #223, #224, and #226 have satisfied their completion criteria and may be closed as completed.