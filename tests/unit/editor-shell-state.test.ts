import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
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
      'legacy-recovery',
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
});
