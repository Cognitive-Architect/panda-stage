import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  getEditorShellState,
} from '../../src/renderer/shell/EditorShell';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('EditorShell state boundary', () => {
  it('selects no-project when the editor store has no snapshot', () => {
    expect(getEditorShellState(null)).toBe('no-project');
  });

  it('selects editor when the editor store has a snapshot', () => {
    const store = new EditorProjectStore();
    store.open(
      'D:\\projects\\shell.pandastage',
      ProjectSchema.parse(exampleProject),
    );

    expect(getEditorShellState(store.getSnapshot())).toBe('editor');
  });

  it('does not introduce project creation into the Stage 1A-1 shell', () => {
    const source = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );

    expect(source).not.toMatch(/\.project\.create\s*\(/u);
    expect(source).not.toContain('NewProjectEntry');
  });
});
