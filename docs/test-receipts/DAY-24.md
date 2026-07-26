# Day 24 Test Receipt — Command History, Undo/Redo, and Drag Coalescing

## Result

- Work order: `B-24/45`
- Branch: `feat/day-24-history`
- Baseline: `ed046c1` (`main`, PR #46 merged)
- Result: PASS
- Scope: bounded in-memory command history, undo/redo buttons and shortcuts,
  gesture-safe coalescing, project-switch reset, dirty-state replay, and real
  Electron evidence
- Issue #49 closeout: transform drafts commit when focus leaves the complete
  form, and real two-content-layer z-order history is proven.
- Planning note: the detailed `DAY-24-AGENT-TASK.md` is the authoritative
  acceptance contract. Its history work order is more specific than the stale
  Daily Plan Day 24 heading, whose layer controls were delivered on Day 23.

## Decisions

### DECISION-001 — bounded project command snapshots

- `HistoryStore` stores `ProjectCommand` entries with immutable `before` and
  `after` project values; renderer selection, viewport, and other application
  state are excluded.
- History is capped at 50 commands, exceeding the required 20.
- Projects are already schema-parsed immutable replacement values, so commands
  retain references instead of recursively cloning the whole application.
- The history store lives only in renderer memory and is absent from every
  domain schema and save payload.

### DECISION-002 — explicit gesture coalescing

- Coalescing requires the same operation key and the same unique gesture ID.
- A merged project command keeps the first `before` and final `after`.
- Production canvas drag and Transformer handlers persist only at `dragEnd` /
  `transformEnd`. Ten pointer moves therefore call no project action and the
  completed gesture naturally executes exactly one command.
- `HistoryStore` coalescing is an additional defensive path for multiple
  formal commits carrying the same explicit `gestureId`; it is not permission
  to call `updateProject()` from every `pointermove`.
- Independent gestures have different IDs (or separate end commits) and are
  never merged.

### DECISION-003 — one formal replay path

- Normal mutations enter through `EditorProjectStore.updateProject()`.
- `HistoryStore.execute()` applies the command and owns stack transitions.
- Undo/redo applies the real `Project` through the editor store, increments the
  revision, emits subscriptions, and recomputes dirty state against the last
  saved project.
- Locked-layer mutations still pass through `LayerService`; rejected writes do
  not create commands. Undoing a lock command must unlock before an older layer
  change can be replayed in stack order.

### DECISION-004 — session and external replacement boundaries

- Opening, clearing, or restoring a project clears both stacks.
- Asset import/metadata/delete CAS reconciliation also clears history because
  older snapshots must not overwrite externally persisted asset changes.
- Saving does not clear history; undo after save remains useful and correctly
  marks the project dirty.

### DECISION-005 — transform draft commit boundary

- Enter and form submit call the same `commitDraft('submit')` path used by
  focus departure through `commitDraft('blur')`.
- Focus moving between inputs in the same form does not commit.
- A document capture guard commits before an outside mouse action can clear
  the selected layer; native `focusout` covers keyboard focus departure.
- A `(layerId, draftVersion)` identity suppresses submit-followed-by-blur
  duplicates. `LayerService.updateTransform()` remains the final no-op,
  validation, normalization, and locked-layer boundary.
- Invalid blur retains its explicit error even if the outside click clears
  selection.

## Implemented behavior

- Undo/redo buttons expose disabled states, counts, and next-command labels.
- `Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Y` and `Ctrl/Cmd+Shift+Z` redo.
- Editable inputs retain native text editing behavior; editor shortcuts do not
  hijack them.
- Position, transform, flip, lock, order, delete, shot, character, and
  expression store mutations receive readable command labels.
- A new command clears the redo branch.
- Empty-stack undo/redo returns `false` without changing editor state.
- Property inputs remain local drafts. Leaving the complete form or submitting
  commits once; moving between its inputs creates no history.
- Restoring all commands to the saved project makes dirty false; replaying a
  mutation makes it true again.

## Automated checks

| Check | Result | Evidence |
|---|---|---|
| `pnpm typecheck` | PASS | renderer + Electron TypeScript |
| `pnpm lint` | PASS | no ESLint errors |
| `pnpm test:unit` | PASS | 66 files / 387 tests |
| `pnpm test:integration` | PASS | 16 files / 81 tests |
| `pnpm build` | PASS | renderer + Electron production build |
| `pnpm verify:day19` | PASS | character definitions regression |
| `pnpm verify:day20` | PASS | shot management regression |
| `pnpm verify:day21` | PASS | fixed canvas and viewport regression |
| `pnpm verify:day22` | PASS | layer placement regression |
| `pnpm verify:day23` | PASS | transform/order/lock/delete + Issue #47 |
| `pnpm verify:day24` | PASS | real Electron history workflow |
| Formatting | N/A | repository has no Prettier dependency/configuration; ESLint and TypeScript are authoritative |

Key tests:

- `tests/unit/history-store.test.ts`
- `tests/unit/history-shortcuts.test.ts`
- `tests/unit/editor-project-store.test.ts`
- `tests/unit/layer-stores.test.ts`
- `tests/integration/history-lifecycle.test.ts`
- `scripts/verify-day24.cjs`

## Real Electron evidence

`pnpm verify:day24` opens a real Electron editor and performs:

1. One native drag gesture containing ten `mouseMove` events.
2. Assert one history entry and position `(430, 690) → (550, 730)`.
3. Press native `Ctrl+Z`; assert the project returns to the exact origin.
4. Press native `Ctrl+Shift+Z`; assert the same moved result returns.
5. Move focus X → Y inside the property form; assert no commit. Click the
   canvas; assert `(600, 740)` and exactly one blur command.
6. Submit five changed fields and then click the canvas; assert submit + blur
   still produces one command.
7. Verify unchanged blur, invalid scale blur, and locked submit produce no
   history; the invalid/locked status remains explicit.
8. With background + A + B, move A from `zIndex=1` to front (`2`), undo to
   `A=1/B=2`, then redo to `A=2/B=1`.
9. Delete the selected layer, undo with the button, redo with the button.
10. Save without history fields, then open a second project and assert both
    stacks are empty.

Evidence:

- `docs/evidence/day-24/results.json`
- `docs/evidence/day-24/history-controls.png`
- `docs/evidence/day-24/property-blur.png`
- `docs/evidence/day-24/z-order-history.png`

## Blade table

| ID | Result | Proof |
|---|---|---|
| FUNC-001 | PASS | HistoryStore execute/undo/redo unit path |
| FUNC-002 | PASS | ten-move native drag + same-gesture unit test |
| FUNC-003 | PASS | real z-order/transform/delete/expression lifecycle |
| FUNC-004 | PASS | shortcut unit mapping + native Electron keys |
| CONST-001 | PASS | depth 50 and depth-20 truncation boundary |
| CONST-002 | PASS | new-branch unit test |
| CONST-003 | PASS | project-open integration and Electron switch |
| CONST-004 | PASS | JSON integration and real save payload |
| NEG-001 | PASS | empty-stack unit test |
| NEG-002 | PASS | locked LayerService rejection leaves count unchanged |
| NEG-003 | PASS | distinct gesture IDs create distinct entries |
| NEG-004 | PASS | internal focus, no-op, invalid, locked, submit+blur matrix |
| UX-001 | PASS | button disabled-state assertions and screenshot |
| UX-002 | PASS | button and keyboard replay the same project path |
| E2E-001 | PASS | drag → blur → z-order → delete → replay → save |
| HIGH-001 | PASS | ten pointer moves return to origin with one undo |

## P4 self-test

| Check | Result | Evidence |
|---|---|---|
| CF | PASS | all required editor mutation classes replay real projects |
| RG | PASS | Day 19–23 gates and current suites |
| NG | PASS | empty, branch, lock, independent gesture, switch |
| UX | PASS | buttons, labels, counts, shortcuts, disabled state |
| E2E | PASS | real Electron mutation/save/switch workflow |
| High | PASS | ten-move single-undo proof |
| Field completeness | PASS | counts, coordinates, payload and screenshot recorded |
| Requirement mapping | PASS | all 16 blade rows mapped |
| Real interaction | PASS | native mouse and keyboard input events |
| Scope/debt | PASS | no cross-session history/event sourcing/timeline presets |

## Fuse audit

- `STATE-B24-001`: not triggered; undo/redo project state and dirty state are
  deterministic in unit, integration, and Electron flows.
- `PERF-B24-001`: not triggered; only project values are retained and depth is
  capped at 50.
- `COALESCE-B24-001`: not triggered; matching gesture identity is mandatory.
- `DATA-B24-001`: not triggered; schema and save payload exclude history.
- `TEST-B24-001`: not triggered; native drag and shortcut evidence is
  automated.

## Issue #49 closure matrix

| Requirement | Result | Evidence |
|---|---|---|
| Legal blur commit | PASS | native X/Y edit → canvas click, history `1→2` |
| Internal A→B focus | PASS | history remains `1` |
| Submit + blur dedupe | PASS | history `2→3`, not `4` |
| Unchanged blur | PASS | history/revision unchanged |
| Invalid blur | PASS | scale `0` rejected, project/count unchanged, explicit status |
| Locked submit | PASS | project/count unchanged, explicit locked status |
| Real front reorder | PASS | A `1→2`, B `2→1`, one command |
| Z-order undo/redo | PASS | exact three-layer order before/after replay |
| Z-order no-op | PASS | same snapshot, revision, and history count |
| Locked reorder | PASS | `LAYER_LOCKED`, no project/history mutation |
| Redo branch clearing | PASS | undo → new B back → redo count `0` |
| Background contract | PASS | background remains first with `zIndex=0` |

## Debt

- `DEBT-PERF-B24-001`: project equality currently uses deterministic JSON
  serialization at the central write boundary. This is acceptable for the
  current MVP project size; profile and replace with a cheaper revision/hash
  comparison if projects become materially larger.
- `DEBT-TEST-B24-001`: none; real drag, keyboard, property commit, deletion,
  save-payload, and project-switch paths are automated.

## Rollback

- Revert the Day 24 result commit with `git revert <result-sha>`.
