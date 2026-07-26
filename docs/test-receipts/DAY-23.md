# Day 23 Test Receipt — Layer Transform, Order, Lock, and Delete

## Result

- Work order: `B-23/45`
- Branch: `feat/day-23-layer-transform`
- Baseline: `4a5266c` (`main`, PR #44 merged)
- Result: PASS
- Scope: static layer transform, z-order, locking, deletion, persistence,
  schema v5 migration, and real Electron interaction evidence

## Decisions

### DECISION-001 — explicit flip model and schema v5

- Schema v4 requires positive `scaleX` / `scaleY`; a negative scale cannot be
  introduced under the same strict version.
- Schema v5 adds required `flipX: boolean`.
- v4 → v5 adds `flipX=false`, preserving every v4 visual exactly.
- New character layers copy `Character.defaultFlipX`; direct assets start
  unflipped.
- Rendering applies the sign only at the Konva boundary:
  `render.scaleX = flipX ? -scaleX : scaleX`.
- Model scale remains positive and uniform; flipping never modifies `x/y`.

### DECISION-002 — z-order representation

- `Layer.zIndex` remains the persisted source of truth.
- The background is pinned to `zIndex=0`.
- Content layers are sorted and normalized to continuous indexes after every
  reorder or deletion.
- Forward, backward, front, and back operations update the project model;
  the editor render model sorts by that same value.

### DECISION-003 — deletion and references

- Background and locked layers reject deletion.
- Deleting a content layer removes timeline events that reference it, avoiding
  dangling project references.
- `LayerSelectionStore` reconciles immediately and clears `selectedLayerId`.
- Selection and Transformer state remain renderer-only and are never
  serialized.

## Implemented behavior

- A selected unlocked content layer attaches a real Konva Transformer.
- Corner anchors keep aspect ratio; the model stores one positive uniform
  scale in both `scaleX` and `scaleY`.
- Transformer end commits exactly one project revision.
- Rotation is normalized to `[-180, 180)`.
- Scale is restricted to `0.05–20`; opacity to `0–1`; all transform numbers
  must be finite.
- The property panel synchronizes `x`, `y`, scale, rotation, opacity, flip,
  and lock state in both directions.
- Horizontal flip preserves the visual center.
- Lock removes the Transformer and disables transform, order, and delete
  controls.
- Delete/Backspace removes the selected content layer; an empty selection is a
  no-op.
- Background layers are non-selectable and reject move, transform, order,
  lock, and delete service calls.

## Automated checks

| Check | Result | Evidence |
|---|---|---|
| `pnpm typecheck` | PASS | renderer + Electron TypeScript |
| `pnpm lint` | PASS | no ESLint errors |
| `pnpm test:unit` | PASS | 63 files / 373 tests |
| `pnpm test:integration` | PASS | 15 files / 77 tests |
| `pnpm build` | PASS | renderer + Electron production build |
| `pnpm verify:day19` | PASS | character definitions regression |
| `pnpm verify:day20` | PASS | shot management regression |
| `pnpm verify:day21` | PASS | fixed canvas and viewport regression |
| `pnpm verify:day22` | PASS | layer placement regression |
| `pnpm verify:day23` | PASS | real sandboxed Electron workflow |
| Formatting | N/A | repository has no Prettier dependency or configuration; ESLint and TypeScript are authoritative |

Key tests:

- `tests/unit/layer-service.test.ts`
- `tests/unit/day23-layer-controls.test.ts`
- `tests/unit/canvas-layer-interaction.test.ts`
- `tests/unit/layer-stores.test.ts`
- `tests/unit/migrations/project-migration.test.ts`
- `tests/integration/layer-transform-lifecycle.test.ts`
- `tests/integration/schema-v5-layer-flip.test.ts`

## Real Electron evidence

`pnpm verify:day23` performs this actual UI flow:

1. Open a schema v5 project.
2. Drag a character expression from the asset library; verify automatic
   selection and a visible Transformer.
3. Drag a Transformer corner; verify one revision and increased uniform scale.
4. Enter `x=800`, `y=450`, `scale=1.25`, `rotation=450`, `opacity=0.6`;
   verify persisted rotation is normalized to `90`.
5. Flip horizontally; verify center remains exactly `(800, 450)`.
6. Move the layer to back and then front; verify continuous zIndex.
7. Lock; verify Transformer removal and disabled transform/order controls.
8. Unlock, save, reload, and reopen; verify all static transform values.
9. Delete one layer with the button, then select another and press Delete;
   verify both paths and selection cleanup. Press Delete again with no
   selection; verify revision unchanged.

Evidence:

- `docs/evidence/day-23/results.json`
- `docs/evidence/day-23/transformer.png`
- `docs/evidence/day-23/locked.png`
- `docs/evidence/day-23/deleted.png`

## Blade table

| ID | Result | Proof |
|---|---|---|
| FUNC-001 | PASS | Transformer gesture + transform unit tests |
| FUNC-002 | PASS | exact center equality before/after `flipX` |
| FUNC-003 | PASS | four order actions + continuous zIndex |
| FUNC-004 | PASS | button/keyboard contract + selection reconciliation |
| CONST-001 | PASS | finite validators and ProjectSchema |
| CONST-002 | PASS | shared zIndex model + integration reopen |
| CONST-003 | PASS | service and real UI locked negative paths |
| CONST-004 | PASS | serialized JSON excludes selection |
| NEG-001 | PASS | NaN/Infinity matrix |
| NEG-002 | PASS | `0.05–20` boundary checks |
| NEG-003 | PASS | empty-selection Delete revision unchanged |
| NEG-004 | PASS | background service rejection matrix |
| UX-001 | PASS | Transformer/locked screenshots |
| UX-002 | PASS | order/delete status outputs and controls |
| E2E-001 | PASS | transform → order → save → reopen |
| HIGH-001 | PASS | expression and flip center tests |

## Regression and scope audit

- Day 22 drag positioning and drag-end commit semantics remain covered.
- Day 19 expression resolution continues to preserve the provided center.
- No undo/redo, timeline transform editing, multi-select, alignment tools, or
  Day 24 guide work was added.
- Deletion only removes already-associated timeline references; it does not
  introduce timeline editing UI.

## P4 self-test

| Check | Result | Evidence |
|---|---|---|
| CF | PASS | scale, rotate, flip, order, lock, and both delete paths |
| RG | PASS | Day 19–22 gates and current unit/integration suites |
| NG | PASS | finite/range, locked, background, and empty-selection tests |
| UX | PASS | Transformer, locked, and deleted screenshots |
| E2E | PASS | real Electron transform → order → save → reopen flow |
| High | PASS | expression and flip center comparisons |
| Field completeness | PASS | values, order, revisions, and screenshots recorded |
| Requirement mapping | PASS | all 16 blade-table rows have direct evidence |
| Real interaction | PASS | Transformer handle and Delete key use native input events |
| Scope/debt | PASS | no history, timeline-transform UI, multi-select, or alignment work |

## Fuse audit

- `GEOM-B23-001`: not triggered; flip and expression changes preserve center.
- `DATA-B23-001`: not triggered; non-finite and out-of-range transforms reject.
- `STATE-B23-001`: not triggered; lock and selection cleanup are verified.
- `ORDER-B23-001`: not triggered; zIndex is normalized and reopened unchanged.
- `TEST-B23-001`: not triggered; the real Transformer and keyboard flow is
  repeatable under `pnpm verify:day23`.

## Debt

- `DEBT-GEOMETRY-B23-001`: none.
- `DEBT-TEST-B23-001`: none; real Transformer, keyboard, lock, persistence,
  and screenshots are automated.
