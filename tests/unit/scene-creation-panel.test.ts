import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShotCreateForm } from '../../src/renderer/features/shots/ShotCreateForm';
import {
  EXTERNAL_SCENE_ORGANIZATION_PROMPT,
  SceneCreationPanel,
} from '../../src/renderer/features/shots/SceneCreationPanel';

const noop = () => undefined;

describe('scene creation panel entry', () => {
  it('offers structured input from the existing shot creation flow', () => {
    const markup = renderToStaticMarkup(
      createElement(ShotCreateForm, {
        suggestedName: '镜头 1',
        onBack: noop,
        onCreate: () => false,
        onCreateFromStructuredInput: noop,
      }),
    );

    expect(markup).toContain('data-testid="shot-create-structured-input"');
    expect(markup).toContain('粘贴结构化输入');
  });

  it('shows the external prompt as a copyable value', () => {
    const markup = renderToStaticMarkup(
      createElement(SceneCreationPanel, {
        snapshot: null,
        onBack: noop,
      }),
    );

    expect(markup).toContain('data-testid="scene-creation-panel"');
    expect(markup).toContain('data-testid="scene-creation-input"');
    expect(markup).toContain('data-testid="scene-creation-copy-prompt"');
    expect(markup).toContain('查看整理提示词');
    expect(markup).toContain(EXTERNAL_SCENE_ORGANIZATION_PROMPT);
  });
});
