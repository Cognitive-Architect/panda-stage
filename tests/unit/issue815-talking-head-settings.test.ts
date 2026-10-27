import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  type Character,
  type Project,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import {
  CharacterTalkingHeadMotionPreview,
  resolveTalkingHeadPreviewBounds,
} from '../../src/renderer/features/characters/CharacterTalkingHeadMotionPreview';
import { buildProject, IDS } from './domain/testProject';

const noop = () => undefined;

function headedProject(intensityPercent = 100): Project {
  const project = buildProject();
  const character = project.characters[0]!;
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...character,
        mode: 'composite',
        bodyAssetId: IDS.assetBg,
        talkingHeadMotionIntensityPercent: intensityPercent,
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

function editorMarkup(
  project: Project,
  character: Character,
  presentation: 'default' | 'landscape' = 'landscape',
): string {
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
      presentation,
      view: 'detail',
    }),
  );
}

function settingsMarkup(
  project: Project,
  character: Character,
  presentation: 'default' | 'landscape' = 'landscape',
): string {
  const markup = editorMarkup(project, character, presentation);
  return presentation === 'landscape'
    ? markup.slice(markup.indexOf('data-workspace="settings"'))
    : markup;
}

describe('Issue #815 talking-head settings', () => {
  it.each(['landscape', 'default'] as const)(
    'shows the intensity control in the %s settings path only for a composite Character with Head',
    (presentation) => {
    const project = headedProject();
    const character = project.characters[0]!;
    const settings = settingsMarkup(project, character, presentation);

    expect(settings).toContain('data-testid="character-talking-head-settings"');
    expect(settings).toContain('id="character-talking-head-label-');
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
    expect(settings).not.toContain('说话动作');
    expect(settings).not.toContain('说话时自动点头');
    expect(settings).not.toContain('说话时保持静止');
    expect(settings).not.toContain('上下约');
    },
  );

  it.each([0, 100, 200])(
    'keeps the live %i%% value and slider without helper copy',
    (intensityPercent) => {
      const project = headedProject(intensityPercent);
      const character = project.characters[0]!;
      const settings = settingsMarkup(project, character, 'default');

      expect(settings).toContain(`value="${intensityPercent}"`);
      expect(settings).toContain(`${intensityPercent}%`);
      expect(settings).toContain('data-testid="character-talking-head-intensity"');
      expect(settings).not.toContain('说话动作');
      expect(settings).not.toContain('说话时自动点头');
      expect(settings).not.toContain('说话时保持静止');
      expect(settings).not.toContain('上下约');
    },
  );

  it('keeps the real preview mounted beside the compact controls', () => {
    const project = headedProject();
    const character = project.characters[0]!;
    const settings = settingsMarkup(project, character);
    const headingIndex = settings.indexOf('character-talking-head-field-heading');
    const restoreIndex = settings.indexOf(
      'data-testid="character-talking-head-restore-default"',
    );
    const intensityIndex = settings.indexOf(
      'data-testid="character-talking-head-intensity"',
    );
    const previewIndex = settings.indexOf(
      'data-testid="character-talking-head-motion-preview"',
    );
    const toggleIndex = settings.indexOf(
      'data-testid="character-talking-head-preview-toggle"',
    );

    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeGreaterThan(headingIndex);
    expect(restoreIndex).toBeLessThan(intensityIndex);
    expect(settings).toContain('data-playing="false"');
    expect(settings).toContain('data-asset-id=');
    expect(previewIndex).toBeGreaterThan(intensityIndex);
    expect(toggleIndex).toBeGreaterThan(previewIndex);
    expect(settings.match(/data-testid="character-talking-head-preview-toggle"/gu)).toHaveLength(1);
  });

  it('keeps only a dirty apply/revert bar and adapts the preview to narrow panels', () => {
    const editor = readFileSync(
      'src/renderer/features/characters/CharacterEditor.tsx',
      'utf8',
    );
    const styles = readFileSync(
      'src/renderer/styles/features/characters/settings/s16-01--character-settings-and-expression-523.css',
      'utf8',
    );

    expect(editor).toContain('data-testid="character-talking-head-pending"');
    expect(editor).toContain('data-testid="character-talking-head-revert"');
    expect(editor).toContain('data-testid="character-talking-head-apply"');
    expect(editor).not.toContain('应用后保存到此角色');
    expect(editor).toMatch(
      /onSetTalkingHeadMotionIntensityPercent\(\s*talkingHeadMotionIntensityPercent,/u,
    );
    expect(styles).toContain('@container talking-head (max-width: 320px)');
    expect(styles).toContain('@container talking-head (max-width: 240px)');
    expect(styles).toContain('.character-talking-head-preview-button[aria-pressed=\'true\']');
  });

  it('zooms the inline preview to the head and shoulder region', () => {
    const bounds = resolveTalkingHeadPreviewBounds(
      { x: -80, y: -180, width: 160, height: 180 },
      { x: -70, y: -160, width: 140, height: 150 },
      { x: -200, y: 0, width: 400, height: 800 },
    );
    expect(bounds.height).toBeLessThan(400);
    expect(bounds.width).toBeLessThan(700);

    const project = headedProject();
    const character = project.characters[0]!;
    if (character.mode !== 'composite' || !character.head) {
      throw new Error('Expected the headed composite fixture.');
    }
    const headedCharacter = { ...character, head: character.head };
    const preview = renderToStaticMarkup(
      createElement(CharacterTalkingHeadMotionPreview, {
        character: headedCharacter,
        intensityPercent: 100,
        playing: true,
        project,
        thumbnails: {},
      }),
    );
    expect(preview).toContain('data-preview-focus="head-and-shoulders"');
    expect(preview).toMatch(/data-preview-scale="0\.[1-9]\d*"/u);
  });

  it('uses the shared 48px touch target for talking-head actions and slider', () => {
    const styles = readFileSync(
      'src/renderer/styles/features/characters/settings/s16-01--character-settings-and-expression-523.css',
      'utf8',
    );
    expect(styles).toContain(".editor-shell[data-editor-device-mode='cloud-touch']");
    expect(styles).toContain('.character-talking-head-actions button');
    expect(styles).toContain('.character-talking-head-intensity-control input[type=\'range\']');
    expect(styles).toContain('min-height: var(--ui-touch-regular)');
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
