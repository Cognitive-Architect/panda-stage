import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterIdentityPicker } from '../../src/renderer/features/characters/CharacterIdentity';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #502 final A07 New Dialogue correction', () => {
  const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
  const styles = source('src/renderer/styles.css');
  const issue502Styles = styles.slice(styles.lastIndexOf('/* Issue #502:'));

  it('uses 当前绑定 only for the selected Character in the right workspace', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const selectedMarkup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        onSelect: () => undefined,
        selectedCharacterId: character.id,
        selectedLabel: '当前绑定',
        thumbnails: {},
      }),
    );

    expect(selectedMarkup).toContain('当前绑定');
    expect(selectedMarkup).toContain('✓');
    expect(sheet).toMatch(
      /selectedLabel=\{\s*rightWorkspace \? '当前绑定' : '当前说话人'\s*\}/u,
    );
  });

  it('keeps the Windows shortcut copy while preserving Ctrl/Cmd submit handling', () => {
    expect(sheet.match(/普通 Enter 换行，Ctrl \+ Enter 提交/gu)).toHaveLength(2);
    expect(sheet).not.toContain('Ctrl/Cmd + Enter 提交');
    expect(sheet).toContain('(event.ctrlKey || event.metaKey)');
    expect(sheet).toContain('event.preventDefault();');
    expect(sheet).toContain('handleAdd();');
  });

  it('insets the whole header, removes the dark footer strip, and uses filled triangles', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const collapsedMarkup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        defaultOpen: false,
        onSelect: () => undefined,
        selectedCharacterId: null,
        thumbnails: {},
      }),
    );
    const expandedMarkup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        defaultOpen: true,
        onSelect: () => undefined,
        selectedCharacterId: null,
        thumbnails: {},
      }),
    );

    expect(issue502Styles).toContain('padding: 20px;');
    expect(issue502Styles).toContain('background: #122018;');
    expect(issue502Styles).not.toContain('linear-gradient(');
    expect(issue502Styles).toContain('width: 18px;');
    expect(issue502Styles).toContain('height: 18px;');
    expect(collapsedMarkup).toContain('aria-hidden="true"');
    expect(collapsedMarkup).toContain('>▼</span>');
    expect(collapsedMarkup).not.toContain('>▲</span>');
    expect(expandedMarkup).toContain('>▲</span>');
    expect(expandedMarkup).not.toContain('>▼</span>');
  });

  it('keeps CTA eligibility and the accepted sticky 52px geometry unchanged', () => {
    expect(sheet).toContain('disabled={!canAdd}');
    expect(sheet).toContain('onClick={handleAdd}');
    expect(styles).toContain('position: sticky');
    expect(styles).toContain('min-height: 52px;');
    expect(styles).toContain('width: 100%;');
  });
});
