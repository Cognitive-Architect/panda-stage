import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  type Character,
  type Project,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { buildProject, IDS } from './domain/testProject';

const noop = () => undefined;

function headedProject(): Project {
  const project = buildProject();
  const character = project.characters[0]!;
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...character,
        mode: 'composite',
        bodyAssetId: IDS.assetBg,
        facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        head: {
          assetId: IDS.assetChar2,
          placement: { offsetX: 0, offsetY: -10, scale: 1 },
          pivot: { x: 320, y: 300 },
        },
      },
    ],
  });
}

function editorMarkup(project: Project, character: Character): string {
  const imageAssets = project.assets.filter(
    (asset) => asset.kind === 'image',
  );
  return renderToStaticMarkup(
    createElement(CharacterEditor, {
      character,
      project,
      imageAssets,
      thumbnails: {},
      warnings: [],
      onRenameCharacter: noop,
      onDeleteCharacter: noop,
      onAddExpression: noop,
      onRenameExpression: noop,
      onSetExpressionAsset: noop,
      onRemoveExpression: noop,
      onSetDefaultExpression: noop,
      onSetMouthOpenAsset: noop,
      onSetDefaultTransform: noop,
      onSetTalkingHeadMotionIntensityPercent: noop,
      onThumbnailError: noop,
      presentation: 'landscape',
      view: 'detail',
    }),
  );
}

function settingsMarkup(project: Project, character: Character): string {
  const markup = editorMarkup(project, character);
  return markup.slice(markup.indexOf('data-workspace="settings"'));
}

describe('Issue #815 talking-head settings', () => {
  it('shows the default intensity control only for a composite Character with Head', () => {
    const project = headedProject();
    const character = project.characters[0]!;
    const settings = settingsMarkup(project, character);

    expect(settings).toContain('data-testid="character-talking-head-settings"');
    expect(settings).toContain('说话时自动点头');
    expect(settings).toContain('aria-label="点头强度"');
    expect(settings).toContain('min="0"');
    expect(settings).toContain('max="200"');
    expect(settings).toContain('step="10"');
    expect(settings).toContain('value="100"');
    expect(settings).toContain('静止');
    expect(settings).toContain('标准');
    expect(settings).toContain('明显');
    expect(settings).toContain('恢复默认');
    expect(settings).toContain('data-testid="character-talking-head-preview-toggle"');
  });

  it('does not show an ineffective intensity control for headless or single-image Characters', () => {
    const project = headedProject();
    const composite = project.characters[0]!;
    if (composite.mode !== 'composite') {
      throw new Error('Expected a composite fixture.');
    }
    const { head: _head, ...headlessCharacter } = composite;
    expect(_head).toBeDefined();
    const headlessProject = ProjectSchema.parse({
      ...project,
      characters: [headlessCharacter],
    });
    const singleImageProject = buildProject();

    expect(
      settingsMarkup(headlessProject, headlessProject.characters[0]!),
    ).not.toContain('data-testid="character-talking-head-settings"');
    expect(
      settingsMarkup(singleImageProject, singleImageProject.characters[0]!),
    ).not.toContain('data-testid="character-talking-head-settings"');
  });
});
