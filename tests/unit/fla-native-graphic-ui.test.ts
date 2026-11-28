import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlaGraphicDefinition } from '../../src/domain';
import {
  AnimationLibraryCard,
  AnimationLibraryPanel,
} from '../../src/renderer/features/assets/AnimationLibraryPanel';
import {
  buildNativeBitmapOnlyProject,
  buildSourceGraphicFixture,
  SOURCE_GRAPHIC_ID,
} from '../helpers/nativeGraphicProject';

function nativeDefinition(): FlaGraphicDefinition {
  const { project, animationId } = buildNativeBitmapOnlyProject();
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition || !('kind' in definition)) throw new Error('native fixture missing');
  return definition;
}

function renderCard(
  animation: FlaGraphicDefinition,
  project: ReturnType<typeof buildSourceGraphicFixture>['project'],
): string {
  return renderToStaticMarkup(createElement(AnimationLibraryCard, {
    animation,
    project,
    projectRoot: 'C:\\dummy\\native-graphic-ui',
  }));
}

describe('issue #1452 native Graphic library controls (static render)', () => {
  it('labels a native Definition and exposes duplicate/delete controls', () => {
    const { project } = buildNativeBitmapOnlyProject();
    const markup = renderCard(nativeDefinition(), project);
    expect(markup).toContain('data-native-graphic="true"');
    expect(markup).toContain('原生元件');
    expect(markup).toContain('独立副本');
    expect(markup).toContain('删除');
    expect(markup).toContain('data-testid="native-graphic-duplicate"');
    expect(markup).toContain('data-testid="native-graphic-delete"');
  });

  it('keeps source-backed Definitions free of native-only controls', () => {
    const fixture = buildSourceGraphicFixture();
    const definition = fixture.project.animations.find(
      (candidate) => candidate.id === SOURCE_GRAPHIC_ID,
    ) as FlaGraphicDefinition;
    const markup = renderCard(definition, fixture.project);
    expect(markup).not.toContain('data-native-graphic="true"');
    expect(markup).not.toContain('data-testid="native-graphic-duplicate"');
    expect(markup).not.toContain('data-testid="native-graphic-delete"');
    expect(markup).toContain('>动画<');
  });

  it('lists the native Definition in the shared animation library panel', () => {
    const { project, animationId } = buildNativeBitmapOnlyProject();
    const markup = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'C:\\dummy\\native-graphic-ui',
      searchQuery: '原生',
    }));
    expect(markup).toContain(`data-animation-id="${animationId}"`);
    expect(markup).toContain('原生元件');
  });
});
