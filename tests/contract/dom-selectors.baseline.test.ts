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
 *   - Locks the final Stage 2-B Shell/Grid/CanvasWorkspace selectors without
 *     changing the older Day 13–24 business selector assertions.
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
  it('locks the Stage 1A-2 no-project selector owners and the create entry', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const leftWorkspace = readSource(
      'renderer/shell/LeftWorkspace.tsx',
    );
    const startScreen = readSource('renderer/shell/StartScreen.tsx');
    const newProjectEntry = readSource(
      'renderer/shell/NewProjectEntry.tsx',
    );
    const recentProjects = readSource(
      'renderer/features/welcome/RecentProjectsPanel.tsx',
    );

    expect(shell).toContain("sessionRegion === 'start-screen'");
    expect(shell).toContain('<StartScreen');
    expect(shell).toContain('<EditorTopBar');
    expect(shell).toContain('<CanvasWorkspace');
    expect(shell).not.toContain('CurrentNoProjectLegacySurface');
    expect(leftWorkspace).toContain('<ProjectRecoveryPanel');
    expect(startScreen).toContain('className="recovery-panel"');
    expect(startScreen).toContain('id="recovery-heading"');
    expect(startScreen).toContain('className="clean-state"');
    expect(startScreen).toContain('<NewProjectEntry');
    expect(startScreen).toContain('<RecentProjectsPanel');
    expect(newProjectEntry).toContain('className="recovery-open-row"');
    expect(newProjectEntry).toContain(
      'data-testid="new-project-button"',
    );
    expect(newProjectEntry).toContain('disabled={busy || newProjectDialogOpen}');
    expect(newProjectEntry).toContain('onClick={onRequestNewProject}');
    expect(recentProjects).toContain(
      'className="recent-projects-panel"',
    );
    expect(
      (startScreen + newProjectEntry)
        .match(/className="recovery-open-row"/gu),
    ).toHaveLength(1);
  });

  it('locks the Stage 1B new-project dialog selectors into one owner', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const dialog = readSource('renderer/shell/NewProjectDialog.tsx');
    const startScreen = readSource('renderer/shell/StartScreen.tsx');
    const newProjectEntry = readSource(
      'renderer/shell/NewProjectEntry.tsx',
    );
    const styles = readSource('renderer/styles.css');

    expect(dialog).toContain('data-testid="new-project-dialog"');
    expect(dialog).toContain('data-testid="new-project-parent-directory"');
    expect(dialog).toContain('data-testid="new-project-name"');
    expect(dialog).toContain('data-testid="new-project-choose-directory"');
    expect(dialog).toContain('data-testid="new-project-confirm"');
    expect(dialog).toContain('data-testid="new-project-cancel"');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).not.toContain('className="recovery-open-row"');
    expect(shell.match(/<NewProjectDialog/gu)).toHaveLength(1);
    expect(
      (startScreen + newProjectEntry).match(
        /data-testid="new-project-dialog"/gu,
      ),
    ).toBeNull();
    expect(styles).toMatch(/\.new-project-dialog\s*\{[\s\S]*?inset:\s*0;/u);
  });

  it('locks the Stage 1B product preview selectors into one owner', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const overlay = readSource('renderer/shell/ProductPreviewOverlay.tsx');
    const topBar = readSource('renderer/shell/EditorTopBar.tsx');
    const styles = readSource('renderer/styles.css');

    for (const selector of [
      'data-testid="product-preview-overlay"',
      'data-testid="product-preview-close"',
      'data-testid="product-preview-play"',
      'data-testid="product-preview-pause"',
      'data-testid="product-preview-stop"',
      'data-testid="product-preview-scrubber"',
      'data-testid="product-preview-timecode"',
      'data-testid="product-preview-empty"',
    ]) {
      expect(overlay).toContain(selector);
    }
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
    expect(shell.match(/<ProductPreviewOverlay/gu)).toHaveLength(1);
    // The overlay owns the surface; the top bar only owns the entry button.
    expect(
      (shell + topBar).match(/data-testid="product-preview-overlay"/gu),
    ).toBeNull();
    expect(overlay).not.toContain('data-testid="product-preview-open"');
    expect(styles).toMatch(
      /\.product-preview-overlay\s*\{[\s\S]*?inset:\s*0;/u,
    );
  });

  it('locks the Stage 1B close confirmation selectors into one owner', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const dialog = readSource('renderer/shell/CloseConfirmDialog.tsx');
    const topBar = readSource('renderer/shell/EditorTopBar.tsx');
    const styles = readSource('renderer/styles.css');

    for (const selector of [
      'data-testid="close-confirm-dialog"',
      'data-testid="close-confirm-project"',
      'data-testid="close-confirm-prompt"',
      'data-testid="close-confirm-recovery-notice"',
      'data-testid="close-confirm-status"',
      'data-testid="close-confirm-save"',
      'data-testid="close-confirm-discard"',
      'data-testid="close-confirm-cancel"',
    ]) {
      expect(dialog.match(new RegExp(selector, 'gu'))).toHaveLength(1);
    }
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(shell.match(/<CloseConfirmDialog/gu)).toHaveLength(1);
    // The dialog owns the confirmation surface; the top bar owns the entry.
    expect(
      (shell + topBar).match(/data-testid="close-confirm-dialog"/gu),
    ).toBeNull();
    expect(dialog).not.toContain('data-testid="close-project-open"');
    expect(
      topBar.match(/data-testid="close-project-open"/gu),
    ).toHaveLength(1);
    expect(styles).toMatch(
      /\.close-confirm-overlay\s*\{[\s\S]*?inset:\s*0;/u,
    );
    // Exactly three branch buttons, no more and no fewer.
    const actions = dialog.slice(
      dialog.indexOf('className="close-confirm-actions"'),
      dialog.indexOf('className="close-confirm-hint"'),
    );
    expect(actions.match(/<button/gu)).toHaveLength(3);
    expect(actions.match(/onChoose\('/gu)).toHaveLength(3);
    expect(actions).toContain("onChoose('save-and-close')");
    expect(actions).toContain("onChoose('close-without-saving')");
    expect(actions).toContain("onChoose('cancel')");
    // Escape is an alias of the cancel branch, never a fourth outcome.
    expect(dialog.match(/onChoose\('/gu)).toHaveLength(4);
    expect(dialog.match(/onChoose\('cancel'\)/gu)).toHaveLength(2);
  });

  it('locks the final Stage 1A Grid and nested-scroll selector owners', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const leftWorkspace = readSource(
      'renderer/shell/LeftWorkspace.tsx',
    );
    const canvasWorkspace = readSource(
      'renderer/shell/CanvasWorkspace.tsx',
    );
    const rightInspector = readSource(
      'renderer/shell/RightInspector.tsx',
    );
    const legacyCompatibility = readSource(
      'renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const legacyWorkspace = readSource(
      'renderer/shell/LegacyWorkspace.tsx',
    );
    const app = readSource('renderer/App.tsx');
    const styles = readSource('renderer/styles.css');

    expect(app.match(/<EditorShell/gu)).toHaveLength(1);
    expect(app).not.toContain('beforeRecovery=');
    expect(app).not.toContain('afterRecovery=');
    expect(shell).toContain('data-testid="editor-layout"');
    expect(shell).toContain('data-testid="editor-body"');
    expect(shell).toContain('<LeftWorkspace');
    expect(leftWorkspace).toContain(
      'data-testid="left-workspace-scroll"',
    );
    expect(shell).toContain('<RightInspector');
    expect(rightInspector).toContain('data-testid="right-inspector"');
    expect(shell).toContain(
      'data-testid="bottom-workspace-placeholder"',
    );
    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
    expect(shell.match(/<LegacyWorkspace/gu)).toBeNull();
    expect(legacyCompatibility).toContain(
      'data-testid="legacy-compatibility-toggle"',
    );
    expect(legacyCompatibility.match(/<LegacyWorkspace/gu)).toHaveLength(1);
    expect(canvasWorkspace).toContain(
      'data-testid="canvas-workspace-scroll"',
    );
    expect(canvasWorkspace.match(/<CanvasStage/gu)).toHaveLength(1);
    expect(legacyWorkspace).toContain('className="legacy-workspace"');
    expect(legacyWorkspace).toContain(
      'data-testid="legacy-workspace-scroll"',
    );
    expect(legacyWorkspace.match(/<CanvasStage/gu)).toBeNull();
    expect(legacyWorkspace).toContain('<ActionPresetPanel');
    expect(styles).toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.canvas-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /html,[\s\S]*?#root\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
  });

  it('locks editor recovery selectors into EditorTopBar only', () => {
    const topBar = readSource('renderer/shell/EditorTopBar.tsx');
    const panel = readSource(
      'renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    expect(topBar).toContain('data-testid="editor-top-bar"');
    expect(topBar).toContain('className="recovery-panel"');
    expect(topBar).toContain('className="recovery-heading-row"');
    expect(topBar).toContain('id="recovery-heading"');
    expect(topBar).toContain('className="recovery-open-row"');
    expect(topBar).toContain('className="recovery-status-row"');
    expect(topBar).toContain('className="editor-save-button"');
    expect(topBar).toContain("'clean-state'");
    expect(topBar).toContain("'dirty-state'");
    expect(topBar).toContain('data-testid="product-preview-open"');
    expect(topBar).toMatch(
      /data-testid="product-preview-open"[\s\S]*?disabled=\{busy \|\| productPreviewOpen\}/u,
    );
    expect(topBar).not.toContain('product-preview-placeholder');
    expect(topBar).toContain('data-testid="close-project-open"');
    expect(topBar).toMatch(
      /data-testid="close-project-open"[\s\S]*?disabled=\{busy \|\| closeConfirmOpen\}/u,
    );
    expect(panel).not.toContain('id="recovery-heading"');
    expect(panel).not.toContain('className="recovery-open-row"');
    expect(panel).not.toContain('className="recovery-status-row"');
    expect(panel).not.toContain('className="editor-save-button"');
    expect(panel).not.toContain('RecoveryCandidateBanner');
    expect(panel).not.toContain('className="recovery-prompt"');
    expect(panel).not.toContain('clean-state');
    expect(panel).not.toContain('dirty-state');
  });

  it('locks the Stage 1A-3 prompt to RecoveryCandidateBanner only', () => {
    const banner = readSource(
      'renderer/shell/RecoveryCandidateBanner.tsx',
    );
    const panel = readSource(
      'renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    const topBar = readSource('renderer/shell/EditorTopBar.tsx');

    expect(banner).toContain('className="recovery-prompt"');
    expect(banner).toContain(
      'data-testid="recovery-candidate-banner"',
    );
    expect(banner).toContain('role="alert"');
    expect(banner.match(/disabled=\{busy\}/gu)).toHaveLength(2);
    expect(
      (banner + panel + topBar).match(/className="recovery-prompt"/gu),
    ).toHaveLength(1);
    expect(banner).not.toContain('className="recovery-open-row"');
    expect(banner).not.toContain('className="editor-save-button"');
    expect(banner).not.toContain('className="recovery-status-row"');
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

  it('locks Stage 2-C visible selector owners and cardinality contracts', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const left = readSource('renderer/shell/LeftWorkspace.tsx');
    const dock = readSource('renderer/shell/ResourceActivityDock.tsx');
    const compatibility = readSource(
      'renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const canvasWorkspace = readSource(
      'renderer/shell/CanvasWorkspace.tsx',
    );
    const legacy = readSource('renderer/shell/LegacyWorkspace.tsx');
    const recent = readSource(
      'renderer/features/welcome/RecentProjectsPanel.tsx',
    );
    const shot = readSource('renderer/features/shots/ShotManager.tsx');
    const asset = readSource('renderer/features/assets/AssetLibrary.tsx');
    const character = readSource(
      'renderer/features/characters/CharacterManager.tsx',
    );
    const styles = readSource('renderer/styles.css');

    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
    expect(shell.match(/<LegacyWorkspace/gu) ?? []).toHaveLength(0);
    expect(left.match(/<ProjectRecoveryPanel/gu)).toHaveLength(1);
    expect(left.match(/<ResourceActivityDock/gu)).toHaveLength(1);
    expect(left.match(/<LegacyCompatibilityActivity/gu)).toHaveLength(1);
    expect(canvasWorkspace.match(/<CanvasStage/gu)).toHaveLength(1);
    expect(legacy.match(/<ActionPresetPanel/gu)).toHaveLength(1);
    expect(legacy.match(/<CanvasStage/gu) ?? []).toHaveLength(0);
    expect(compatibility).toContain('{active ? <LegacyWorkspace');

    for (const selector of [
      'data-testid="recent-projects-panel"',
      'data-testid="recent-projects-list"',
      'data-testid="recent-projects-path"',
      'data-testid="recent-projects-actions"',
      'data-testid="recent-projects-status"',
    ]) {
      expect(recent).toContain(selector);
    }
    expect(shot).toContain('data-testid="shot-manager"');
    expect(asset).toContain('data-testid="asset-library"');
    expect(character).toContain('data-testid="character-manager"');

    expect(dock.match(/<ShotManager/gu)).toHaveLength(1);
    expect(dock.match(/<AssetLibrary/gu)).toHaveLength(1);
    expect(dock.match(/<CharacterManager/gu)).toHaveLength(1);
    expect(dock).toContain("useState<ResourceActivity>('shots')");
    expect(styles).toMatch(
      /html,[\s\S]*?#root\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.left-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.canvas-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
  });

  it('locks the Stage 3-A RightInspector owner and selection contract', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const inspector = readSource('renderer/shell/RightInspector.tsx');
    const canvas = readSource('renderer/features/canvas/CanvasStage.tsx');
    const transform = readSource(
      'renderer/features/properties/LayerTransformPanel.tsx',
    );
    const order = readSource(
      'renderer/features/properties/LayerOrderControls.tsx',
    );
    const legacy = readSource('renderer/shell/LegacyWorkspace.tsx');
    const styles = readSource('renderer/styles.css');

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(shell).not.toContain('right-inspector-placeholder');
    expect(inspector).toContain('data-testid="right-inspector"');
    expect(inspector).toContain(
      'data-testid="right-inspector-selection"',
    );
    expect(inspector).toContain(
      'data-testid="right-inspector-selection-message"',
    );
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector).toContain('editorProjectStore.subscribe');
    expect(inspector).toContain('shotStore.subscribe');
    expect(inspector).toContain('selectionStore.subscribe');
    expect(canvas).not.toContain('<LayerTransformPanel');
    expect(canvas).not.toContain('<LayerOrderControls');
    expect(canvas.match(/<HistoryControls/gu)).toHaveLength(1);
    expect(transform).toContain(
      'data-testid="layer-transform-guidance"',
    );
    expect(order).toContain('data-testid="layer-order-guidance"');
    expect(legacy).toContain('<ActionPresetPanel');
    expect(styles).toMatch(
      /\.right-inspector\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?grid-template-columns:/u,
    );
  });
});
