import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  getEditorShellRecoveryCandidate,
  getEditorShellState,
  getEditorShellSessionRegion,
} from '../../src/renderer/shell/EditorShell';
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
      'editor-top-bar',
    );
  });

  it('keeps the no-project entry as a disabled placeholder without create APIs', () => {
    const sources = [
      'src/renderer/shell/EditorShell.tsx',
      'src/renderer/shell/StartScreen.tsx',
      'src/renderer/shell/NewProjectEntry.tsx',
    ].map((path) => readFileSync(path, 'utf8'));
    const source = sources.join('\n');
    const startScreenSource = sources.slice(1).join('\n');

    expect(source).not.toMatch(/\.project\.create\s*\(/u);
    expect(source).not.toContain('createAt');
    expect(source).toContain('新建项目（后续阶段启用）');
    expect(source).toMatch(
      /data-testid="new-project-button"[\s\S]*?disabled/u,
    );
    expect(startScreenSource).not.toContain('recoveryCandidate');
    expect(startScreenSource).not.toContain('editorProjectStore');
    expect(startScreenSource).not.toContain('ProjectSessionController');
    expect(startScreenSource).not.toContain('window.pandaStage.project');
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
      'editor-top-bar',
    );

    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    expect(shell.indexOf('<StartScreen')).toBeGreaterThan(-1);
    expect(shell.indexOf('<EditorTopBar')).toBeGreaterThan(-1);
    expect(shell).toContain(
      "sessionRegion === 'start-screen'",
    );
    expect(shell).toMatch(
      /<EditorTopBar[\s\S]*?recoveryBanner=\{[\s\S]*?recoveryCandidate/u,
    );
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
    expect(topBar).toContain('产品预览（后续阶段启用）');
    expect(topBar).toMatch(
      /data-testid="product-preview-placeholder"[\s\S]*?disabled/u,
    );
  });
});
