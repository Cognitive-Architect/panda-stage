import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotEditor, formatShotDuration } from '../../src/renderer/features/shots/ShotEditor';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const shot = project.shots[0]!;

function renderEditor(): string {
  return renderToStaticMarkup(
    createElement(ShotEditor, {
      index: 0,
      onDuplicate: () => undefined,
      onRemove: () => undefined,
      onRename: () => undefined,
      onSetDuration: () => undefined,
      shot,
    }),
  );
}

describe('Issue #341 Cloud Touch portrait Shot inspector', () => {
  it('presents one concise identity with seconds and compact duration controls', () => {
    const markup = renderEditor();
    const editor = source('src/renderer/features/shots/ShotEditor.tsx');

    expect(formatShotDuration(3_000)).toBe('3.000 秒');
    expect(markup).toContain('data-testid="shot-editor"');
    expect(markup).toContain('镜头 1');
    expect(markup).toContain('3.000');
    expect(markup).toContain('镜头时长（秒）');
    expect(markup).toContain('data-testid="shot-duration-decrease"');
    expect(markup).toContain('data-testid="shot-duration-increase"');
    expect(markup).toContain('>应用</button>');
    expect(markup).not.toContain('时长（毫秒）');
    expect(source('src/renderer/features/shots/ShotListItem.tsx')).toContain(
      'formatShotDuration(shot.durationMs)',
    );
    expect(markup).not.toContain('>应用名称修改</button>');
    expect(markup).not.toContain('>应用时长修改</button>');
    expect(editor).toContain('onClick={() => onRename(name)}');
    expect(editor).toContain('onClick={() => onSetDuration(durationMs)}');
  });

  it('keeps a truthful placeholder, flattened metadata, and contextual help', () => {
    const markup = renderEditor();
    const editor = source('src/renderer/features/shots/ShotEditor.tsx');

    expect(markup).toContain('shot-thumbnail-placeholder');
    expect(markup).toContain('shot-entity-summary');
    expect(markup).toContain('镜头内容统计');
    expect(markup).toContain('shot-duration-help');
    expect(markup).not.toContain('<img');
    expect(editor).toContain('<details');
    expect(editor).toContain('shot-duration-help');
    expect(editor).toContain('SHOT_MIN_DURATION_MS');
  });

  it('routes the presentation seam without changing Shot mutation ownership', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');
    const scope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']\n  .resource-activity-dock[data-active-activity='shots']\n  .shot-manager[data-shot-editor-presentation='portrait']";

    expect(manager).toContain(
      "export type ShotEditorPresentation = 'default' | 'portrait';",
    );
    expect(manager).toContain('shotEditorPresentation?: ShotEditorPresentation');
    expect(manager).toContain('data-shot-editor-presentation={shotEditorPresentation}');
    expect(manager).toContain('shotStore.duplicate(selectedShot.id)');
    expect(manager).toContain('shotStore.remove(selectedShot.id)');
    expect(manager).toContain('shotStore.rename(selectedShot.id, name)');
    expect(manager).toContain('shotStore.setDuration(selectedShot.id, durationMs)');
    expect(dock).toContain(
      "const shotEditorPresentation: ShotEditorPresentation =",
    );
    expect(dock).toContain('shotEditorPresentation={shotEditorPresentation}');
    expect(styles).toContain(`${scope}\n  .shot-editor`);
    expect(styles).toContain('aspect-ratio: 16 / 9;');
    expect(styles).toContain(
      'grid-template-columns: minmax(180px, 0.78fr) minmax(0, 1.22fr);',
    );
    expect(styles).toContain('@media (max-width: 720px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
  });
});
