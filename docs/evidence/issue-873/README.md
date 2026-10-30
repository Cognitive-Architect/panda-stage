# Issue #873 visual receipt

These screenshots compare the exact `main` base with the implementation at commit `466d89fd1accb82d99eb550b240f72566c7b9371` using the same Windows Electron fixture and viewport sizes.

| Capture | Before: `18d7181147e172ed75de55cc7f8e47563bc2c7ea` | After: `466d89fd1accb82d99eb550b240f72566c7b9371` |
| --- | --- | --- |
| Wide Settings, 1646 × 1038 CSS px | [before-wide.png](before-wide.png) | [after-wide.png](after-wide.png) |
| Narrow Settings, 786 × 498 CSS px | [before-narrow.png](before-narrow.png) | [after-narrow.png](after-narrow.png) |
| Narrow Settings scrolled to delete control | [before-narrow-bottom.png](before-narrow-bottom.png) | [after-narrow-bottom.png](after-narrow-bottom.png) |
| Preview running | — | [after-preview-playing.png](after-preview-playing.png) |

The Electron window sizes were 1660 × 1100 and 800 × 560 at 100% app zoom. Both captures report `editor-device-mode="cloud-touch"`; the wide and narrow sizes are two viewports of that current shell mode. `EditorShell` currently hard-codes this device mode, so the wide capture is wide-viewport evidence under Cloud Touch styling, not a separate desktop device-mode capture. The narrow bottom capture confirms the delete control remains fully visible and hit-testable after scrolling. Its measured target grew from 40 px high on the base to 44 px high after the change.

The after capture started and stopped the existing talking-head preview. `aria-pressed` and the preview's `data-playing` changed to `true` on start and `false` on stop. Project revision, undo count, redo count, and layers remained unchanged (`0`, `0`, `0`, and empty).

`before-capture.json` and `after-capture.json` are the machine receipts. `passed: true` means the capture-only geometry and interaction checks passed; `humanAcceptance: false` is intentional. These synthetic-fixture screenshots are evidence for Owner review and do not record Owner visual acceptance.

## Focused validation

- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test:unit` — passed, 374 files and 2,903 tests.
- `pnpm build` — passed after the toolbar alignment correction; only the existing empty legacy CSS slice and large chunk warnings appeared.
- `pnpm exec vitest run tests/unit/editor-issue525-character-detail-header.test.ts` — passed, 6 tests.
- `pnpm exec vitest run tests/unit/issue815-talking-head-settings.test.ts` — passed, 10 tests.
- Focused character action/service suites — passed, 33 tests across the related header, delete-action, and character-service coverage.

The existing full `verify:issue798-add-to-shot-navigation` path is not claimed as passing. Its checked-in fixture first failed current schema validation for missing `usage` and `keywords`; a temporary fixture-compatible run then failed later because the Assembly body-picker asset did not appear. The temporary Issue #873 capture-only runner passed without editing or committing that historical verifier.
