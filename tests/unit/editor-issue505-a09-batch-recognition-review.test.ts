import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Character } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
} from '../../src/renderer/features/characters/CharacterIdentity';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
} from '../../src/renderer/features/dialogue/parseDialoguePaste';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture(): { character: Character; duplicate: Character } {
  const project = migrateProject(exampleProject);
  const character = project.characters[0]!;
  return {
    character,
    duplicate: {
      ...character,
      id: '20000000-0000-4000-8000-000000000505',
    },
  };
}

describe('Issue #505 R6.2 A09 batch recognition review', () => {
  it('keeps the parser and mapping engine unchanged while distinguishing all exception classes', () => {
    const { character, duplicate } = fixture();
    const parsed = parseDialoguePaste(
      `${character.name}：已识别\n未知角色：待确认\n${character.name}：重名`,
      [character, duplicate],
    );
    const resolution = resolveDialoguePaste(parsed, {}, [character, duplicate]);

    expect(parsed.lines.map((line) => line.status)).toEqual([
      'ambiguous',
      'unknown',
      'ambiguous',
    ]);
    expect(resolution).toMatchObject({
      allResolved: false,
      failureCount: 0,
      readyCount: 0,
      unknownCount: 3,
    });

    const malformed = parseDialoguePaste('没有分隔符', [character]);
    const missingSpeaker = parseDialoguePaste('：缺少角色', [character]);
    const missingText = parseDialoguePaste(`${character.name}：`, [character]);
    expect(malformed.lines[0]!.status).toBe('malformed');
    expect(missingSpeaker.lines[0]!.reason).toBe('empty-speaker');
    expect(missingText.lines[0]!.reason).toBe('empty-text');
  });

  it('renders the existing Character avatar and picker as the visual identity surfaces', () => {
    const { character } = fixture();
    const expression = getCharacterDefaultExpression(character)!;
    const avatar = renderToStaticMarkup(
      createElement(CharacterAvatar, {
        character,
        thumbnail: { dataUrl, status: 'ready' },
      }),
    );
    const picker = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        defaultOpen: true,
        emptySummaryDescription: null,
        emptySummaryLabel: '请选择对应角色',
        onSelect: () => undefined,
        selectedCharacterId: null,
        showDefaultExpression: false,
        thumbnails: { [expression.assetId]: { dataUrl, status: 'ready' } },
      }),
    );

    expect(avatar).toContain('data-character-avatar="true"');
    expect(avatar).toContain(dataUrl);
    expect(picker).toContain('请选择对应角色');
    expect(picker).toContain('character-identity-options');
    expect(picker).not.toContain('默认表情：');
  });

  it('uses exception-first rows, concise mapping copy, honest counts, and the existing atomic owner', () => {
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = readOrderedStylesheetSource();
    const issue505Styles = styles.slice(styles.lastIndexOf('/* Issue #505:'));

    expect(batch).toContain('<CharacterAvatar');
    expect(batch).toContain('dialogue-batch-row-result-resolved');
    expect(batch).toContain('dialogue-batch-row-result-exception');
    expect(batch).toContain('<strong>识别结果</strong>');
    expect(batch).toContain('pendingCount');
    expect(batch).toContain('未找到“');
    expect(batch).toContain('对应多个角色，请确认');
    expect(batch).toContain('缺少角色名称');
    expect(batch).toContain('缺少台词内容');
    expect(batch).toContain('emptySummaryLabel="请选择对应角色"');
    expect(batch).toContain('showDefaultExpression={showDefaultExpression}');
    expect(batch).toContain('dialogueStore.createMany(');
    expect(batch).toContain('`还有 ${pendingCount} 条待确认`');
    expect(batch).toContain('`添加 ${resolution.readyCount} 条字幕`');
    expect(sheet).toContain('showDefaultExpression={!rightWorkspace}');
    for (const staleCopy of [
      '没找到这个角色',
      '对应为',
      '选择要对应的角色',
      '请先处理上方需要确认的字幕。',
    ]) {
      expect(batch).not.toContain(staleCopy);
    }

    expect(issue505Styles).toContain('max-height: none;');
    expect(issue505Styles).toContain('overflow: visible;');
    expect(issue505Styles).toContain('position: static;');
    expect(issue505Styles).toContain('background: transparent;');
    expect(issue505Styles).toContain('min-height: 52px;');
    expect(issue505Styles).toContain('width: 100%;');
  });

  it('turns an unresolved mapping into the same resolved data path without changing text or order', () => {
    const { character } = fixture();
    const parsed = parseDialoguePaste(
      `未知角色：第一句\n${character.name}：第二句`,
      [character],
    );
    const mapped = resolveDialoguePaste(parsed, { 1: character.id }, [character]);

    expect(mapped).toMatchObject({
      allResolved: true,
      readyCount: 2,
    });
    expect(mapped.resolvedLines).toEqual([
      { characterId: character.id, text: '第一句' },
      { characterId: character.id, text: '第二句' },
    ]);
  });
});
