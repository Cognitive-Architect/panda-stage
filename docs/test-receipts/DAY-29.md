# Panda Stage Day 29 / B29-CLUSTER 收卷

## Identity

- Day29 canonical task: `new agent task/DAY-29-AGENT-TASK.md`
- Day29 开工 main: `66ce42ab47c4829515385adca4af58b65aef7134`
- Day29 implementation/routing HEAD: `ab150aabaeb6fbb4e2c09be0d79ae57d0a352644`
- Issue #234 blocker fix HEAD: `523d068f13e879bb794eb21b689ea55dd5594bc0`
- Issue #235 blocker fix HEAD: `6a1462a3d0e3840ed6f834b54229502a429fff17`
- Delivery PR: [#233](https://github.com/Cognitive-Architect/panda-stage/pull/233)
- Delivery branch: `agent/day29-audio-mouth-preview`
- Current delivery HEAD: `6a1462a3d0e3840ed6f834b54229502a429fff17`
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
- Ready final candidate SHA: `SKIPPED` — PR remains Draft
- Ready Full run: `SKIPPED` — PR remains Draft
- Ready Full proof: `SKIPPED` — no Ready/Full candidate exists
- Final CI result: `PASS` for Draft Targeted run #449; Full remains skipped
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

Maintainer 在 Draft PR #233 上执行真实 Windows Electron 的 Day29 Gate A–F（3 条 Dialogue + 3 个真实音频，含 Save→Close→Reopen、Pause→Seek→Resume、Stop、Replay 5x、切 shot/project 与降级路径）并回填结果；在此之前不进入 Day30、不 Ready、不 merge、不关闭 Issue #232。
