import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  DialogueService,
  migrateProject,
} from '../../src/domain';
import { CharacterIdentityPicker } from '../../src/renderer/features/characters/CharacterIdentity';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function presentationSource(
  dialogue: string,
  presentation: 'properties' | 'landscape',
): string {
  const start = dialogue.indexOf(
    presentation === 'properties'
      ? 'if (propertiesPresentation)'
      : 'if (landscapePresentation)',
  );
  const end = dialogue.indexOf(
    presentation === 'properties'
      ? 'if (landscapePresentation)'
      : '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dialogue.slice(start, end);
}

function renderA08Picker(): { markup: string; characterName: string } {
  const project = migrateProject(exampleProject);
  const character = project.characters[0]!;

  return {
    markup: renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        onSelect: () => undefined,
        selectedCharacterId: character.id,
        selectedLabel: '当前绑定',
        showDefaultExpression: false,
        thumbnails: {},
      }),
    ),
    characterName: character.name,
  };
}

describe('Issue #504 A08 subtitle Properties cleanup', () => {
  it('renders a pure 字幕内容 block without repeating Character identity', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const picker = renderA08Picker();

    for (const presentation of ['properties', 'landscape'] as const) {
      const section = presentationSource(dialogue, presentation);
      const copyStart = section.indexOf(
        'data-testid="dialogue-inspector-copy-section"',
      );
      const copyEnd = section.indexOf('<textarea', copyStart);
      expect(copyStart).toBeGreaterThanOrEqual(0);
      expect(copyEnd).toBeGreaterThan(copyStart);
      const copy = section.slice(copyStart, copyEnd);

      expect(copy).toContain('字幕内容');
      expect(section).toContain('dialogue-inspector-text');
      expect(copy).not.toContain('<CharacterAvatar');
      expect(copy).not.toContain('character?.name');
    }

    expect(picker.markup).toContain('当前绑定');
    expect(picker.markup).not.toContain('默认表情：');
  });

  it('uses the approved A08 title and local Character picker presentation only', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const fallbackStart = dialogue.indexOf(
      '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    );
    const properties = dialogue.slice(propertiesStart, landscapeStart);
    const landscape = dialogue.slice(landscapeStart, fallbackStart);

    expect(properties).toContain('aria-label="编辑字幕"');
    expect(landscape).toContain('aria-label="编辑字幕"');
    for (const presentation of [properties, landscape]) {
      expect(presentation).toContain('字幕内容');
      expect(presentation).toContain('MessageSquareText');
      expect(presentation).toContain('selectedLabel="当前绑定"');
      expect(presentation).toContain('showDefaultExpression={false}');
      expect(presentation).not.toContain('<CharacterAvatar');
      expect(presentation).toContain('dialogueStore.update(dialogue.id');
    }

    expect(inspector).toContain("? '编辑字幕'");
    expect(inspector).not.toContain("? '字幕属性'");
  });

  it('changes only the intended Character binding when the existing owner updates it', () => {
    const originalProject = migrateProject(exampleProject);
    const dialogueService = new DialogueService();
    const characterService = new CharacterService({
      createId: (() => {
        const ids = [
          '20000000-0000-4000-8000-000000000101',
          '20000000-0000-4000-8000-000000000102',
          '30000000-0000-4000-8000-000000000101',
        ];
        return () => ids.shift()!;
      })(),
    });
    const project = characterService.create(originalProject, {
      name: '另一个角色',
      expressions: [
        {
          name: '正常',
          assetId: originalProject.assets.find((asset) => asset.kind === 'image')!.id,
        },
      ],
    });
    const shot = project.shots.find((candidate) => candidate.dialogues.length)!;
    const before = shot.dialogues[0]!;
    const nextCharacter = project.characters[1]!;
    const updated = dialogueService.update(project, {
      shotId: shot.id,
      dialogueId: before.id,
      characterId: nextCharacter.id,
    });
    const after = updated.shots.find((candidate) => candidate.id === shot.id)!.dialogues[0]!;

    expect(after).toMatchObject({
      audioClipId: before.audioClipId,
      characterId: nextCharacter.id,
      endMs: before.endMs,
      startMs: before.startMs,
      text: before.text,
    });
  });
});
