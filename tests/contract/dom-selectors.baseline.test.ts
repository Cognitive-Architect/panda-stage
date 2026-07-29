/**
 * Phase 0A baseline plus authorized Stage 1A selector contracts.
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
 * Guardrail rules honoured:
 *   - The original Phase 0A selector assertions remain unchanged.
 *   - Stage 1A assertions are added only as their owning slice is implemented.
 *   - Does NOT require later-slice selectors such as EditorTopBar,
 *     RecoveryCandidateBanner, or LegacyWorkspace.
 *   - Runtime DOM counts remain the responsibility of Electron validation.
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
  it('locks the Stage 1A-2 no-project selector owners and disabled create placeholder', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const startScreen = readSource('renderer/shell/StartScreen.tsx');
    const newProjectEntry = readSource(
      'renderer/shell/NewProjectEntry.tsx',
    );
    const recentProjects = readSource(
      'renderer/features/welcome/RecentProjectsPanel.tsx',
    );

    expect(shell).toContain("sessionRegion === 'start-screen'");
    expect(shell).toContain('<StartScreen');
    expect(shell).toContain('<ProjectRecoveryPanel');
    expect(startScreen).toContain('className="recovery-panel"');
    expect(startScreen).toContain('id="recovery-heading"');
    expect(startScreen).toContain('className="clean-state"');
    expect(startScreen).toContain('<NewProjectEntry');
    expect(startScreen).toContain('<RecentProjectsPanel');
    expect(newProjectEntry).toContain('className="recovery-open-row"');
    expect(newProjectEntry).toContain(
      'data-testid="new-project-button"',
    );
    expect(newProjectEntry).toContain('disabled');
    expect(recentProjects).toContain(
      'className="recent-projects-panel"',
    );
    expect(
      (startScreen + newProjectEntry)
        .match(/className="recovery-open-row"/gu),
    ).toHaveLength(1);
  });

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
