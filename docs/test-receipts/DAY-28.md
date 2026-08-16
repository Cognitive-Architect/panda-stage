# Panda Stage Day 28 / Issue #223 rework receipt

## Identity and status

- Parent execution issue: [#221](https://github.com/Cognitive-Architect/panda-stage/issues/221)
- Rework issue: [#223](https://github.com/Cognitive-Architect/panda-stage/issues/223)
- Pull request: [#222](https://github.com/Cognitive-Architect/panda-stage/pull/222)
- Branch: `agent/day28-dialogue-timing-subtitle-track`
- Baseline: `origin/main@90bb37cb975147ca7d17efdd8d9d00a1993bdd34`
- Canonical task: `new agent task/DAY-28-AGENT-TASK.md`
- Canonical Git tree blob: `cd04c247facf32e068a888bfedc718f36e66b500`
- PR head before rework: `501c8272b63b41caf8e7bfafdf348f119fe3f30b`
- Rework implementation commit: `0141ad25d40b263c60e9f1c3dca54e1fcca73b8e`
- Day 26 prerequisite: `e4eeb551721864b0c2f3e2596d35d3d1dc2de323`
- Day 27 prerequisite: `6092109c2c73dc8e056a41bd94fbfc1dfa87d31a`
- Automated/structural status: `PASS`, with the full-repository local lint exception recorded below.
- Maintainer Windows Electron acceptance: `PENDING`.
- Overall Day 28 status: `PENDING`.

This receipt records the Issue #223 correction of PR #222. It does not treat application startup, automated Electron verification, or CI as human acceptance.

## R1-R9 rework ledger

- **R1 — PASS:** `DialogueService.create()` persists one clamped Untimed point (`startMs === endMs`); `createMany()` gives every line the same captured point and the store commits the batch as one History command. Unit tests cover `1200/1200`, both clamps, an eight-line short-shot batch, and one Undo for the batch.
- **R2 — PASS:** only the explicit Untimed-to-Timed action creates a positive span. `integerFrameSpanMs()` derives the integer span from Day 26 `frameDurationMs()` / `snapToFrame()` geometry (42 ms at 24 FPS), passes it to the domain as plain data, backfills at shot end, rejects overlap at commit, and permits adjacency.
- **R3 — PASS:** PR-introduced audio attachment/scheduling and mouth-motion behavior, IPC, services, UI, and tests were removed rather than completed in Day 28.
- **R4 — PASS:** `git diff --name-status origin/main -- src/domain/models src/domain/constants.ts` is empty. No `strokeColor`, `strokeWidth`, schema-version workaround, or other persisted Project-shape expansion remains.
- **R5 — PASS:** `buildDialogueSubtitleCues()` is the single editor/Preview Dialogue-to-cue projection and both consumers call shared `evaluateSubtitleAtTime()`. Boundary and deterministic legacy-overlap winner tests cover before/start/inside/end/adjacency/overlap plus trim and 500-character projection.
- **R6 — PASS:** Timeline renders every Dialogue. Untimed entries use an 18 px non-persisted marker, remain selectable through `dialogueSelectionStore` and the existing RightInspector, and expose the explicit one-frame arrange action. Store tests prove render/selection does not change timing, dirty, revision, or History; arrange is one command.
- **R7 — PASS:** each gesture captures `projectRoot + shotId + dialogueId`; commit rechecks current project, shot, selection, and entity existence. Tests cover project switch, shot switch, deletion, selection change, pointer cancel, Escape/unmount cancellation, and one successful pointerup callback.
- **R8 — PASS:** clip/handle pointer isolation calls preventDefault/stopPropagation while ruler seeking remains owned by the existing Timeline. Clips and ruler receive the same `pixelsPerMs` and scroll container. `verify:timeline` passed wide, narrow, compact, collapse/reopen, ruler seek, zoom, and empty-Timeline checks without increasing BottomWorkspace height.
- **R9 — PASS at handoff:** this receipt and PR #222 body are corrected to the reworked scope and real counts. Maintainer Windows Electron and overall status remain `PENDING`; no old CI run is claimed for the new head.

## Final files changed relative to origin/main

The final Day 28 product/test diff is 26 files (`1951 insertions`, `227 deletions`):

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
| `pnpm typecheck` | PASS | Renderer and Electron TypeScript checks exited 0 after the rework commit was staged. |
| `pnpm exec eslint src tests` | PASS | Final product source and test scope exited 0. |
| `pnpm test:unit` | PASS | 111 files / 781 tests. |
| `pnpm test:integration` | PASS | 26 files / 147 tests; command exited 0. |
| `pnpm build` | PASS | Renderer transformed 301 modules; Electron/preload builds exited 0; only the existing chunk-size warning remained. |
| `pnpm verify:timeline` | PASS | Automated Windows Electron verifier passed Issue #197 wide/narrow/compact layout, Issue #199 ruler/zoom/save-state behavior, and Issue #207 empty-Timeline behavior. |
| `git diff --check` | PASS | No whitespace errors in the rework implementation; rerun after this receipt before push. |
| `pnpm lint` | FAIL (local artifact contamination) | 1031 errors are confined to pre-existing out-of-scope `.workbuddy/artifacts/*` and `scripts/diag-preload.cjs`. Those paths were not modified, deleted, staged, or hidden with ignore changes. The CI-equivalent `pnpm exec eslint src tests` passes. |

Integration emitted the existing `asset-thumbnail:read No handler registered` fixture noise while still exiting 0. The automated Timeline verifier is regression evidence only and is not maintainer Windows Electron acceptance.

## Ownership and behavior decisions

- Project mutations remain owned by `DialogueService` through `dialogueStore` and `EditorProjectStore`; there is no second Project or History store.
- Selection remains session state in `dialogueSelectionStore`; the existing RightInspector is the only dialogue inspector owner.
- Timeline geometry remains owned by `TimelineDock`, `timelineUiStore`, and `timeGeometry`; no second Timeline or playhead was introduced.
- Untimed is a persisted point state. Visual marker width is UI-only and does not modify Project data.
- New timed authoring uses half-open intervals, rejects overlap, permits exact adjacency, and never ripples another Dialogue.
- Subtitle time selection is owned by shared `evaluateSubtitleAtTime()` after the shared dialogue projection. Legacy overlaps remain loadable and use one deterministic winner policy.
- Shared `SubtitleRenderer` is non-listening and uses the existing safe area and persisted style fields only.
- Gesture preview is transient; only a valid pointerup produces one Project/History mutation.

## Remaining acceptance and debt

- Maintainer must re-audit the pushed diff before starting Windows Electron acceptance.
- Maintainer Windows Electron acceptance is `PENDING`; every human checklist result remains unrecorded.
- Automated tests do not replace real Konva pointer, DPI, save/reopen, and wide-to-narrow-to-wide human checks.
- Full local lint remains polluted by unrelated local tool artifacts; no ignore rule was changed to conceal that fact.
- Day 28 does not implement TTS, audio scheduling/mixing, mouth animation, waveform editing, ActionPreset editing, ripple editing, a second Timeline, or a second Project store.

## Conclusion

Issue #223's implementation and automated/structural rework are ready for maintainer diff review on the existing Draft PR #222. PR #222 must remain Draft/Open/Unmerged; Issues #221 and #223 must remain open. `maintainer Windows Electron = PENDING` and `overall = PENDING` until the maintainer explicitly completes and records human acceptance.
