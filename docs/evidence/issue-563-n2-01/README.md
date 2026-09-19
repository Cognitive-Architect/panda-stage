# Issue #563 / N2-01 audit

**Status:** audit complete; documentation-only change
**Baseline:** `origin/main` at `e6059543d938befe0315da7080013c7791ee82bc`
**Audit date:** 2026-09-19
**Issue:** [#563 — Audit current Preview / Media / Export chain and freeze minimum support boundary](https://github.com/Cognitive-Architect/panda-stage/issues/563)
**Parent:** [#562 — N2 Roadmap](https://github.com/Cognitive-Architect/panda-stage/issues/562)

This artifact records what current `main` actually owns and consumes. It does
not implement an exporter, change Preview behavior, add export UI, or alter
project persistence. `EXISTS` below means that the stated narrow capability is
implemented in source and/or covered by an existing test; it does not mean
that the whole-project product path has been human-accepted.

## Executive conclusion

- The formal product path already has a read-only, single-shot Preview entry.
  It reuses the formal shot evaluator, shared Stage renderer, subtitle rules,
  bounded Main asset reads, dialogue-bound audio playback, and transient Simple
  Mouth projection.
- Project shot order and total duration are defined by `project.shots` array
  order and the `projectDurationMs` selector. The formal evaluator currently
  accepts shot-local time only. There is no project-time-to-shot-local mapper
  and no whole-project clock.
- The existing FFmpeg path is real and has encoding, muxing, probing,
  cancellation, temporary output, and packaged/development resource handling.
  Its current input is a probe renderer plus one external audio path; it is not
  a formal `Project` export path.
- The current export controls are a debug-only probe surface. No formal product
  Export entry, export snapshot, preflight, multi-shot playback, or multi-shot
  export exists on this baseline.
- The smallest honest N2 boundary is: one formal project snapshot, shots in
  array order, 1920x1080 at 24 fps, static/evaluated visual layers, subtitles,
  and explicitly supported dialogue-bound MP3/WAV AudioClips with the current
  Simple Mouth rule. Missing, unbound, overlapping, unsupported, or otherwise
  out-of-bound media must fail preflight or be explicitly deferred; it must not
  disappear silently.
- Source reachability is verified below. Real Windows Electron visual and audio
  acceptance is **UNVERIFIED** for this audit because the clean audit worktree
  has no installed dependencies and no application session was used as
  acceptance evidence.

## A. Owner / responsibility map

The classification vocabulary is the exact Issue #563 vocabulary:

`EXISTS` · `NEEDS WIRING` · `NEEDS UI ENTRY` · `NEEDS ACCEPTANCE` ·
`UNSUPPORTED / DEFERRED`

| Capability | Owner; callers / consumers | Important files | Existing tests | Current UI entry | Classification | Notes / seam |
| --- | --- | --- | --- | --- | --- | --- |
| Project shot ordering and total duration | Domain `Project.shots`; `projectDurationMs` is consumed by Shot Manager and tests. A future project clock must consume the same array. | [`projectDuration.ts`](../../../src/domain/selectors/projectDuration.ts), [`project.ts`](../../../src/domain/models/project.ts), `src/renderer/features/shots/ShotManager.tsx` | [`project-duration.test.ts`](../../../tests/unit/project-duration.test.ts), `tests/integration/shot-lifecycle.test.ts` | Shot Manager displays the sum; Preview does not consume the selector. | `EXISTS` | Array order is the only current order source. No project-time cursor is present. |
| Shot duration and shot-local evaluation | Domain `Shot.durationMs` and `evaluateShotAtTime`; Product Preview calls the evaluator and consumes its serializable result. | [`shot.ts`](../../../src/domain/models/shot.ts), [`evaluate-shot-at-time.ts`](../../../src/domain/evaluate-shot-at-time.ts) | [`evaluate-shot-at-time.test.ts`](../../../tests/unit/domain/evaluate-shot-at-time.test.ts) | Current-shot Preview. | `EXISTS` | Requested local time is rounded and clamped to `[0, durationMs]`. Timeline events are evaluated here; this is the current formal visual owner. |
| Project-time ↔ shot-local-time mapping | No current owner or caller. `projectDurationMs` only totals durations; it does not map a time to a shot. | [`projectDuration.ts`](../../../src/domain/selectors/projectDuration.ts), [`evaluate-shot-at-time.ts`](../../../src/domain/evaluate-shot-at-time.ts) | No mapper test exists. | None. | `NEEDS WIRING` | N2-03/N2-07 must add one shared mapping seam, not a second clock. |
| Evaluator and Stage rendering | Domain evaluator produces the shot state; shared Stage render model and Canvas/Konva renderer consume it. Product Preview is the current formal caller. | [`stageRenderModel.ts`](../../../src/domain/selectors/stageRenderModel.ts), [`render-model.ts`](../../../src/shared/stage/render-model.ts), [`StageRenderer.tsx`](../../../src/renderer/stage/StageRenderer.tsx), `src/renderer/stage/CanvasStage.tsx` | Evaluator and Product Preview unit/integration coverage. | Product Preview overlay. | `EXISTS` | Existing evaluator covers move, scale, opacity, shake, expression, flip, and visibility events. It is shot-local. |
| Formal single-shot Preview | `EditorShell` owns overlay lifecycle; `CompactProjectBar` invokes `onOpenProductPreview`; overlay owns only local playback state and calls evaluator/Stage/audio helpers. | [`CompactProjectBar.tsx`](../../../src/renderer/shell/CompactProjectBar.tsx), [`EditorShell.tsx`](../../../src/renderer/shell/EditorShell.tsx), [`ProductPreviewOverlay.tsx`](../../../src/renderer/shell/ProductPreviewOverlay.tsx), [`productPreviewModel.ts`](../../../src/renderer/shell/productPreviewModel.ts) | [`product-preview-overlay.test.ts`](../../../tests/unit/product-preview-overlay.test.ts), [`editor-shell-project-session.test.ts`](../../../tests/integration/editor-shell-project-session.test.ts), [`editor-shell-layout.test.ts`](../../../tests/integration/editor-shell-layout.test.ts) | `data-testid="quick-action-play"`, label/title “预览当前镜头”; one overlay owned by `EditorShell`. | `EXISTS` | Play/pause, stop, replay, seek, end stop, Escape close, bounded image loading, and local cleanup exist for one shot. |
| Dialogue → subtitle cues | Shared subtitle engine owns interval selection; Preview projects current shot dialogues into that cue contract and `SubtitleRenderer` consumes the winner. | [`subtitle-engine.ts`](../../../src/shared/preview/subtitle-engine.ts), [`dialogue-subtitle.ts`](../../../src/shared/preview/dialogue-subtitle.ts), [`productPreviewModel.ts`](../../../src/renderer/shell/productPreviewModel.ts) | [`product-preview-overlay.test.ts`](../../../tests/unit/product-preview-overlay.test.ts), [`dialogue-audio-binding.test.ts`](../../../tests/unit/dialogue-audio-binding.test.ts) | Subtitle appears in the current-shot Preview. | `EXISTS` | New cue validation rejects overlaps; selection is start-inclusive/end-exclusive. Legacy overlap selection is deterministic. |
| Dialogue-bound AudioClip playback in current Preview | Renderer `productPreviewAudio` selects the active dialogue’s bound clip; Main `AssetPreviewAudioService` validates and reads bytes through Preload. A single reusable HTML Audio element consumes it. | [`productPreviewAudio.ts`](../../../src/renderer/shell/productPreviewAudio.ts), [`AssetPreviewAudioService.ts`](../../../src/main/services/AssetPreviewAudioService.ts), `src/shared/asset-preview-audio-api.ts`, `src/preload/index.ts` | [`product-preview-audio.test.ts`](../../../tests/unit/product-preview-audio.test.ts), [`asset-preview-audio-service.test.ts`](../../../tests/unit/asset-preview-audio-service.test.ts), [`dialogue-audio-trim.test.ts`](../../../tests/unit/dialogue-audio-trim.test.ts) | Audio is part of the current-shot Preview; unavailable media produces a warning state. | `EXISTS` | Selection is one active dialogue-bound clip, `[startMs,endMs)`, with `offsetMs`, clamped source time, and HTML volume clamped to `[0,1]`. It does not mean all `shot.audioClips` are mixed. |
| All formal AudioClip composition across a project | No owner. Current Preview ignores unbound clips and cannot compose multiple active clips or cross-shot audio. Existing export accepts one raw `audioPath`, not project clips. | [`audio.ts`](../../../src/domain/models/audio.ts), [`dialogue.ts`](../../../src/domain/models/dialogue.ts), [`productPreviewAudio.ts`](../../../src/renderer/shell/productPreviewAudio.ts), [`ExportService.ts`](../../../src/main/services/ExportService.ts) | Audio binding/persistence tests cover pieces, not whole-project composition. | No whole-project entry. | `NEEDS WIRING` | The first export boundary must reject or explicitly defer unbound/overlapping/unsupported tracks until a composition contract exists. |
| Simple Mouth | `projectProductPreviewMouth` is a transient renderer projection after formal evaluation; it reads the active dialogue, bound clip interval, character `mouthOpenAssetId`, and image asset. | [`productPreviewModel.ts`](../../../src/renderer/shell/productPreviewModel.ts), [`character.ts`](../../../src/domain/models/character.ts) | [`product-preview-mouth.test.ts`](../../../tests/unit/product-preview-mouth.test.ts) | Visible only through current-shot Product Preview. | `EXISTS` | This is a binary mouth-open image swap for the active clip. It is not full lip-sync recognition and is not persisted. |
| Project/file/media services | Main owns project and asset filesystem access. Preview uses bounded, hash-checked image/audio APIs; metadata uses media inspection and FFprobe. Renderer has no Node/fs access. | [`AssetCanvasImageService.ts`](../../../src/main/services/AssetCanvasImageService.ts), [`AssetPreviewAudioService.ts`](../../../src/main/services/AssetPreviewAudioService.ts), [`MediaInspectionService.ts`](../../../src/main/services/MediaInspectionService.ts), `src/main/services/AssetMetadataService.ts` | [`asset-preview-audio-service.test.ts`](../../../tests/unit/asset-preview-audio-service.test.ts), [`media-inspection-service.test.ts`](../../../tests/unit/media-inspection-service.test.ts), `tests/integration/asset-metadata.test.ts` | Product Preview consumes the allowlisted APIs; no direct file UI is part of this audit. | `EXISTS` | Main validates project root, tracked asset identity, hash, MIME/signature, size and containment before returning bytes. |
| Existing full-probe render/export chain | `App` debug surface → Preload export API → Main IPC → `ExportService` → hidden renderer → PNG frame files → `FFmpegAdapter` → probe/mux/commit. Gate A also calls the same service. | [`App.tsx`](../../../src/renderer/App.tsx), [`index.ts`](../../../src/preload/index.ts), `src/main/ipc/register-ipc-handlers.ts`, [`ExportService.ts`](../../../src/main/services/ExportService.ts), [`ExportRendererApp.tsx`](../../../src/export-renderer/ExportRendererApp.tsx) | [`export-service.test.ts`](../../../tests/unit/export-service.test.ts), FFmpeg adapter tests. | Debug-only `?debug=1` “完整导出探针”; not formal product flow. | `EXISTS` | The pipeline is real but probe-shaped: hard-coded `PROBE_PROJECT`, `PROBE_SHOT`, `PROBE_SUBTITLE_CUES`, `PROBE_ASSET_URLS`, fixed duration range, and one external audio file. |
| Formal Project export entry and snapshot | No product owner/caller exists. The current request accepts `projectDirectory`, `audioPath`, `outputPath`, duration, FPS and audio start; it does not carry a formal project snapshot. | [`export-types.ts`](../../../src/shared/export-types.ts), [`App.tsx`](../../../src/renderer/App.tsx), [`ExportService.ts`](../../../src/main/services/ExportService.ts) | Probe/export tests cover the existing request, not formal Project export. | No formal Export action. | `NEEDS UI ENTRY` | N2-02 and N2-05 must define the product action, snapshot, preflight, overwrite policy, and error surface before N2-06. |
| FFmpeg / encoder / output protection | Main `FFmpegAdapter` owns child-process execution, encoder checks, PNG→H.264 encoding, single-audio AAC mux, FFprobe checks and cancellation. `ExportService` owns staging/cleanup/commit sequencing. | [`FFmpegAdapter.ts`](../../../src/main/services/FFmpegAdapter.ts), [`ffmpeg-types.ts`](../../../src/shared/ffmpeg-types.ts), [`ExportService.ts`](../../../src/main/services/ExportService.ts), `src/main/windows/hidden-window-manager.ts` | [`ffmpeg-adapter.test.ts`](../../../tests/unit/ffmpeg-adapter.test.ts), [`ffmpeg-audio-mux.test.ts`](../../../tests/unit/ffmpeg-audio-mux.test.ts), public/error/process-runner contract tests. | Only debug probe reaches it. | `EXISTS` | Current contract checks H.264/yuv420p, 1920x1080, 24 fps, AAC, frame/audio/container durations, temp output and atomic final commit. |
| Canvas size and FPS | Domain constants and shared export schemas are the owners. Stage and export frame contracts consume them. | [`constants.ts`](../../../src/domain/constants.ts), [`export-types.ts`](../../../src/shared/export-types.ts), [`ffmpeg-types.ts`](../../../src/shared/ffmpeg-types.ts) | [`production-resources.test.ts`](../../../tests/unit/production-resources.test.ts) plus export/FFmpeg tests. | Canvas and probe renderer are fixed to the same values. | `EXISTS` | Current values are 1920×1080 and 24 fps. The probe duration is separately constrained to 3000–5000 ms; that is not a formal project-duration rule. |
| Accepted media formats | `MediaInspectionService` owns import/signature policy; Preview audio API accepts the validated audio MIME types. | [`MediaInspectionService.ts`](../../../src/main/services/MediaInspectionService.ts), `src/shared/asset-preview-audio-api.ts` | [`media-inspection-service.test.ts`](../../../tests/unit/media-inspection-service.test.ts), [`product-preview-audio.test.ts`](../../../tests/unit/product-preview-audio.test.ts) | Asset import and current Preview. | `EXISTS` | Imported media is PNG/JPG/JPEG and MP3/WAV; audio playback accepts `audio/mpeg` and `audio/wav`. AAC/OGG/etc. are not current imported-asset support. |
| Development and packaged media resources | Main resolves development binaries from env or Windows installer packages; packaged builds resolve `resourcesPath/media` and `resourcesPath/probe`. Builder copies FFmpeg, FFprobe and probe WAV to those locations. | [`production-resources.ts`](../../../src/main/services/production-resources.ts), [`production-resources.test.ts`](../../../tests/unit/production-resources.test.ts), [`electron-builder.yml`](../../../electron-builder.yml) | [`production-resources.test.ts`](../../../tests/unit/production-resources.test.ts) | No separate UI; failures surface through Main/export diagnostics. | `EXISTS` | Windows assumes `.exe` installer resources in packaged builds and `@ffmpeg-installer/win32-x64` / `@ffprobe-installer/win32-x64` in development. |
| Existing targeted test evidence | Test ownership is split across domain, Preview, media, export and integration suites. No test proves whole-project Preview or real product MP4 acceptance. | Test files linked in the rows above. | See [targeted test inventory](#targeted-test-inventory). | None. | `EXISTS` | The test inventory proves narrow contracts; it does not replace Windows Electron viewing/listening. |
| Real Windows Electron Preview / Export acceptance | Maintainer/human acceptance, not a source owner. Source reachability is visible in `EditorShell`; runtime evidence is not available in this audit. | [`useDebugFlag.ts`](../../../src/renderer/shell/useDebugFlag.ts), [`EditorShell.tsx`](../../../src/renderer/shell/EditorShell.tsx), [`App.tsx`](../../../src/renderer/App.tsx) | Integration tests assert source structure and mounting contracts only. | Preview source entry is reachable; Export is debug-only by URL flag. | `NEEDS ACCEPTANCE` | `quick-action-play` is source-reachable. Real window, constrained layout, DPI, Chinese/long text, image loading, audio and output playback remain unverified. |
| Full lip-sync, BGM mixing, rig/skeleton, FLA rewrite, general action authoring, and unrestricted multi-track audio | No current owner in the audited path; explicitly outside the N2 roadmap boundary. | See N2 parent non-goals and the formal models above. | No acceptance tests for these capabilities. | None. | `UNSUPPORTED / DEFERRED` | These must not be silently treated as exported content. A future issue must define a separate compatible contract. |

## B. Capability classification decisions

The table above classifies every capability requested by Issue #563. The
important distinction is between a narrow implementation and a complete
product capability:

1. `EXISTS` covers current single-shot Preview, formal shot evaluation, the
   bounded media bridge, the Simple Mouth projection, the probe export chain,
   FFmpeg/resource foundations, and the fixed canvas/FPS/media policy.
2. `NEEDS WIRING` covers the missing shared project-time mapper and complete
   AudioClip composition across shots.
3. `NEEDS UI ENTRY` covers formal Project export: the current debug probe is
   not a product Export action.
4. `NEEDS ACCEPTANCE` covers real Windows Electron behavior and output
   viewing/listening. Source and test presence are not human acceptance.
5. `UNSUPPORTED / DEFERRED` covers the explicitly out-of-scope content listed
   in the final map row.

## C. Project-time contract

### Verified current contract

| Concept | Current source of truth | Boundary behavior |
| --- | --- | --- |
| Shot order | `project.shots` array order | No sort or alternate order is applied by `projectDurationMs`. |
| Shot duration | `shot.durationMs`, integer and at least 500 ms | Formal shot evaluator clamps its requested local time to `[0, durationMs]` after rounding to an integer millisecond. |
| Project total duration | `sum(project.shots[i].durationMs)` | `projectDurationMs` is a selector only; it is not currently a playback clock. |
| Project → local mapping | Not implemented | No current whole-project Preview or Export caller performs this mapping. |
| Local → project mapping | Not implemented | No reverse mapping helper exists. |
| Subtitle/audio active interval | Shared Preview rules | Both subtitle selection and current dialogue-bound audio use start-inclusive/end-exclusive `[startMs, endMs)`. |
| Timeline event endpoint | Formal shot evaluator | Existing event evaluation has its own `endMs` handling; the N2 mapper must not silently change those event semantics. |

### Contract to freeze before N2-03/N2-07

Use one shared pure mapper consumed by both Preview and Export:

```text
prefix(shotIndex) = sum(durationMs of shots before shotIndex)
projectTime = prefix(shotIndex) + shotLocalTime
```

For a project with shots `S[0..n-1]` and total `T`:

- active shot intervals are `[prefix(i), prefix(i) + duration(i))`;
- at an exact boundary `t == prefix(i+1)`, ownership belongs to `S[i+1]`
  at local time `0`, never to both shots;
- `t == 0` maps to the first shot at local `0`;
- `t == T` is the terminal sample and maps to the final shot at its exact
  duration; normal playback frames remain in `[0, T)`;
- inputs below `0` clamp to the first sample and inputs above `T` clamp to the
  terminal sample;
- reverse mapping is `prefix(i) + clamp(local, 0, duration(i))` and requires
  the shot identity, so it cannot invent a second order source;
- the frame scheduler remains at 24 fps and samples `floor(frameIndex / 24 *
  1000)` milliseconds, while the mapper owns shot-boundary selection.

This is a proposed frozen contract for the next implementation cards, not a
claim that the mapper already exists. N2-03 must add boundary tests before
N2-06/N2-07 reuse it.

## D. First export support boundary

The existing probe export is not promoted to product export by this audit. The
following is the smallest explicit boundary for the first formal MP4 path:

| Content / behavior | First formal path may support | Preflight / deferral rule |
| --- | --- | --- |
| Static visual layers | All referenced image layers that pass the existing tracked-asset, hash, MIME and image validation. | Missing, mismatched or unreadable assets are actionable preflight failures. They are never dropped. |
| Current dynamic visual content | The existing formal evaluator events: move, scale, opacity, shake, expression, flip and visibility, evaluated per shot through the shared mapper. | New authoring systems, rigging and unrecognized event kinds are not implied. Unsupported event data must fail or be explicitly deferred. |
| Dialogue and subtitles | Dialogue text projected to shared subtitle cues, with the existing style/reference rules and start-inclusive/end-exclusive visibility. Text-only dialogue is allowed as subtitle content. | Invalid/non-positive spans or missing style/asset references must be reported according to the formal validation contract; no silent subtitle omission. |
| Real AudioClip playback | Dialogue-bound AudioClips using currently accepted MP3/WAV assets, `startMs`, `endMs`, `offsetMs`, and the currently defined `[0,1]` playback-volume behavior, with serial clips across the project. | An unbound clip, unsupported format, missing asset, invalid range, `volume > 1` without an approved gain contract, or overlapping/multi-track composition is rejected or explicitly deferred until the audio composition contract is expanded. |
| Simple Mouth | The current deterministic binary mouth-open image projection when a valid dialogue-bound clip and `mouthOpenAssetId` image exist. | Full lip-sync is deferred. If a project requests a mouth asset that is missing/invalid, preflight reports it; it must not silently claim mouth animation was rendered. |
| Project scope | One complete formal Project snapshot, shots in `project.shots` order, using the shared project-time mapper. | The current probe request is not a substitute: it supplies a project directory, one raw audio path and a fixed probe duration. |
| Output | MP4 with H.264 video, yuv420p, 1920×1080, 24 fps and AAC audio, using the existing controlled FFmpeg path and staging/commit protections. | Existing-file, temp-file, cancellation and failed-output policy must be carried into the formal UI flow. |
| Explicitly out of boundary | BGM mixing, unrestricted simultaneous/multi-track audio, full lip-sync recognition, rig/skeleton systems, FLA rewrite and general-purpose action authoring. | Mark `UNSUPPORTED / DEFERRED` in preflight or the task result. Never export a partial file while reporting success. |

The first path therefore supports evaluated visuals plus explicit subtitle/audio
semantics; it does not mean every current model field is automatically
renderable. N2-05 must make the rejection/defer result actionable before the
expensive render begins.

## E. Validation and comparison proposal

### Comparison points and fixed tolerances

| Check | Evidence point | Proposed tolerance / rule | Reason |
| --- | --- | --- | --- |
| Project shot boundary | Evaluate/render at `boundary - 1 ms`, `boundary`, and `boundary + 1 ms`; also compare adjacent 24-fps frame samples. | Logical ownership is exact: before belongs to the prior shot, at the boundary belongs only to the next shot at local `0`, after advances only the next shot. | A one-millisecond probe catches double ownership and dropped first-frame state without hiding an off-by-one error behind a broad tolerance. |
| Shot-local evaluator | Test local `0`, `duration - 1`, `duration`, and a value beyond duration. | Integer local time follows the current round-then-clamp contract exactly. | Reuses existing evaluator semantics and prevents the project mapper from changing a shot’s meaning. |
| Subtitle tail | Check `endMs - 1 ms` and `endMs` for every boundary cue. | Visible at `endMs - 1`; absent at `endMs` (exact end-exclusive rule). | This is already the shared subtitle contract and is more precise than a visual-duration guess. |
| Audio start/end | Verify computed source position at clip start, one millisecond before/after clip end, and at source offset. | Integer source mapping is exact; the clip is active only in `[startMs,endMs)`. For encoded container duration, retain the existing FFprobe tolerance of **0.08 s**, not wider. | Source timing is deterministic; 80 ms is already the repository’s explicit FFprobe/container tolerance and covers codec/container timestamp quantization without masking logical boundary errors. |
| Output stream shape | FFprobe the final file. | Exact codec/pixel-size/FPS/frame-count/sample-rate/channel checks; duration fields within the existing 0.08 s contract. | These checks already exist in `ffmpeg-types.ts`/`FFmpegAdapter`; reuse rather than loosen them. |
| Mouth state | Compare the active dialogue clip interval at `start`, `end - 1`, and `end`. | Mouth-open image only inside the same half-open clip window; no mouth swap at `end`. | Simple Mouth must share the audio/dialogue interval instead of inventing another clock. |

No tolerance may be widened after implementation solely to make a failing test
pass. If a new media/container limitation is found, record the observed error,
the affected layer, and a maintainer-approved contract change separately.

### Targeted test inventory

Existing focused evidence available on this baseline:

- Domain/time: `tests/unit/project-duration.test.ts`,
  `tests/unit/domain/evaluate-shot-at-time.test.ts`,
  `tests/integration/shot-lifecycle.test.ts`.
- Product Preview: `tests/unit/product-preview-overlay.test.ts`,
  `tests/integration/editor-shell-project-session.test.ts`,
  `tests/integration/editor-shell-layout.test.ts`.
- Preview media: `tests/unit/product-preview-audio.test.ts`,
  `tests/unit/product-preview-mouth.test.ts`,
  `tests/unit/product-preview-images.test.ts`,
  `tests/unit/asset-preview-audio-service.test.ts`.
- Dialogue/media: `tests/unit/dialogue-audio-binding.test.ts`,
  `tests/unit/dialogue-audio-trim.test.ts`,
  `tests/integration/dialogue-audio-persistence.test.ts`,
  `tests/unit/media-inspection-service.test.ts`.
- Export/encoder/resources: `tests/unit/export-service.test.ts`,
  `tests/unit/ffmpeg-adapter.test.ts`,
  `tests/unit/ffmpeg-audio-mux.test.ts`, the FFmpeg public/error/process-runner
  contract tests, and `tests/unit/production-resources.test.ts`.

For implementation cards, the focused command form is:

```powershell
pnpm test:unit -- tests/unit/product-preview-overlay.test.ts tests/unit/product-preview-audio.test.ts tests/unit/product-preview-mouth.test.ts tests/unit/product-preview-images.test.ts tests/unit/domain/evaluate-shot-at-time.test.ts tests/unit/project-duration.test.ts tests/unit/export-service.test.ts tests/unit/ffmpeg-adapter.test.ts tests/unit/ffmpeg-audio-mux.test.ts tests/unit/media-inspection-service.test.ts tests/unit/production-resources.test.ts
```

This audit did not manually trigger Full CI, `pnpm verify:project`, or a
historical verifier sweep. The clean audit worktree has no `node_modules`, so
the test inventory above is source/test evidence, not a new test execution
claim.

### Windows / Electron evidence status

| Surface | Source evidence | Human evidence in this audit |
| --- | --- | --- |
| Current Preview | `CompactProjectBar` exposes `quick-action-play`; `EditorShell` owns and mounts one `ProductPreviewOverlay`; integration tests assert the route. | **UNVERIFIED**: no real Windows Electron session used for visual, focus, constrained-window, DPI, long Chinese text, image-load or audio acceptance. |
| Existing Export | `App` supplies a debug `export-probe` surface; `EditorShell` renders `debugSurface` only when `?debug=1`; it calls the full-probe IPC request. | **UNVERIFIED**: no claim that the debug probe is a supported product Export flow. |
| Formal product Export | No source entry found in the formal shell. | **UNVERIFIED / not present on this baseline**; this is a gap, not an acceptance failure. |

## F. N2-02 → N2-09 refresh notes

These are planning updates only. They do not implement later cards.

| Card | Refresh decision | Evidence-based scope after N2-01 |
| --- | --- | --- |
| N2-02 — Preview + export UX contract | `SHRINK` | Do not redesign the existing single-shot Preview transport or create another player. Define the missing whole-project transport, formal Export entry, preflight, output policy, cancellation/close behavior, and constrained-window states around the existing owners. |
| N2-03 — Two-shot continuous project Preview | `STILL REQUIRED` | The shot evaluator, Stage renderer, subtitle rules, audio selection, and Simple Mouth projection can be reused, but the shared project-time mapper and cross-shot media handoff do not exist. |
| N2-04 — Cross-shot seek / stop / replay / lifecycle cleanup | `STILL REQUIRED` | Current single-shot transport has local seek/stop/replay cleanup. Cross-shot seek, stale cross-shot media invalidation, and project-clock lifecycle behavior remain unimplemented. |
| N2-05 — Export snapshot + preflight validation | `STILL REQUIRED` | Existing `ExportService` protects temporary/final files, but its request is probe-shaped and has no formal Project snapshot, reference validation, or actionable aggregate preflight. |
| N2-06 — Real single-shot MP4 through formal UI | `SHRINK` | Reuse the existing hidden renderer, FFmpeg encoder/muxer, FFprobe checks, resource lookup, cancellation and atomic commit. The remaining work is the formal Project snapshot/render input, supported content preflight, and product UI path; do not rebuild FFmpeg. |
| N2-07 — Multi-shot MP4 using shared time rules | `STILL REQUIRED` | The output foundation exists, but complete-project frame scheduling, shot-boundary mapping, subtitle/audio/mouth continuity, and unsupported-content reporting do not. |
| N2-08 — Progress / cancel / retry / artifact protection | `SHRINK` | Existing status phases, cancellation guards, temp job directory, staging output, cleanup and commit protections are reusable. The formal UI task lifecycle, retry/snapshot policy, and human behavior remain to be connected and accepted. |
| N2-09 — Gate B real-project acceptance | `STILL REQUIRED` | No real-project Windows Electron Preview→MP4→real-player viewing/listening evidence exists in this audit. Automated green tests cannot replace Gate B human evidence. |

## Audit boundary and handoff

No product code, schema, Preview behavior, export UI, or historical verifier
was changed for N2-01. The next card is N2-02, which must use this artifact as
the current-state input and preserve the single formal project/store/evaluator
ownership described above.
