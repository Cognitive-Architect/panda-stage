import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  getEditorShellRecoveryCandidate,
  getEditorShellState,
  getEditorShellSessionRegion,
} from '../../src/renderer/shell/EditorShell';
import { parseEditorShellFlags } from '../../src/renderer/shell/useDebugFlag';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('EditorShell state boundary', () => {
  it('selects no-project when the editor store has no snapshot', () => {
    const state = getEditorShellState(null);

    expect(state).toBe('no-project');
    expect(getEditorShellSessionRegion(state)).toBe('start-screen');
  });

  it('selects editor when the editor store has a snapshot', () => {
    const store = new EditorProjectStore();
    store.open(
      'D:\\projects\\shell.pandastage',
      ProjectSchema.parse(exampleProject),
    );

    const state = getEditorShellState(store.getSnapshot());

    expect(state).toBe('editor');
    expect(getEditorShellSessionRegion(state)).toBe(
      'editor-layout',
    );
  });

  it('keeps debug and gateA orthogonal to the no-project/editor state', () => {
    expect(parseEditorShellFlags('')).toEqual({
      debug: false,
      gateA: false,
    });
    expect(parseEditorShellFlags('?debug=1')).toEqual({
      debug: true,
      gateA: false,
    });
    expect(parseEditorShellFlags('?gateA=1')).toEqual({
      debug: false,
      gateA: true,
    });
    expect(parseEditorShellFlags('?debug=1&gateA=1')).toEqual({
      debug: true,
      gateA: true,
    });
    expect(getEditorShellSessionRegion('no-project')).toBe(
      'start-screen',
    );
    expect(getEditorShellSessionRegion('editor')).toBe('editor-layout');
  });

  it('owns the secure create flow in the shell and keeps the entry presentational', () => {
    const sources = [
      'src/renderer/shell/EditorShell.tsx',
      'src/renderer/shell/StartScreen.tsx',
      'src/renderer/shell/NewProjectEntry.tsx',
      'src/renderer/shell/NewProjectDialog.tsx',
    ].map((path) => readFileSync(path, 'utf8'));
    const [shellSource, ...presentationalSources] = sources;
    const source = sources.join('\n');
    const startScreenSource = presentationalSources.join('\n');

    // The legacy "coming soon" placeholder is gone; creation is real now.
    expect(source).not.toContain('新建项目（后续阶段启用）');
    expect(source).not.toMatch(
      /data-testid="new-project-button"[^>]*\sdisabled\s*(?:>|\/>)/u,
    );
    // The shell is the only owner of the creation IPC call.
    expect(shellSource).toContain('window.pandaStage.project.createAt');
    expect(shellSource).not.toMatch(/\.project\.create\s*\(/u);
    // The Renderer submits parts only and never assembles the project root.
    expect(source).not.toMatch(/\+\s*['"`]\.pandastage/u);
    expect(source).not.toMatch(/\$\{[^}]*\}\.pandastage/u);
    expect(source).not.toMatch(/\bjoin\s*\(/u);
    // Presentational surfaces stay free of session, store, and IPC ownership.
    expect(startScreenSource).not.toContain('recoveryCandidate');
    expect(startScreenSource).not.toContain('editorProjectStore');
    expect(startScreenSource).not.toContain('ProjectSessionController');
    expect(startScreenSource).not.toContain('window.pandaStage');
  });

  it('opens a created project through the one session, never the store directly', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );

    expect(shell).toContain('session.switchProject(projectRoot)');
    expect(shell).not.toContain('editorProjectStore.open(');
    expect(shell.match(/<NewProjectDialog/gu)).toHaveLength(1);
    expect(shell.match(/session\.switchProject\(/gu)).toHaveLength(1);
  });

  it('selects one recovery banner only for editor state with a candidate', () => {
    const recoveryCandidate = {
      projectRoot: 'D:\\projects\\shell.pandastage',
      recoveryFilePath:
        'D:\\projects\\shell.pandastage\\recovery\\candidate.json',
      projectId: exampleProject.id,
      savedAtMs: 4_102_444_800_000,
      project: ProjectSchema.parse(exampleProject),
    };
    const withCandidate = {
      trackedProjectRoot: recoveryCandidate.projectRoot,
      recoveryCandidate,
    };

    expect(
      getEditorShellRecoveryCandidate('no-project', withCandidate),
    ).toBeNull();
    expect(
      getEditorShellRecoveryCandidate('editor', {
        ...withCandidate,
        recoveryCandidate: null,
      }),
    ).toBeNull();
    expect(
      getEditorShellRecoveryCandidate('editor', withCandidate),
    ).toBe(recoveryCandidate);
    expect(
      getEditorShellRecoveryCandidate('editor', {
        ...withCandidate,
        recoveryCandidate: null,
      }),
    ).toBeNull();
  });

  it('keeps candidate state and project/session ownership out of the banner', () => {
    const banner = readFileSync(
      'src/renderer/shell/RecoveryCandidateBanner.tsx',
      'utf8',
    );

    expect(banner).not.toContain('useState');
    expect(banner).not.toContain('editorProjectStore');
    expect(banner).not.toContain('ProjectSessionController');
    expect(banner).not.toContain('window.pandaStage');
    expect(banner).not.toContain('recovery-open-row');
    expect(banner).not.toContain('editor-save-button');
    expect(banner).not.toContain('recovery-status-row');
  });

  it('selects EditorTopBar for every editor candidate state and never for no-project', () => {
    expect(getEditorShellSessionRegion('no-project')).toBe(
      'start-screen',
    );
    expect(getEditorShellSessionRegion('editor')).toBe(
      'editor-layout',
    );

    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    expect(shell.indexOf('<StartScreen')).toBeGreaterThan(-1);
    expect(shell.indexOf('<EditorTopBar')).toBeGreaterThan(-1);
    expect(shell.indexOf('<CanvasWorkspace')).toBeGreaterThan(-1);
    expect(shell).toContain(
      "sessionRegion === 'start-screen'",
    );
    expect(shell).toMatch(
      /<EditorTopBar[\s\S]*?recoveryBanner=\{[\s\S]*?recoveryCandidate/u,
    );
  });

  it('selects only StartScreen for no-project and one fixed layout for editor', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );

    expect(shell).not.toContain('CurrentNoProjectLegacySurface');
    expect(shell).toContain('data-testid="start-screen"');
    expect(shell).toContain('data-testid="editor-layout"');
    expect(shell).toContain('data-testid="editor-body"');
    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
  });

  it('keeps project state, controller, preview, and create behavior out of EditorTopBar', () => {
    const topBar = readFileSync(
      'src/renderer/shell/EditorTopBar.tsx',
      'utf8',
    );

    expect(topBar).not.toContain('useState');
    expect(topBar).not.toContain('editorProjectStore');
    expect(topBar).not.toContain('ProjectSessionController');
    expect(topBar).not.toContain('window.pandaStage');
    expect(topBar).not.toContain('StagePreview');
    expect(topBar).not.toMatch(/\.project\.create\s*\(/u);
    expect(topBar).not.toContain('createAt');
    // The top bar owns the entry only; the overlay itself lives in the shell.
    expect(topBar).not.toContain('ProductPreviewOverlay');
    expect(topBar).not.toContain('evaluateShotAtTime');
    expect(topBar).toContain('产品预览');
    expect(topBar).not.toContain('产品预览（后续阶段启用）');
    expect(topBar).toMatch(
      /data-testid="product-preview-open"[\s\S]*?onClick=\{onOpenProductPreview\}/u,
    );
  });

  it('keeps the product preview read-only and owned by the one shell session', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    const overlay = readFileSync(
      'src/renderer/shell/ProductPreviewOverlay.tsx',
      'utf8',
    );

    // The shell passes the already-open project down; no second tree is built.
    expect(shell).toContain('project={projectSnapshot.project}');
    expect(shell).toContain('projectRoot={projectSnapshot.projectRoot}');
    expect(shell).toContain('shotId={currentShotId}');
    expect(shell).toContain('shotStore.getCurrentShotId');
    // Opening the preview must not mutate project/session state.
    expect(shell).toMatch(
      /const openProductPreview = \(\): void => \{\s*setProductPreviewOpen\(true\);\s*\};/u,
    );
    expect(shell).toMatch(
      /const closeProductPreview = \(\): void => \{\s*setProductPreviewOpen\(false\);\s*\};/u,
    );
    // The overlay never re-enters the session or store layer.
    expect(overlay).not.toContain('EditorShellSession');
    expect(overlay).not.toContain('ProjectSessionController');
    expect(overlay).not.toContain('switchProject');
    expect(overlay).not.toContain('saveCurrentProject');
  });

  it('keeps the in-app close inside the shell and off the top bar', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    const topBar = readFileSync(
      'src/renderer/shell/EditorTopBar.tsx',
      'utf8',
    );
    const dialog = readFileSync(
      'src/renderer/shell/CloseConfirmDialog.tsx',
      'utf8',
    );

    // The top bar stays presentational: it reports intent, nothing else.
    expect(topBar).toContain('onRequestCloseProject(): void;');
    expect(topBar).toContain('onClick={onRequestCloseProject}');
    expect(topBar).not.toContain('closeProject(');
    expect(topBar).not.toContain('useState');
    expect(topBar).not.toContain('editorProjectStore');
    // The dialog is a pure choice reporter with no lifecycle authority.
    expect(dialog).not.toContain('useState');
    expect(dialog).not.toContain('editorProjectStore');
    expect(dialog).not.toContain('useSyncExternalStore');
    // Only the shell owns the confirmation state and the close consequences.
    expect(shell).toContain(
      'const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);',
    );
    expect(shell).toContain('closeConfirmOpen={closeConfirmOpen}');
    expect(shell).toContain('dirty={projectSnapshot.dirty}');
    expect(shell).toContain('projectName={projectSnapshot.project.name}');
    expect(shell).toContain('await session.closeProject()');
    // Closing the project also tears down the preview it was showing.
    const finishBody = shell.slice(
      shell.indexOf('const finishCloseProject'),
      shell.indexOf('const closeProject = async'),
    );
    expect(finishBody).toContain('setProductPreviewOpen(false)');
    expect(finishBody).toContain('setCloseConfirmOpen(false)');
    expect(finishBody).toContain("setOpenCandidatePath('')");
  });

  it('never closes the project before a successful save completes', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    const closeBody = shell.slice(
      shell.indexOf('const closeProject = async'),
      shell.indexOf('const restoreRecovery = async'),
    );

    // Both failure branches return before the close runs.
    expect(closeBody).toMatch(
      /if \(!result\.ok\) \{[\s\S]*?closeProjectSaveFailureMessage[\s\S]*?return;/u,
    );
    expect(closeBody).toMatch(
      /if \(result\.acknowledgement === 'stale'\) \{[\s\S]*?return;/u,
    );
    expect(closeBody.indexOf('session.saveCurrentProject()')).toBeLessThan(
      closeBody.indexOf('finishCloseProject(choice, dirtyBeforeClose)'),
    );
    // Cancel short-circuits before any async work.
    expect(closeBody.indexOf("if (choice === 'cancel')")).toBeLessThan(
      closeBody.indexOf('setBusy(true)'),
    );
  });
});
