# Day 22 Test Receipt — Asset-to-Canvas Placement

## Coordinates

- Work order: `B-22/45`
- Branch: `feat/day-22-layer-placement`
- Baseline SHA: `27ba25a3287c421aa1c26041d5bc41ec86daca65`
- Prerequisites: M2 PASS; Day 21 and Issues #42/#43 PASS
- Result: PASS

## Placement and interaction contract

- Asset cards and the canvas share the existing
  `application/x-panda-stage-asset` protocol. The strict payload contains only
  version, asset ID, and a controlled asset type; paths and file contents are
  rejected.
- Fit, exact 50%, and Actual-size drops use the same inverse viewport
  transform. Client coordinates include viewport scroll before
  `screenToStage`; the resulting center point is clamped to the fixed
  `1920 × 1080` logical stage.
- Character-image payloads create character/expression sources and inherit the
  character default scale. Ordinary image payloads create direct asset
  sources. Audio and missing/mismatched asset IDs are rejected.
- New layers use center anchoring, a unique ID, `locked=false`, and the next
  z-index. A dropped ordinary image is not implicitly promoted to the formal
  shot background.
- Selection is unique and session-only. Formal backgrounds cannot be selected;
  clicking blank stage space clears selection.

## State and persistence decisions

- `DECISION-001`: During drag, Konva owns the temporary node position. No
  Project mutation or autosave is emitted until drag end. Drag end commits one
  validated center-coordinate update.
- `DECISION-002`: Drops outside the logical stage clamp the layer center to the
  nearest stage edge. Property-panel coordinates outside the stage are
  rejected instead of silently clamped.
- `DECISION-003`: `Layer.locked` is persisted in schema v3 with a backward
  default of `false`. Locking disables pointer drag and X/Y editing; the lock
  control itself remains available so the layer can be unlocked.
- `DECISION-004`: Fit, 50%, and Actual are renderer-session viewport modes.
  Neither viewport mode nor `selectedLayerId` is serialized.

## Real Electron flow

`pnpm verify:day22` drives a real sandboxed `BrowserWindow` and verifies:

1. Fit-mode dragover renders the highlighted ghost at the inverse-mapped
   logical point, then creates and selects an ordinary asset layer.
2. Exact 50% mode creates a character-backed layer at the requested center.
3. Actual-size mode with nonzero scroll creates another ordinary layer at the
   requested center.
4. Real Electron mouse input drags that layer. During pointer movement the
   complete Layer JSON and revision stay unchanged; mouseup advances the
   revision once and emits exactly one autosave update.
5. The property panel commits finite X/Y values once. Locking then prevents a
   real pointer drag from changing Layer JSON or revision.
6. Blank input clears selection. An unknown asset ID shows an error without
   changing layer count or revision.
7. Save, renderer reload, and reopen preserve the exact X/Y coordinates and
   lock state while selection remains empty.

Evidence:

- `docs/evidence/day-22/results.json`
- `docs/evidence/day-22/drop-ghost.png`
- `docs/evidence/day-22/actual-placement.png`
- `docs/evidence/day-22/reopened.png`

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| TYPE | PASS | `pnpm typecheck` |
| LINT | PASS | `pnpm lint` |
| FMT | N/A | no Prettier dependency/configuration; ESLint is the repository formatter gate |
| UNIT / COMPONENT | PASS | 62 files / 337 tests |
| INTEGRATION | PASS | 13 files / 75 tests |
| BUILD | PASS | `pnpm build` |
| DAY 19 | PASS | `pnpm verify:day19` |
| DAY 20 | PASS | `pnpm verify:day20` |
| DAY 21 | PASS | `pnpm verify:day21` |
| DAY 22 REAL/UI | PASS | `pnpm verify:day22` |

## Blade audit

| Blade | Result | Direct evidence |
|---|---|---|
| FUNC-001 drop creates Layer | PASS | service/component tests and real Fit/50%/Actual drops |
| FUNC-002 select/clear | PASS | selection-store test and real blank click |
| FUNC-003 drag logical move | PASS | interaction test and real scrolled Actual drag |
| FUNC-004 X/Y property panel | PASS | finite-input tests and real property commit |
| CONST-001 center semantics | PASS | service, render model, and persistence assertions |
| CONST-002 selection not persisted | PASS | JSON assertions and empty reopen selection |
| CONST-003 one drag-end commit | PASS | revision/autosave evidence |
| CONST-004 controlled payload | PASS | strict payload tests and recorded drag payload |
| NEG-001 invalid asset | PASS | service and real rejected-drop evidence |
| NEG-002 locked cannot move | PASS | component/service and real pointer evidence |
| NEG-003 invalid coordinates | PASS | empty/NaN/Infinity/bounds tests |
| NEG-004 exterior drop policy | PASS | clamp unit test and documented decision |
| UX-001 ghost/highlight | PASS | screenshot and machine assertions |
| UX-002 lock/error feedback | PASS | panel state and real invalid-drop status |
| E2E-001 drop→move→save→reopen | PASS | Day 22 Electron result and integration test |
| HIGH-001 scaled placement | PASS | Fit, exact 50%, Actual coordinate comparisons |

## Scope and debt

- No Transformer, rotation/scale editing, flip controls, undo/redo, timeline
  events, motion presets, or new background-design UI were added.
- `DEBT-COORD-B22-001`: not opened; all three viewport scales have exact
  automated coordinate evidence within one rendered CSS pixel after inverse
  viewport mapping.
- `DEBT-TEST-B22-001`: not opened; HTML drag/drop runs in a real BrowserWindow
  and layer movement uses real Electron mouse input.
