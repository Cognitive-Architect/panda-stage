# Panda Stage Day 29 / B29-CLUSTER 收卷

## Identity

- Day29 canonical task: `new agent task/DAY-29-AGENT-TASK.md`
- Day29 开工 main: `66ce42ab47c4829515385adca4af58b65aef7134`
- Day29 implementation/routing HEAD: `ab150aabaeb6fbb4e2c09be0d79ae57d0a352644`
- Issue #234 blocker fix HEAD: `523d068f13e879bb794eb21b689ea55dd5594bc0`
- Issue #235 blocker fix HEAD: `6a1462a3d0e3840ed6f834b54229502a429fff17`
- Issue #236 blocker fix HEAD: `fa365e3ca104a967eaf6e305bef2e2c9110c5b87`
- Issue #236 CI route repair: `497e881630c88be3a0e75d414ffc201de632f513`
- Issue #238 blocker fix HEAD: `908053d18f7b307ae2cd09f286a930544276c8ae`
- Delivery PR: [#233](https://github.com/Cognitive-Architect/panda-stage/pull/233)
- Delivery branch: `agent/day29-audio-mouth-preview`
- Current delivery implementation HEAD: `516c008bb0715cca395e371ad8b5bca287fa8d92`
- Day28 prerequisite: `PASS + merged` (`#222`, `8024a701a97b1ddacf18758eb55ac06a6e2b98c9` is an ancestor)
- RH-07 CI policy: `active`

## Status

- B29-01 preflight: `PASS`
- B29-02 binding: `PASS`
- B29-03 audio IPC: `PASS`
- B29-04 mouth projection: `PASS`
- B29-05 audio transport: `PASS`
- B29-06 integration: `PASS`
- automated/structural: `PASS`
- maintainer Windows Electron: `PENDING`
- overall: `PENDING`

`PENDING` is intentional: automated tests and the Draft CI self-test do not
replace the required real Windows Electron audio/speaker acceptance.

## Preflight owner map

- Dialogue mutation owner: `src/domain/services/DialogueService.ts:100`, `DialogueService`; `bindAudio` at `:199`, timing replacement at `:342`
- Dialogue renderer store: `src/renderer/stores/dialogueStore.ts:34`, `DialogueStore`; `bindAudio` at `:113`
- Dialogue inspector: `src/renderer/features/dialogue/DialogueInspector.tsx:40`; audio selection at `:288`
- Audio model/reference validator: existing `src/domain/validators/projectReferences.ts`; no new persisted field or timing-equality rule was added
- Asset import owner: existing Main asset import service and Asset Library flow; Day29 does not add a second importer
- Audio read IPC owner: `src/main/services/AssetPreviewAudioService.ts`; registered by `src/main/ipc/register-asset-library-ipc-handlers.ts`, exposed through `src/preload/index.ts` and `src/shared/asset-preview-audio-api.ts`
- Preview clock owner: `src/renderer/shell/ProductPreviewOverlay.tsx:129`; `timeMs` remains the master clock
- Mouth projection owner: `src/renderer/shell/productPreviewModel.ts:110`, `projectProductPreviewMouth`
- Stage renderer owner: existing `src/renderer/stage/StageRenderer.tsx` / `CanvasStage.tsx`; receives the transient evaluated projection
- CI route owner: `scripts/verification-manifest.json` and `scripts/ci-routing.cjs`

## Changed files

`git diff --name-status origin/main...HEAD` at the delivery code HEAD:

```text
M  scripts/verification-manifest.json
M  src/domain/services/DialogueService.ts
M  src/main/index.ts
M  src/main/ipc/register-asset-library-ipc-handlers.ts
A  src/main/services/AssetPreviewAudioService.ts
M  src/preload/index.ts
M  src/renderer/features/assets/AssetCard.tsx
M  src/renderer/features/assets/AssetDetails.tsx
M  src/renderer/features/assets/AssetGrid.tsx
M  src/renderer/features/assets/AssetImportPanel.tsx
M  src/renderer/features/assets/AssetLibrary.tsx
M  src/renderer/features/assets/applyAssetMetadataResponse.ts
A  src/renderer/features/assets/assetMetadataQueue.ts
A  src/renderer/features/assets/assetMetadataState.ts
M  src/renderer/features/dialogue/DialogueInspector.tsx
M  src/renderer/global.d.ts
M  src/renderer/shell/ProductPreviewOverlay.tsx
A  src/renderer/shell/productPreviewAudio.ts
M  src/renderer/shell/productPreviewModel.ts
M  src/renderer/stores/dialogueStore.ts
A  src/shared/asset-preview-audio-api.ts
M  src/shared/ipc/channels.ts
A  tests/integration/dialogue-audio-preview.test.ts
A  tests/unit/asset-audio-metadata-ui.test.ts
M  tests/unit/asset-library-ipc-handlers.test.ts
A  tests/unit/asset-metadata-queue.test.ts
A  tests/unit/asset-preview-audio-service.test.ts
A  tests/unit/dialogue-audio-binding.test.ts
M  tests/unit/dialogue-inspector-timing.test.ts
M  tests/unit/ipc-contracts.test.ts
A  tests/unit/product-preview-audio.test.ts
A  tests/unit/product-preview-mouth.test.ts
```

Issue #236 增量文件（相对 Issue #235 delivery HEAD）：

```text
M  docs/ffmpeg.md
M  scripts/verification-manifest.json
M  src/main/services/FFmpegAdapter.ts
M  src/main/services/production-resources.ts
M  tests/unit/ffmpeg-adapter.test.ts
M  tests/unit/production-resources.test.ts
```

No schema bump was made; `schemaVersion` remains v6. No Project, playback,
mouth, or audio-byte transient state is persisted.

## Binding contract evidence

- Untimed reject: `PASS` — binding test and Inspector disable path
- New bind: `PASS` — timed Dialogue creates/reuses the correct AudioClip reference
- Rebind no leak: `PASS` — repeated/rebound binding does not grow duplicate clips
- Shared legacy clip COW: `PASS` — timing changes do not mutate another Dialogue's shared clip
- Source-too-short atomic reject: `PASS` — Project snapshot remains unchanged
- Timing sync set/arrange/move/resize: `PASS` — common `replaceDialogueTiming` path keeps the bound clip range aligned
- No-op timing: `PASS` — same timing returns the original Project without a new revision
- History one-command: `PASS` — store update uses one `updateProject` command
- Save/reopen: `PASS` — integration test preserves the v6 Dialogue/AudioClip relation

Evidence: `tests/unit/dialogue-audio-binding.test.ts` (6 tests), existing
Dialogue service/store regressions, and
`tests/integration/dialogue-audio-preview.test.ts`.

## Audio IPC security evidence

- Tracked project: `PASS`
- Audio kind: `PASS`
- Hash identity: `PASS`
- Traversal: `PASS` — lexical assets-root containment
- Symlink escape: `PASS` — realpath containment guard and negative test path
- Size guard: `PASS` — 64 MiB maximum per read
- MIME/inspection: `PASS` — only `audio/mpeg` and `audio/wav`, plus media signature inspection
- Actual SHA: `PASS` — bytes are rehashed before returning
- Trusted sender: `PASS` — Main handler keeps the existing trusted-sender check
- Concurrent dedupe/cleanup: `PASS` — in-flight reads are deduplicated and cleaned in `finally`

The renderer receives bytes only through the allowlisted preload API. It does
not use `fs`, `path`, `file://`, absolute source paths, or child processes.
Unexpected Main failures return an opaque safe error; paths and raw stacks are
not exposed.

## Preview transport evidence

- Single clock: `PASS` — Preview `timeMs` is authoritative; audio is subordinate
- Play inside clip: `PASS`
- Pause: `PASS`
- Seek paused: `PASS`
- Seek playing: `PASS`
- Clip transition: `PASS`
- Stop: `PASS`
- Shot end: `PASS`
- Stale async: `PASS` — generation/project/asset identity prevents old reads from restarting playback
- 5x replay resource counts: `PASS` — transport test observed one reusable media element, one audio read, one Blob URL creation, and one revoke after cleanup
- Object URL create/revoke: `PASS` — cache is keyed by project/asset/hash and URLs are revoked on invalidation/dispose
- Project dirty/revision/History: `PASS` — playback, seek, mouth projection, and cleanup do not call Project mutation

The implementation uses one reusable `HTMLAudioElement`, no `AudioContext`, no
`setTimeout` playback substitute, and explicit seek revisions for pause/seek/
resume/stop/shot/project transitions.

## Mouth evidence

- Before/start/inside/end half-open: `PASS`
- No audio: `PASS` — normal evaluated image is retained
- No mouth asset: `PASS` — safe fallback without crash
- Non-image/invalid mouth asset: `PASS` — defensive runtime fallback retains the evaluated shot
- Speaking layer asset override: `PASS`
- Non-speaking layer unchanged: `PASS` — verified with two character layers, each carrying a valid mouth asset
- Two-character active-speaker isolation: `PASS` — Dialogue A opens only A; Dialogue B opens only B, while the other evaluated layer remains identical
- Legacy overlap winner matches subtitle: `PASS` — shared `evaluateSubtitleAtTime` winner is reused and only the winning character opens
- Mouth asset preloaded: `PASS` — valid used `mouthOpenAssetId` image is included in the preview preload set

## Issue #235 blocker correction

- Real Windows discovery: three valid MP3 files imported successfully through Asset Library, but all remained duration-less and were shown as disabled `（待分析）` options in Dialogue Inspector; this was recorded as the Day29 acceptance blocker in Issue #235.
- Root cause: the existing Main `AssetMetadataService` and audio probe were available, but the renderer exposed refresh only through the image-thumbnail rebuild path; imported audio had no automatic product-path analysis, visible state, or retry path. The duration safety gate was intentionally retained.
- Production fix commit: `6a1462a3d0e3840ed6f834b54229502a429fff17`.
- Import flow: newly imported audio IDs are selected from the completed import response, then passed through the existing `assets.refreshMetadata` IPC and Main `AssetMetadataService` one at a time. The queue deduplicates IDs, observes each latest revision, serializes manual retries with automatic work, and stops on project identity/revision changes.
- UI state: audio cards and details expose pending/analyzing, ready with duration, and error with a retry action. `DialogueInspector` still disables duration-less audio; no selector or `bindAudio` guard was bypassed.
- Error flow: persisted Main `result.status = error` responses are now applied to the renderer store, while operation failures remain visibly retryable without mutating Project data.
- Regression evidence: `tests/unit/asset-audio-metadata-ui.test.ts` (4 tests), `tests/unit/asset-metadata-queue.test.ts` (2 tests), existing real-probe integration (including 2+ sequential audio assets), revision-safety integration, duration guard, short-source atomic rejection, and Dialogue binding tests.
- Scope guard: reused the existing metadata/probe owner; no second parser, IPC channel, schema bump, fake duration, DevTools/JSON path, playback rewrite, or second PR was added.

## Issue #236 blocker correction

- Original maintainer evidence recorded in Issue #236: `where.exe ffprobe` from the repository root found no system command, while `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe` existed and directly returned `ffprobe version 2023-02-13-git-2296078397`.
- Root cause: Windows development fallback in `resolveMediaToolPaths()` returned bare `ffmpeg.exe` / `ffprobe.exe`, so the existing repo-installed binaries were ignored when system PATH did not contain them.
- Production fix: `fd7831e9ab73d0ca04f34a1c0b64b23a85b632aa` resolves the two Windows package directories through Node package resolution and uses their bundled executables; explicit `PANDA_STAGE_FFMPEG_PATH` / `PANDA_STAGE_FFPROBE_PATH` overrides remain first; packaged `resources/media` resolution is unchanged.
- Resource safety: development binaries are checked before Main initialization. Missing package/files produce an actionable install-or-override error without exposing arbitrary absolute paths. `FFmpegAdapter` retains `EXECUTABLE_NOT_FOUND` for missing tools, reports other spawn failures as `PROCESS_FAILED`, and keeps those distinct from `AUDIO_INPUT_INVALID` / `PROBE_FAILED` media errors (`fa365e3ca104a967eaf6e305bef2e2c9110c5b87`).
- Location/PATH guard: resolution contains no hardcoded checkout path and does not require a global FFmpeg installation or a PATH change. The compiled Main runtime resolved both real Windows binaries under the current repository's installed package store and each returned its version line.
- Automation: `tests/unit/production-resources.test.ts` focused path coverage `PASS` (7 tests); production-resource + FFmpeg adapter focused coverage `PASS` (2 files / 26 tests); full unit `PASS` (121 files / 884 tests); integration `PASS` (27 files / 148 tests); typecheck, lint, build, and `git diff --check` `PASS`. CI routing/manifest contracts remained `PASS` (2 files / 56 tests).
- Windows reacceptance: `PENDING` — the maintainer must restart the updated Electron app, use the same Day29 project and existing MP3 files, click Retry analysis, confirm error → analyzing → ready with real duration for all three assets, confirm the 0–1000ms Inspector option, and bind through the normal UI. No automated result is recorded as human acceptance.
- Scope guard: no global PATH workaround, hardcoded `D:\panda-stage-main`, schema bump, second probe/parser, or second PR was added. Existing PR #233 remains the delivery vehicle.

## Issue #238 blocker correction

- Original Windows evidence: with a 4000ms Shot, Dialogue A occupied `0–1300ms`; creating Dialogue B at playhead `0ms` left it Untimed at `0/0ms`. Clicking `安排为一帧` attempted `0–42ms`, correctly hit the strict overlap guard, and left the user with no legal product-path action because Untimed Inspector has no start/end fields.
- Root cause: `DialogueService.arrange()` only tried the captured point (or the old shot-end backfill) and rejected the first occupied candidate instead of searching the Shot for the next legal positive interval.
- Production fix: `908053d18f7b307ae2cd09f286a930544276c8ae` adds a deterministic `findFirstAvailableTiming()` search. It starts at the captured point, clamps the candidate to the Shot's latest legal start, sorts all positive Timed intervals by start/end, treats touching endpoints as legal, jumps to each conflicting interval's end, and returns the first span that fits without changing the single timeline clock or persisted schema.
- No-space behavior: when no positive span fits within the Shot, `DIALOGUE_NO_AVAILABLE_SLOT` returns a readable error and throws before `replaceDialogueTiming()`, so Project, dirty/revision state, and History remain unchanged.
- Scope preservation: explicit `setTiming`, `move`, and `resize` still use the unchanged strict `DIALOGUE_OVERLAP` guard; audio-bound timing still flows through the existing shared replacement path; the renderer `DialogueStore` still commits one successful arrange as one History command.
- Regression evidence: `tests/unit/dialogue-service.test.ts` covers occupied creation points, endpoint adjacency, insufficient-gap skipping, insertion-order determinism, Shot-end clamping, no-space atomic failure/readable error, legacy overlapping data, and strict explicit timing; `tests/unit/dialogue-store.test.ts` covers the occupied-point arrange as one atomic History command. Focused dialogue/contract tests: `PASS` — 4 files / 45 tests.
- Final local validation: `pnpm typecheck` `PASS`; `pnpm lint` `PASS`; `pnpm test:unit` `PASS` — 121 files / 891 tests; `pnpm test:integration` `PASS` — 27 files / 148 tests when run serially; `pnpm build` `PASS`; `git diff --check` `PASS`. A parallel run produced one isolated 5-second timeout in the pre-existing `asset-metadata-revision-safety` timeout case; that file and the complete integration suite passed on isolated/serial reruns.
- CI route: local Draft classification is `focused`, areas `cross-process-core dialogue`, suites `editor timeline`, with `unknown_paths=[]`; CI run #455 / run ID `32072902166`: `PASS` — classifier, policy contracts, typecheck, lint, unit, integration, build, Electron runtime preparation, and the selected editor/timeline subsystem suites all passed. Targeted, Unknown, Full, and Ready candidate routes were skipped as required for Draft.
- Windows reacceptance: `PENDING` — maintainer must relaunch the updated real Windows Electron app, reproduce the existing A `0–1300ms` / B Untimed-at-`0ms` case, click `安排为一帧`, confirm B lands at `1300–1342ms` (or the first deterministic legal gap) with no overlap, then continue B to `1500–2500ms` and bind the second real MP3 through the normal UI. No DevTools/JSON/delete-recreate path is acceptance evidence.
- Scope guard: no schema bump, second timing system, overlap weakening, hidden overlap, playback redesign, or second PR was added; PR #233 remains Draft/Open/Unmerged and Issue #238 remains open pending maintainer proof.

## Issue #240 acceptance polish bundle

- Scope: subtitle/audio timing decoupling, Product Preview canvas-first polish, and deterministic Replay on PR #233; implementation commit: `a9ce23633671687d9cd6a659c7e3573e2e4ee1ed`.
- Timing ownership: `Dialogue.startMs/endMs` owns subtitle visibility; `AudioClip.startMs/endMs` owns playback. New binding clamps the clip to the actual source duration, so a `0–1500ms` Dialogue with a `1330ms` source produces a `0–1330ms` clip and the subtitle remains visible through `1500ms`. No fake duration or schema bump was added; Project schema remains v6.
- Timing mutation: binding preserves strict source/Shot validation; `move` translates a bound clip with the actual Dialogue delta, while `resize`, `setTiming`, and `arrange` change subtitle timing without stretching playback. Shared legacy clips retain copy-on-write behavior. Unit and integration coverage includes move/resize, Undo/Redo, and Save/Reopen persistence.
- Product Preview: uses the existing bounded original-image Main/Preload seam (`readCanvasImage`) and renderer-owned Blob URL cleanup; Asset Library thumbnails remain on their existing path. The overlay is canvas-first, uses complete contain fitting, keeps transport below the stage, removes the hardcoded watermark, and does not use renderer filesystem access, `file://`, or a second evaluator.
- Replay: one control resets the master time to `0`, increments the seek revision, cancels stale transport work, and starts immediately on the single reusable `HTMLAudioElement`. Audio and mouth projection stop at the independent clip end while the subtitle continues; repeated replay does not create dirty state, history entries, ghost audio, or stale mouth state.
- Final local validation: `pnpm typecheck` `PASS`; `pnpm lint` `PASS`; `pnpm test:unit` `PASS` — 121 files / 895 tests; `pnpm test:integration` `PASS` — 27 files / 148 tests; `pnpm build` `PASS` (existing Vite chunk-size warning only); `git diff --check` `PASS`. The integration harness still emits known `asset-thumbnail:read` no-handler noise after passing; it does not change the successful exit or test count.
- Draft CI routing: run #457 / run ID `32100251298` first failed only at `Unknown route guard` because `tests/contract/dom-selectors.baseline.test.ts` was not registered; no production quality result was inferred from that routing failure. Route repair commit `516c008bb0715cca395e371ad8b5bca287fa8d92` registers the selector contract under `editor-shell`; focused manifest/selector tests pass (2 files / 24 tests).
- Draft CI route repair: run #458 / run ID `32100415828` `PASS` — classifier, CI policy contracts, typecheck, lint, and diff whitespace passed; Focused/Targeted/Full/Ready/Post-merge routes were skipped as required for a Draft manifest-only repair.
- Windows Electron acceptance: `PENDING` — maintainer must verify the `0–1500ms` subtitle / `0–1330ms` audio case, move/resize plus Undo/Redo and Save/Reopen, canvas-first preview at full and resized window, sharp original preview with no watermark, unchanged Asset Library thumbnails, and Play/Pause/Replay repeated five times with clean audio, mouth, resources, dirty state, and History.
- Delivery guard: PR #233 remains `Draft / Open / Unmerged`; no Ready, merge, or Issue #237/#239/#240 closure action was taken. Automated checks are not recorded as human acceptance.

## Issue #234 blocker correction

- Root cause: the Day29 projection built a mouth-asset map for every project character and applied it to every matching character layer, so a non-speaking character could also open its mouth.
- Production fix: `projectProductPreviewMouth()` now resolves `activeDialogueId -> shot.dialogues[] -> dialogue.characterId`, validates only that character's mouth asset, and changes only layers with the same `source.characterId`.
- Regression fixture: `tests/unit/product-preview-mouth.test.ts` now contains two character layers and two valid mouth assets; it asserts both A-speaks and B-speaks cases, shared subtitle overlap winner A/B, transforms/other layers unchanged, and invalid/non-image fallback.
- Scope guard: no Project schema, persisted state, History, ActionPreset, TimelineEvent, second evaluator, or audio transport changes.

Mouth state is a pure evaluated-shot projection. It is not an ActionPreset,
timeline event, persisted Project field, or second preview clock.

## Automated quality report

- typecheck: `PASS` — `pnpm typecheck`
- lint: `PASS` — `pnpm lint`
- Issue #235 focused: `PASS` — asset metadata UI/queue/import selection, 6 files / 24 tests
- Issue #235 metadata integration: `PASS` — asset metadata and revision safety, 2 files / 13 tests
- Issue #234 focused: `PASS` — `product-preview-mouth` + `dialogue-subtitle`, 2 files / 12 tests
- Prior Day29 focused tests: `PASS` — binding, audio IPC service, transport, mouth, and Inspector contract tests
- unit: `PASS` — `pnpm test:unit`, 121 files / 879 tests
- integration: `PASS` — `pnpm test:integration`, 27 files / 148 tests
- build: `PASS` — `pnpm build` (only the existing Vite chunk-size warning)
- git diff --check: `PASS`
- verification-manifest contracts: `PASS` — 2 files / 56 tests

The integration harness emitted known noisy `No handler registered for
asset-thumbnail:read` messages after passing; the command exit and all 148
integration tests were successful. This is recorded as harness noise, not
acceptance evidence for the new audio path.

## Blade table

| ID | Status | Evidence / boundary |
|---|---|---|
| FUNC-001 | `PASS` | Binding service/store tests |
| FUNC-002 | `AUTOMATED PASS / Windows PENDING` | Transport and overlay tests; real audio still requires Electron |
| FUNC-003 | `AUTOMATED PASS / Windows PENDING` | Pure mouth tests; speaker/media alignment requires Electron |
| FUNC-004 | `PASS` | Timing synchronization tests |
| CONST-001 | `PASS` | No persisted field or schema bump |
| CONST-002 | `PASS` | Preload/Main audio seam and IPC tests |
| CONST-003 | `AUTOMATED PASS / Windows PENDING` | Snapshot assertions pass; human playback still pending |
| CONST-004 | `PASS` for Draft routing / `N/A` Ready and merge | RH-07 Draft self-test receipt below |
| NEG-001 | `PASS` | Untimed, non-audio, missing-duration, and short-source negatives |
| NEG-002 | `PASS` | Traversal, hash, symlink-containment, and sender negatives |
| NEG-003 | `AUTOMATED PASS / Windows PENDING` | Stale async transport tests; real shot/project switching pending |
| NEG-004 | `AUTOMATED PASS / Windows PENDING` | Mouth/audio fallback tests; Electron confirmation pending |
| UX-001 | `AUTOMATED PASS / Windows PENDING` | Inspector source contract; human wording/interaction pending |
| UX-002 | `PENDING` | Pause/Seek/Resume/Stop/Re-play requires maintainer Electron gate |
| E2E-001 | `PENDING` | Three real dialogues and three imported audio assets require maintainer |
| HIGH-001 | `AUTOMATED PASS / Windows PENDING` | Instrumented transport counts; real Windows replay/switch evidence pending |

## P4 self-check

| Check | Status | Evidence |
|---|---|---|
| CF | `AUTOMATED PASS / Windows PENDING` | Bind, playback, mouth, and timing-sync paths covered |
| RG | `PASS` | Day28 timing/subtitle/no-op regressions, validator, and CI contracts pass |
| NG | `PASS` | Negative tests cover untimed/short/bad hash/bad path/stale/missing mouth |
| UX | `PENDING` | Real Windows Electron required |
| E2E | `PENDING` | Real import → bind → save → reopen → preview required |
| High | `AUTOMATED PASS / Windows PENDING` | Resource instrumentation pass; real replay/switch pending |
| 字段完整性 | `PASS` | Required receipt sections and evidence are filled |
| 需求映射 | `PASS` | B29-01..06 and blade IDs are mapped above |
| 自测执行 | `PASS` | Full local automated validation was executed |
| 范围债务 | `PASS` | TTS, viseme, complex mouth timeline, mixer, and whole-project preview are explicit non-goals |

## CI V2 receipts

- Draft synchronize run #443, run ID `32015241413`: `FAIL` at `Unknown route guard`; it identified five new paths not yet registered in the verification manifest. No production quality result was inferred from that failed routing run.
- Route repair: commit `ab150aabaeb6fbb4e2c09be0d79ae57d0a352644` registered the five cross-process/editor-shell test and type routes.
- Draft synchronize run #444, run ID `32015364085`: `PASS`; `ci-selftest` tier, classifier success, policy contracts/typecheck/lint/diff whitespace pass. Focused/Targeted/Full/Ready jobs were skipped because the synchronized Draft delta was the manifest-only routing fix, as required by RH-07.
- Receipt commit run #445, run ID `32015871939`: `PASS`; docs-only fast path validated whitespace, docs-only scope, and Markdown relative links. Production quality and Ready/Post-merge jobs were correctly skipped.
- Issue #234 fix run #447, run ID `32018851632`: `PASS`; Draft `Targeted quality and regression` route, approximately 6m11s, with typecheck/lint/unit/integration/build and manifest-selected subsystem regression all successful. Full/Focused/Docs-only/Ready/Post-merge were skipped by RH-07.
- Issue #235 fix run #449, run ID `32031365295`: `PASS`; Draft `Targeted quality and regression` route, 6m45s (`2026-08-17T12:44:30Z` → `2026-08-17T12:51:15Z`). Classifier, typecheck, lint, unit, integration, build, and manifest-selected assets/character/editor/timeline regressions all passed. `Full quality and regression` was explicitly skipped, as were Focused/Docs-only/Ready/Post-merge.
- Issue #236 first source run #451, run ID `32037138475`: `FAIL` at `Unknown route guard`; the classifier identified only `tests/unit/production-resources.test.ts` as an unregistered production test route. No quality result was inferred from this routing failure; Full was skipped.
- Issue #236 route repair run #452, run ID `32037240307`: `PASS`; `ci-selftest` route validated the manifest addition, policy contracts, typecheck, lint, and whitespace. Focused/Targeted/Full/Ready/Post-merge were skipped because this Draft delta was the manifest-only route repair.
- Issue #236 focused run #453, run ID `32037461407`: `PASS`; Draft `Focused core quality` route, 2m52s (`2026-08-17T14:00:03Z` → `2026-08-17T14:02:55Z`). Classifier, typecheck, lint, unit, integration, and build all passed; manifest-selected subsystem regression was not required for this focused route. `Full quality and regression` was explicitly skipped, as were Targeted/Docs-only/CI-selftest/Ready/Post-merge.
- Issue #240 initial implementation run #457, run ID `32100251298`: `FAIL` only at `Unknown route guard` for the unregistered `tests/contract/dom-selectors.baseline.test.ts`; no production quality result was inferred.
- Issue #240 route repair run #458, run ID `32100415828`: `PASS`; Draft `ci-selftest` validated the manifest route, classifier, policy contracts, typecheck, lint, and whitespace. Focused/Targeted/Full/Ready/Post-merge were skipped because the synchronized delta was manifest-only.
- Ready final candidate SHA: `SKIPPED` — PR remains Draft
- Ready Full run: `SKIPPED` — PR remains Draft
- Ready Full proof: `SKIPPED` — no Ready/Full candidate exists
- Final CI result: `PASS` for current Draft ci-selftest run #458; Full remains skipped
- Post-merge provenance: `SKIPPED` — PR is not merged
- Post-merge Full: `SKIPPED` — PR is not merged; no post-merge provenance exists

PR #233 remains `Draft / Open / Unmerged`. No merge, Ready-for-review, or Issue
closure action was taken.

## Maintainer Windows Electron

- environment: `PENDING` — maintainer must run the real Windows Electron product window; browser/dev-server and headless tests do not count
- 3 dialogue + 3 audio full play: `PENDING`
- audio/subtitle/mouth alignment: `PENDING`
- Pause → Seek → Resume: `PENDING`
- Stop: `PENDING`
- Replay 5x: `PENDING`
- missing mouth fallback: `PENDING`
- move/resize bound dialogue: `PENDING`
- Undo/Redo: `PENDING`
- Save → close → reopen: `PENDING`
- switch shot: `PENDING`
- switch project: `PENDING`
- close preview cleanup: `PENDING`
- Issue #236 Retry analysis → real duration → 3 assets ready → normal bind: `PENDING`
- DevTools/JSON direct mutation used as acceptance evidence: `NO`

## Key decisions

- `DECISION-B29-DATA-LINK`: `Dialogue.audioClipId -> AudioClip -> AudioAsset`
- `DECISION-B29-NO-SCHEMA-BUMP`: confirmed; Project schema remains v6
- `DECISION-B29-BINDING-OWNER`: `DialogueService`, called once by `DialogueStore.updateProject`
- `DECISION-B29-SHARED-CLIP`: copy-on-write for shared legacy clips; no partial mutation on failure
- `DECISION-B29-AUDIO-READ`: secure Main `AssetPreviewAudioService` behind trusted IPC and allowlisted preload
- `DECISION-B29-MASTER-CLOCK`: Product Preview `timeMs`; audio follows `sourceOffsetMs + (timeMs - dialogue.startMs)`
- `DECISION-B29-AUDIO-PRIMITIVE`: one reusable `HTMLAudioElement`; no fake timer or Web Audio mixer
- `DECISION-B29-ACTIVE-DIALOGUE`: shared subtitle winner from `evaluateSubtitleAtTime` determines the active audio/mouth projection
- `DECISION-B29-MOUTH`: pure transient evaluated-shot projection using only the active Dialogue's `characterId` and that character's `mouthOpenAssetId`
- `DECISION-B29-METADATA`: imported audio metadata uses the existing Main probe through a renderer-owned sequential queue; pending/error state is UI-derived or persisted by the existing metadata result, with no schema bump
- `DECISION-B29-MEDIA-TOOLS`: Windows development resolves the repository-installed FFmpeg/FFprobe packages after explicit overrides; system PATH is not the supported fallback
- `DECISION-B29-CLEANUP`: generation + identity checks, bounded Blob cache, deterministic pause/clear/revoke/dispose cleanup

## Debt

- `DEBT-COMPLEXITY-B29`: no known untracked complexity; transport, IPC, and projection remain separated by owner
- `DEBT-TEST-B29`: fake media tests prove state/transport contracts but cannot prove a real codec, speaker, OS audio device, or perceived no-overlap result; Windows gate remains mandatory
- `DEBT-DOC-B29`: none after this receipt; remote CI routing incident is documented above
- `DEBT-SCOPE-B29`: no TTS, viseme/RMS analysis, ActionPreset/timeline mouth authoring, multi-track mixer, or whole-project preview
- `DEBT-PERF-B29`: audio bytes/Blob URLs are session-scoped and bounded per read at 64 MiB; no persistent audio cache was added
- `DEBT-PLATFORM-AUDIO-B29`: browser/OS autoplay and codec behavior still require a user-gesture Windows Electron run
- `DEBT-LEGACY-AUDIO-B29`: existing legacy clips are supported with copy-on-write; orphan/unbound clip cleanup and an audio-library management UX are out of scope

## Day conclusion

- automated/structural checks: `PASS`
- maintainer human gate: `PENDING`
- overall: `PENDING` — automated PASS plus human pending is not Day29 PASS

## 下一步唯一动作

Maintainer 在 Draft PR #233 上先执行 Issue #238 的真实 Windows Electron“安排为一帧”空档验收，再执行 Issue #236 的 Retry analysis → ready → normal bind 验收，最后执行 Day29 Gate A–F（3 条 Dialogue + 3 个真实音频，含 Save→Close→Reopen、Pause→Seek→Resume、Stop、Replay 5x、切 shot/project 与降级路径）并回填结果；在此之前不进入 Day30、不 Ready、不 merge、不关闭 Issue #238/#236/#232。
