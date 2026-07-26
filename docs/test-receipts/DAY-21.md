# Day 21 Test Receipt — Fixed Canvas and Shared Rendering

## Coordinates

- Work order: `B-21/45`
- Hardening issue: `#42`
- Branch: `feat/day-21-canvas-stage`
- Baseline SHA: `9e65cc51e7c6ac8372b8474b86cf2924200bfb2c`
- Prerequisite: M2 Gate PASS (`docs/test-receipts/M2.md`)
- Result: PASS

## Schema and background identity

- The formal Project schema is version 3.
- `Shot.backgroundLayerId` is the sole runtime background identity. A normal
  asset layer remains content even when its name contains `background` or
  `背景`, or its `zIndex` is zero.
- Version 1 and 2 projects migrate conservatively: only one centered, large,
  direct-image candidate may become the explicit background. Ambiguous and
  small layers remain ordinary content.
- Validation rejects dangling and character-backed background references.
  Shot duplication remaps the background ID to the copied layer.
- Integration coverage opens a v2 project, migrates it, duplicates and removes
  shots, saves v3, and reopens without a dangling reference.

## Shared rendering contract

- `src/shared/stage/layer-render-contract.ts` is the pure, testable contract for
  cover/crop, position, scale, rotation, opacity, visibility, z-order, asset
  resolution inputs, and non-listening rendering.
- The editor model in `src/domain/selectors/stageRenderModel.ts` and the shared
  renderer model in `src/shared/stage/render-model.ts` both consume that
  contract. `CanvasStage` and `StageRenderer` only render its instructions.
- Contract tests compare both paths for a non-16:9 background, invisible and
  semi-transparent backgrounds, and ordinary transformed layers.

## Coordinate and viewport contract

- Project coordinates are fixed at `1920 × 1080`; `(960, 540)` is the logical
  center.
- Fit mode uses
  `scale = min(containerWidth / 1920, containerHeight / 1080)` and centers the
  stage in letterbox space.
- Actual-size mode uses `scale = 1` in a scrolling viewport. Pointer mapping
  uses the inverse stage transform and includes the real scroll offset.
- Viewport mode and inspected points live only in `CanvasViewportStore`; they
  are not serialized, do not mutate Project/Layer data, and do not trigger
  autosave.
- Resize, Fit/Actual switching, pointer movement, save, reload, and reopen all
  preserve the complete Layer JSON, clean state, and revision.

## Real Electron evidence

`pnpm verify:day21` drives real `BrowserWindow` instances and asserts:

1. Fit geometry, centered offsets, explicit background identity, shared render
   contract marker, cover behavior, opacity, guides, and inverse mapping.
2. Resize from `1440 × 1000` to `1000 × 700` without Layer, revision, dirty, or
   autosave mutation.
3. Actual-size mode after nonzero scroll. A real mouse event maps to the
   expected logical point within one logical pixel.
4. A second Chromium window with CDP `deviceScaleFactor: 1.5` repeats real Fit
   and nonzero-scroll Actual pointer input within one logical pixel.
5. Exact save/reload/reopen persistence plus readable missing-background and
   empty-shot states.

Evidence:

- `docs/evidence/day-21/results.json`
- `docs/evidence/day-21/canvas-fit.png`
- `docs/evidence/day-21/canvas-actual.png`

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| UNIT / COMPONENT | PASS | 59 files / 307 tests |
| INTEGRATION | PASS | 12 files / 74 tests |
| BUILD | PASS | `pnpm build` |
| DAY 04 SHARED RENDERER | PASS | `pnpm verify:day04` |
| DAY 20 REGRESSION | PASS | `pnpm verify:day20` |
| DAY 21 REAL/UI | PASS | `pnpm verify:day21` |

## Scope and debt

- Day 21 adds no drag/drop, selection, transforms, undo/redo, timeline editing,
  motion presets, or viewport serialization.
- High-DPI behavior has real automated evidence at device scale factor 1.5, so
  `DEBT-PLATFORM-B21-001` is not required.
- The canvas continues to use the existing thumbnail preload API for editor
  previews. Full-resolution asset loading remains a future renderer concern.
