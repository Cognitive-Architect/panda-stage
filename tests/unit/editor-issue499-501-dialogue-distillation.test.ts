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

describe('Issue #499–#501 New Dialogue Cut 2 distillation', () => {
  const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
  const identity = source(
    'src/renderer/features/characters/CharacterIdentity.tsx',
  );
  const styles = source('src/renderer/styles.css');

  it('uses one concise unbound Character prompt only in the right workspace', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const markup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        emptySummaryDescription: null,
        emptySummaryLabel: '请绑定角色',
        onSelect: () => undefined,
        selectedCharacterId: null,
        thumbnails: {},
      }),
    );

    expect(markup).toContain('请绑定角色');
    expect(markup).not.toContain('选择现有角色');
    expect(markup).not.toContain('从项目角色中选择说话人');
    expect(markup).toContain('character-identity-empty-icon');
    expect(markup).toContain('character-identity-picker-chevron');
    expect(identity).toContain('emptySummaryDescription?: string | null;');
    expect(sheet).toContain("rightWorkspace ? '请绑定角色' : '选择现有角色'");
    expect(sheet).toContain(
      "rightWorkspace ? null : '从项目角色中选择说话人'",
    );
    expect(sheet).toContain(
      "{rightWorkspace ? null : (\n                    <label htmlFor=\"dialogue-add-speaker\">",
    );
  });

  it('names the existing back action by its subtitle-list destination', () => {
    const headerStart = sheet.indexOf(
      'data-testid="dialogue-authoring-drawer-header"',
    );
    const headerEnd = sheet.indexOf('</header>', headerStart);
    const header = sheet.slice(headerStart, headerEnd);

    expect(header).toContain('aria-label="返回字幕列表"');
    expect(header).toContain('<span>返回字幕列表</span>');
    expect(header).not.toContain('新建字幕');
    expect(sheet).toContain('onClick={handleCloseAuthoring}');
  });

  it('aligns the right-workspace CTA while preserving validation semantics', () => {
    const ctaStart = sheet.indexOf('data-testid="dialogue-add"');
    const ctaEnd = sheet.indexOf('</button>', ctaStart);
    const cta = sheet.slice(ctaStart, ctaEnd);
    const issue501Styles = styles.slice(styles.lastIndexOf('/* Issue #501:'));

    expect(cta).toContain('disabled={!canAdd}');
    expect(cta).toContain('CirclePlus');
    expect(cta).toContain("rightWorkspace ? '创建字幕' : '新增字幕'");
    expect(issue501Styles).toContain('position: sticky');
    expect(issue501Styles).toContain('min-height: 52px;');
    expect(issue501Styles).toContain('width: 100%;');
    expect(issue501Styles).toContain('display: inline-flex;');
    expect(issue501Styles).toContain(
      'background: var(--ui-color-action-primary, #8ed9a2);',
    );
    expect(issue501Styles).toContain(
      '.dialogue-authoring-submit:disabled',
    );
    expect(issue501Styles).toContain('background: #122018;');
  });
});
