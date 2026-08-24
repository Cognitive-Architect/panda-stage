# Issue #315 UI-M0 baseline receipt

Status: `PARTIAL — core Wuying/Redmi interaction acceptance is PASS_WITH_LIMITS; numeric target profile receipt is pending`

This receipt freezes the current editor as a measurement baseline. The core
target interaction gate is recorded as PASS_WITH_LIMITS; the remaining numeric
profile work is handled by the Issue #317 manual sampler. This does not claim
that the cloud-mobile redesign has shipped, and it does not authorize UI-M1 or
UI-M2 production implementation.

## Opening audit

| Item | Recorded value |
| --- | --- |
| Issue | [#315](https://github.com/Cognitive-Architect/panda-stage/issues/315) |
| Implementation base | `24b412881f28df926f262975682924d5d1faec28` (`origin/main` fetched on 2026-08-24) |
| Work branch | `agent/issue-315-ui-m0` |
| Work-branch merge-base | `24b412881f28df926f262975682924d5d1faec28` |
| Design source | [PR #306](https://github.com/Cognitive-Architect/panda-stage/pull/306) at `31718ada6e7a7e531b1ef86d8f7ee1b61902e42e` |
| Planning source | [PR #307](https://github.com/Cognitive-Architect/panda-stage/pull/307) at `a6dd9c5107af6aa7da9f3e7f061988979d638343` |
| Parallel overlap | [PR #233](https://github.com/Cognitive-Architect/panda-stage/pull/233) remains Draft/Open/Unmerged; fetched live head `d7185eb2af3234405bbe5150522bc6a0928cb092` |
| PR #233 merge-base with live `main` | `66ce42ab47c4829515385adca4af58b65aef7134` |
| Production source delta | `none` |

The work branch was cut from live `main`, not from either documentation branch.
The live PR #233 overlap is intentionally not merged or modified here; its
current diff touches dialogue/audio/preview and related renderer/CSS surfaces,
so later UI work must re-check overlap before editing those areas.

## Authoritative ownership / DOM contract

| Concept | Single production owner | Stable evidence selector / contract |
| --- | --- | --- |
| Editor shell and project-session lifecycle | `src/renderer/shell/EditorShell.tsx` | `.editor-shell`, `data-editor-page`, one `ProjectSessionController` construction |
| Left workspace | `src/renderer/shell/LeftWorkspace.tsx` → `ResourceActivityDock` | `[data-testid="left-workspace-scroll"]` |
| Canvas workspace / stage | `CanvasWorkspace` → `CanvasStage` | `[data-testid="canvas-workspace-scroll"]`, `[data-testid="project-canvas-stage"]` |
| Right inspector | `src/renderer/shell/RightInspector.tsx` | `[data-testid="right-inspector"]`, narrow rail/drawer selectors |
| Bottom workspace | `src/renderer/shell/BottomWorkspace.tsx` | `[data-testid="bottom-workspace"]` |
| Timeline dock | `src/renderer/features/timeline/TimelineDock.tsx` | `[data-testid="timeline-dock"]`, collapse/ruler/playhead selectors |
| History controls | `src/renderer/features/editor/HistoryControls.tsx` | `[data-testid="history-controls"]`, `data-undo-count`, `data-redo-count` |
| Project / dirty / revision | `EditorProjectStore` singleton | one `editorProjectStore`; revision is exposed by existing diagnostic stage/manager attributes |
| History state | `EditorProjectStore.history` / `HistoryStore` | one `historyStore`; HistoryControls is the sole visible history owner |

The contract test is
`tests/integration/editor-shell-ui-m0.test.ts`. It asserts owner cardinality,
selector ownership, the shared 1100px/720px responsive seams, and that
responsive/view-only stores do not call Project or History mutation APIs.

CI routing: this contract test matches the existing `editor-shell` integration
test pattern (`tests/integration/editor-shell-*.test.ts`), so no new
`verify:*` route is required. The Electron recorder is intentionally a manual
acceptance harness under `scripts/`, not a replacement for the existing gates;
changes to it remain subject to the repository's conservative script/infrastructure
routing.

## Viewport profile contract

The repeatable recorder is
`scripts/issue315-ui-m0-electron-acceptance.cjs`. It writes a sanitized JSON
receipt outside the repository by default:

```powershell
pnpm build
pnpm exec electron scripts/issue315-ui-m0-electron-acceptance.cjs `
  --acceptance-root D:\PandaStage-Acceptance\issue-315-ui-m0 `
  --out D:\PandaStage-Acceptance\issue-315-ui-m0\ui-m0-electron-receipt.json `
  --user-data D:\PandaStage-Acceptance\issue-315-ui-m0\user-data
```

The local run uses the tracked demo fixture and records the real Electron
renderer values, display scale, owner boxes, overflow, pointer media queries,
and Project/dirty/revision/History state. It also exercises wide → narrow →
wide, narrow inspector open/close, Timeline collapse/expand, Timeline zoom and
scroll, and dialogue selection. The run is automated evidence, not maintainer
human acceptance.

Latest local receipt: `D:\PandaStage-Acceptance\issue-315-ui-m0-r7\ui-m0-electron-receipt.json`
(`2026-08-24T11:36:40.618Z`, exact HEAD
`24b412881f28df926f262975682924d5d1faec28`). It recorded CSS profiles
`1280×720 → 800×1000 (simulated portrait) → 1280×720`, renderer DPR `1.5`,
host display `811×1670`, Windows scale `1.5`, fine-pointer media query with
`maxTouchPoints=10`, and no page-level horizontal overflow. All nine runtime
owner counts stayed `1`; the baseline and final state were
`revision=0 / dirty=false / undo=0 / redo=0`. The fixture snapshot hash was
`43bd36d897c2137a67fb97bc9c21ce4bfac70754bbd150209b3ea83a546f1409`.
The recorder focused a real editor input but correctly left
`softKeyboardVisible=BLOCKED_MANUAL_REQUIRED` because it cannot observe the
Wuying/Redmi OS keyboard resize.

| Required field | Local Electron recorder | Wuying + Redmi target pass |
| --- | --- | --- |
| `devicePhysicalPx` | Records the host display through Electron `screen`; not a target-device claim | Must record actual display/orientation used for each landscape/portrait pass |
| `windowInnerCssPx` | Records `window.innerWidth / window.innerHeight` for every snapshot | Required for landscape, portrait, and round-trip |
| `devicePixelRatio` | Records renderer DPR | Required on target device |
| `windowsScale` | Records Electron primary-display `scaleFactor` | Required for the Windows host used by Wuying |
| `cloudClientScale` | `null`: not observable from product renderer | Maintainer must record the observable Wuying client setting |
| `softKeyboardVisible` | `BLOCKED_MANUAL_REQUIRED`; focus can be checked but OS keyboard resize cannot be fabricated | Record usable height before/after showing and dismissing the Redmi keyboard |
| `pointerMode` | Records coarse/fine media queries, `maxTouchPoints`, and PointerEvent availability | Confirm actual touch/mouse mapping with the Redmi path |

The design archive names Redmi K60 Ultra’s nominal `2712 × 1220` physical
resolution, but that is an intent/reference value; this receipt does not use it
as a measured CSS viewport.

## Issue #317 manual target sampler

The existing recorder now supports an explicit target-device profile. Run it
from the exact PR #316 checkout after building the Electron bundle:

```powershell
pnpm build
pnpm exec electron scripts/issue315-ui-m0-electron-acceptance.cjs `
  --profile wuying-redmi-manual `
  --acceptance-root D:\PandaStage-Acceptance\issue-315-ui-m0 `
  --out D:\PandaStage-Acceptance\issue-315-ui-m0\wuying-redmi-target-receipt.json `
  --user-data D:\PandaStage-Acceptance\issue-315-ui-m0\wuying-redmi-user-data
```

Target mode shows the real Electron window and waits for Enter at these
checkpoints; it never calls `setContentSize`, injects synthetic pointer input,
or asks for DevTools/manual JavaScript:

1. `landscape-before-keyboard`
2. `portrait-before-keyboard`
3. `portrait-keyboard-visible`
4. `portrait-keyboard-dismissed`
5. `landscape-round-trip`
6. `pointer-touch` (one tap and one short drag)

Each checkpoint records renderer CSS viewport/visual viewport values, DPR,
orientation, screen bounds, Electron display scale/work area, pointer media
queries, owner/overflow state, and a sanitized Project/History non-mutation
state. Keyboard fields are emitted as
`keyboard_before_innerHeight`, `keyboard_visible_innerHeight`,
`keyboard_after_innerHeight`, and `keyboard_usable_height_delta`; a checkpoint
typed as `unobservable` remains explicitly unavailable. The acceptance-only
event observer records pointer/mouse/touch event types, `pointerType`, trusted
status, and bounded tap/drag event evidence outside `src/**`.

At the end, the maintainer enters the literal Wuying client display label. The
receipt preserves that label in `cloudClientScale.observedMode`, keeps
`cloudClientScale.numeric` null, and records the observation source. A blank
answer is `UNOBSERVABLE`; the harness never guesses `100%`.

The generated receipt includes `repository.branch`, the exact `repository.head`,
`mergeBaseWithOriginMain`, and `sourceRefs.issue315` / `sourceRefs.pr316`.
`UI_M0_BASELINE_FROZEN` remains false until the maintainer reviews the exact
receipt and updates the closeout evidence separately.

## UI/session non-mutation evidence

Each automated snapshot carries the active project identity, revision, dirty/save
state, undo/redo counts, and history depth. The harness compares those fields
before and after every view-only action. Its fixture snapshot hash is recorded
for reproducibility; the full target-device project snapshot must be confirmed
through the normal product/acceptance evidence path.

| Action | Automated/local evidence | Target human evidence |
| --- | --- | --- |
| Wide → narrow → wide | PASS when the receipt’s stable state is byte-equal | PASS_WITH_LIMITS recorded; target sampler binds numeric fields |
| Landscape → portrait → landscape | Local harness can only model CSS dimensions; not a phone-orientation claim | PASS_WITH_LIMITS recorded; sampler records actual CSS dimensions |
| Existing narrow Inspector open/close | PASS when owner count and stable state remain unchanged | PASS_WITH_LIMITS recorded for touch open/close and focus |
| Timeline expand/collapse | PASS when stable state remains unchanged and the owner stays singular | PASS_WITH_LIMITS recorded for visual/gesture behavior |
| Zoom / scroll / seek | Zoom, scroll, and automated Electron mouse seek are exercised | PASS_WITH_LIMITS recorded; sampler records real touch events |
| Selection | PASS when dialogue selection leaves stable state unchanged | PASS_WITH_LIMITS recorded across the orientation round-trip |
| Text focus / soft keyboard | Focusability is recorded; keyboard resize is not claimed | Functional PASS_WITH_LIMITS; sampler records before/visible/after heights |

The functional target interaction suite is now recorded as
`PASS_WITH_LIMITS` in the Issue #315 / PR #316 evidence. Issue #317 closes only
the remaining numeric/profile receipt gap; it does not authorize changing the
functional gate or the UI-M0 closeout marker automatically.

## Evidence separation and closeout

```text
UI_M0_BASELINE_FROZEN = false
implementation_base = 24b412881f28df926f262975682924d5d1faec28
design_source = PR #306 @ 31718ada6e7a7e531b1ef86d8f7ee1b61902e42e
plan_source = PR #307 @ a6dd9c5107af6aa7da9f3e7f061988979d638343
production_source_changed = no
windows_electron_evidence = PARTIAL
wuying_redmi_evidence = HUMAN_INTERACTION_PASS_WITH_LIMITS
numeric_target_profile = PENDING
known_limits = exact target numeric receipt still requires the Issue #317 sampler on the maintainer device path
```

The closeout marker must not become `true` until the target landscape,
portrait, orientation round-trip, inspector/timeline, keyboard, pointer, and
non-mutation checkpoints are recorded separately from automation. No UI-M1,
UI-M2, R3 Product Workflow, or V2-S work is started by this receipt.
