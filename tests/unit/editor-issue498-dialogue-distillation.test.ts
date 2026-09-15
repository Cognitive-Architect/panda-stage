import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { DialogueService, ShotService, migrateProject } from '../../src/domain';
import {
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
} from '../../src/renderer/features/characters/CharacterIdentity';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #498 New Dialogue redundant chrome distillation', () => {
  it('removes the four redundant right-workspace presentation groups', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const headerStart = sheet.indexOf(
      'data-testid="dialogue-authoring-drawer-header"',
    );
    const headerEnd = sheet.indexOf('</header>', headerStart);
    const authoringHeader = sheet.slice(headerStart, headerEnd);

    expect(headerStart).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(headerStart);
    expect(authoringHeader).toContain(
      'data-testid="dialogue-authoring-secondary-nav"',
    );
    expect(authoringHeader).toContain('data-testid="subtitle-workspace-close"');
    expect(authoringHeader).not.toContain('dialogue-drawer-header-icon');
    expect(authoringHeader).not.toContain('dialogue-drawer-title');

    expect(sheet).not.toContain('data-testid="dialogue-authoring-advanced"');
    expect(sheet).not.toContain('>更多设置</summary>');
    expect(sheet).not.toContain('创建后将进入待安排队列');
    expect(sheet).not.toContain('dialogue-authoring-helper');
    expect(sheet).not.toContain('dialogue-authoring-placement-field');
    expect(sheet).not.toContain('dialogue-authoring-audio-field');
    expect(sheet).toContain('showDefaultExpression={!rightWorkspace}');
    expect(batch).toContain('showDefaultExpression={showDefaultExpression}');

    const issue498Styles = styles.slice(styles.lastIndexOf('/* Issue #498:'));
    expect(issue498Styles).toContain('dialogue-authoring-drawer-header');
    expect(issue498Styles).toContain('margin-inline: 0;');
  });

  it('hides default-expression metadata without changing avatar derivation', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const defaultExpression = getCharacterDefaultExpression(character)!;
    const markup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        defaultOpen: true,
        onSelect: () => undefined,
        selectedCharacterId: character.id,
        showDefaultExpression: false,
        thumbnails: {
          [defaultExpression.assetId]: { status: 'ready', dataUrl },
        },
      }),
    );

    expect(markup).toContain(character.name);
    expect(markup).toContain(dataUrl);
    expect(markup).not.toContain('默认表情：');
  });

  it('keeps creation on the existing pending/untimed DialogueStore path', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layerSelection = new LayerSelectionStore(editor, shots);
    const dialogueSelection = new DialogueSelectionStore(
      editor,
      shots,
      layerSelection,
    );
    const store = new DialogueStore(
      editor,
      shots,
      new DialogueService(),
      { getSnapshot: () => ({ currentTimeMs: 120 }) },
      dialogueSelection,
    );

    editor.open('D:\\issue-498-dialogue-distillation.pandastage', buildProject());
    shots.select(IDS.shot);
    const dialogueId = store.create(IDS.character, 'Cut 1 pending 字幕');
    const dialogue = editor
      .getSnapshot()!
      .project.shots[0]!
      .dialogues.find((candidate) => candidate.id === dialogueId)!;

    expect(dialogue).toMatchObject({
      characterId: IDS.character,
      endMs: 120,
      startMs: 120,
      text: 'Cut 1 pending 字幕',
    });
    expect(dialogueSelection.getSelectedDialogueId()).toBe(dialogueId);
  });
});
