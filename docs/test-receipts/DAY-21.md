# Day 21 Test Receipt — Fixed Canvas and Responsive Viewport

## Coordinates

- Work order: `B-21/45`
- Branch: `feat/day-21-canvas-stage`
- Baseline SHA: `d654e06a9825851087c6932a4b601ce33c2f2af5`
- Prerequisite: M2 Gate PASS (`docs/test-receipts/M2.md`)
- Result: PASS

## Coordinate and viewport contract

- Project coordinates are always a fixed `1920 × 1080`; `(960, 540)` is
  always the logical center.
- Fit mode uses one pure transform:
  `scale = min(containerWidth / 1920, containerHeight / 1080)`. The displayed
  stage is centered on both axes and the remaining area is letterbox space.
- Actual-size mode uses `scale = 1` and a scrolling viewport. It never changes
  the Project or Layer coordinates.
- `stageToScreen` and `screenToStage` are the only forward/inverse coordinate
  formulas. Both modes and the legacy preview consume the same domain module.
- Zero, negative, non-finite, and tiny containers produce finite values. An
  inverse mapping returns `null` when fit scale is zero.
- Device pixel ratio is deliberately absent from the logical transform.
  Konva's pixel ratio is fixed for this editor preview, so high-DPI displays
  cannot alter Project coordinates.
- Viewport mode and the last inspected point live only in
  `CanvasViewportStore`. They are not accepted by `ProjectSchema`, do not call
  `EditorProjectStore.updateProject`, and do not trigger autosave.

## Rendering contract

- The stage is a fixed Konva `1920 × 1080` surface.
- The background uses an equal-axis `cover` scale and centered crop. It never
  stretches and is `listening=false`.
- All rendered layers use their existing center-anchored Project coordinates.
  Day 21 adds no drag, selection, Transformer, undo, timeline, or layer edit.
- Horizontal and vertical center guides intersect at `(960, 540)`.
- Missing background previews show a readable repair path. Empty shots show a
  clear next-step message.
- Fit and Actual size controls provide active-state, scale, scroll, logical
  size, and pointer-coordinate feedback.

## Real Electron flow

`pnpm verify:day21` performs this sequence in a real BrowserWindow:

1. Open a populated shot and wait for thumbnail-backed canvas rendering.
2. Assert the fixed logical size, fit formula, centered offsets, cover rule,
   non-listening background, and both center guides.
3. Send a real mouse-move event at the displayed center and verify the inverse
   mapping returns `(960, 540)` within one logical pixel.
4. Capture the fit-mode screenshot.
5. Resize the real window from `1440 × 1000` to `1000 × 700`; compare the full
   Layer JSON, dirty state, revision, and autosave count.
6. Switch to Actual size, assert `scale=1` and `1920 × 1080` scroll extents,
   then capture the screenshot.
7. Save the unchanged formal Project at revision 0, reload the Renderer, reopen
   the project, and compare the complete Project and Layer JSON.
8. Open missing-background and empty-shot projects and assert their readable
   guidance.

Evidence:

- `docs/evidence/day-21/results.json`
- `docs/evidence/day-21/canvas-fit.png`
- `docs/evidence/day-21/canvas-actual.png`

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| FMT | N/A | no Prettier dependency or configuration; ESLint enforces repository TypeScript style |
| UNIT / COMPONENT | PASS | 58 files / 299 tests, including viewport geometry, cover, selectors, session store and toolbar |
| INTEGRATION | PASS | 11 files / 73 tests |
| BUILD | PASS | `pnpm build` |
| DAY 04 SHARED RENDERER | PASS | `pnpm verify:day04` |
| M2 / DAY 20 REGRESSION | PASS | `pnpm verify:day20` |
| DAY 21 REAL/UI | PASS | `pnpm verify:day21` |

## B-21/45 completion audit

| Blade | Result | Direct evidence |
|---|---|---|
| FUNC-001 fixed stage | PASS | Konva stage attributes, unit contract and Electron evidence |
| FUNC-002 fit centered | PASS | three exact container cases and real BrowserWindow offsets |
| FUNC-003 actual 1:1 | PASS | store/UI tests and 1920 × 1080 scroll evidence |
| FUNC-004 background/guides | PASS | cover selector, DOM contract and screenshots |
| CONST-001 center | PASS | `(960, 540)` forward/inverse assertions |
| CONST-002 no viewport in Project | PASS | store isolation test and exact save/reopen JSON |
| CONST-003 pure centralized formula | PASS | `src/domain/geometry/viewportTransform.ts` reused by both viewports |
| CONST-004 background unselectable | PASS | Konva `listening=false` plus machine attribute |
| NEG-001 small safe | PASS | one-pixel container test |
| NEG-002 zero safe | PASS | zero/negative/NaN tests with no Infinity |
| NEG-003 missing background readable | PASS | real alternate project and message assertion |
| NEG-004 resize no Layer mutation | PASS | exact before/after Layer JSON and autosave delta 0 |
| UX-001 empty shot guidance | PASS | real empty project assertion |
| UX-002 mode feedback | PASS | component tests and screenshots |
| E2E-001 switch/resize/save/reopen | PASS | `docs/evidence/day-21/results.json` |
| HIGH-001 click inverse mapping | PASS | real mouse input and centralized inverse formula |

## Scope and debt

- Day 21 intentionally does not add layer placement, selection, dragging,
  Transformer handles, undo/redo, timeline editing, motion presets, or
  serialization of viewport state.
- The canvas uses the existing cached thumbnail preload API for editor
  previews. Full-resolution asset loading remains a future renderer task.
- Automated Electron screenshots replace a manual video and are backed by
  machine-readable assertions.
