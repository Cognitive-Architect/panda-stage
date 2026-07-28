/**
 * Phase 0A baseline — DOM selector contract (existing selectors only).
 *
 * Purpose: lock the currently-shipped, Gate-whitelisted DOM selectors into the
 * components that render them, so a future refactor that removes/renames one of
 * these selectors fails CI before the day13–24 Gates and Gate A go red.
 *
 * Why source-level (not runtime DOM):
 *   - The vitest unit/integration configs run in the `node` environment (no jsdom).
 *   - The whitelisted components (ProjectRecoveryPanel, HistoryControls, CanvasStage,
 *     ActionPresetPanel) read from external stores via `useSyncExternalStore`, which
 *     throws under `renderToStaticMarkup` (no `getServerSnapshot`). A runtime DOM
 *     assertion would therefore require jsdom/electron, which are not part of the
 *     Phase 0A guardrail scope and must NOT be installed/changed here.
 *   - A source-level contract is a faithful Phase 0A baseline: it proves the selector
 *     strings are wired into the default-UI components today.
 *
 * Phase 0A iron rules honoured:
 *   - Asserts ONLY selectors that already exist in the current source.
 *   - Does NOT assert not-yet-implemented selectors ([data-workspace-tab],
 *     .new-project-entry, .product-preview-overlay, .editor-save-button, ...).
 *   - Does NOT assert DOM count === 1 (the dual-mount fix lands in later phases).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../src');

function readSource(relativePath: string): string {
  return readFileSync(resolve(srcRoot, relativePath), 'utf8');
}

describe('Phase 0A DOM selector contract (existing whitelisted selectors)', () => {
  it('locks recovery whitelist selectors into ProjectRecoveryPanel', () => {
    const code = readSource('renderer/features/recovery/ProjectRecoveryPanel.tsx');
    expect(code).toContain('className="recovery-panel"');
    expect(code).toContain('className="recovery-heading-row"');
    expect(code).toContain('id="recovery-heading"');
    expect(code).toContain('className="recovery-open-row"');
    expect(code).toContain('className="recovery-prompt"');
    expect(code).toContain('className="recovery-status-row"');
    // clean/dirty state classes are both present in the ternary.
    expect(code).toContain("'clean-state'");
    expect(code).toContain("'dirty-state'");
  });

  it('locks history-controls selectors into HistoryControls', () => {
    const code = readSource('renderer/features/editor/HistoryControls.tsx');
    expect(code).toContain('className="history-controls"');
    expect(code).toContain('data-testid="history-controls"');
  });

  it('locks editor-shell section selectors into App', () => {
    const code = readSource('renderer/App.tsx');
    expect(code).toContain('className="day25-action-shell"');
    expect(code).toContain('className="day25-editor-shell"');
  });

  it('locks canvas-stage selectors into CanvasStage', () => {
    const code = readSource('renderer/features/canvas/CanvasStage.tsx');
    expect(code).toContain('data-testid="project-canvas-stage"');
  });

  it('locks canvas viewport selectors into CanvasViewport', () => {
    const code = readSource('renderer/features/canvas/CanvasViewport.tsx');
    expect(code).toContain('data-testid="project-canvas-viewport"');
    expect(code).toContain('data-testid="canvas-logical-stage"');
  });

  it('locks action-preset-panel selector into ActionPresetPanel', () => {
    const code = readSource('renderer/features/actions/ActionPresetPanel.tsx');
    expect(code).toContain('data-testid="action-preset-panel"');
  });
});
