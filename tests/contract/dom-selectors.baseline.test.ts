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

    expect(shell).toContain("page === 'project-center'");
    expect(shell).toContain('<ProjectCenterScreen');
    expect(shell).toContain('<CompactProjectBar');
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
    const topBar = readSource('renderer/shell/CompactProjectBar.tsx');
    const styles = readSource('renderer/styles.css');

    for (const selector of [
      'data-testid="product-preview-overlay"',
      'data-testid="product-preview-close"',
      'data-testid="product-preview-play"',
      'data-testid="product-preview-pause"',
      'data-testid="product-preview-replay"',
      'data-testid="product-preview-scrubber"',
      'data-testid="product-preview-timecode"',
      'data-testid="product-preview-empty"',
    ]) {
      expect(overlay).toContain(selector);
    }
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
    expect(shell.match(/<ProductPreviewOverlay/gu)).toHaveLength(1);
    // The overlay owns the surface; the compact bar only owns the entry.
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
    const topBar = readSource('renderer/shell/CompactProjectBar.tsx');
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
    // The dialog owns the confirmation surface; the compact bar owns the menu entry.
    expect(
      (shell + topBar).match(/data-testid="close-confirm-dialog"/gu),
    ).toBeNull();
    expect(dialog).not.toContain('data-testid="menu-close-project"');
    expect(topBar).toContain('data-testid="menu-close-project"');
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
    const bottomWorkspace = readSource(
      'renderer/shell/BottomWorkspace.tsx',
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
    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(shell).not.toContain('right-inspector-placeholder');
    expect(rightInspector).toContain('data-testid="right-inspector"');
    expect(rightInspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(rightInspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(shell).toContain('<BottomWorkspace');
    expect(bottomWorkspace).toContain(
      'data-testid="bottom-workspace"',
    );
    expect(bottomWorkspace.match(/<HistoryControls/gu)).toHaveLength(1);
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
    expect(readSource('renderer/features/canvas/CanvasStage.tsx')).not.toContain(
      '<LayerTransformPanel',
    );
    expect(readSource('renderer/features/canvas/CanvasStage.tsx')).not.toContain(
      '<LayerOrderControls',
    );
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
      /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\s*>\s*\.history-controls\s*\.history-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\s*>\s*\.history-controls\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"heading actions"[\s\S]*?"status status";/u,
    );
    expect(styles).not.toMatch(
      /\.bottom-workspace\s*\{[^}]*overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /html,[\s\S]*?#root\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
  });

  it('locks the compact project bar selectors and removes the old editor panel', () => {
    const shell = readSource('renderer/shell/EditorShell.tsx');
    const topBar = readSource('renderer/shell/CompactProjectBar.tsx');
    const panel = readSource(
      'renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    expect(shell).toContain('<CompactProjectBar');
    expect(shell).not.toContain('<EditorTopBar');
    expect(topBar).toContain('data-testid="compact-project-bar"');
    expect(topBar).toContain('className="compact-project-bar"');
    expect(topBar).not.toContain('className="recovery-panel"');
    expect(topBar).not.toContain('className="recovery-open-row"');
    expect(topBar).toContain('className="editor-save-button"');
    expect(topBar).toContain('data-testid="project-save-state"');
    expect(topBar).toContain('data-testid="compact-project-more"');
    expect(topBar).toContain('data-testid="menu-open-project-center"');
    expect(topBar).toContain('data-testid="menu-open-project-folder"');
    expect(topBar).toContain('data-testid="menu-close-project"');
    expect(topBar).toContain('已保存');
    expect(topBar).toContain('有未保存更改');
    expect(topBar).toContain('保存中');
    expect(topBar).toContain('保存失败');
    expect(topBar).not.toContain('data-testid="product-preview-open"');
    expect(topBar).toMatch(
      /data-testid="menu-open-product-preview"[\s\S]*?disabled=\{productPreviewOpen\}/u,
    );
    expect(topBar).not.toContain('product-preview-placeholder');
    expect(topBar).toContain('data-testid="menu-close-project"');
    expect(topBar).toMatch(
      /data-testid="menu-close-project"[\s\S]*?disabled=\{closeConfirmOpen\}/u,
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
    const topBar = readSource('renderer/shell/CompactProjectBar.tsx');

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
});
