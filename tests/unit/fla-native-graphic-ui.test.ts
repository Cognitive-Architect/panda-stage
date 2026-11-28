import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extendNativeGraphicExposure, type FlaGraphicDefinition } from '../../src/domain';
import { FlaGraphicInternalTimelineBar } from '../../src/renderer/features/timeline/FlaGraphicInternalTimelineBar';
import type { FlaGraphicInternalTimelineContext } from '../../src/renderer/features/timeline/timelineUiStore';
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

describe('issue #1453 native Graphic exposure controls (static render)', () => {
  function renderTimelineBar(
    project: ReturnType<typeof buildSourceGraphicFixture>['project'],
    animationId: string,
    layerId: string,
  ): string {
    const context: FlaGraphicInternalTimelineContext = {
      layerId,
      animationId,
      frameOrdinal: 0,
      selectedNodePath: null,
      internalTimeMs: 0,
      fps: 24,
      timelineAuthoringActive: false,
    };
    return renderToStaticMarkup(createElement(FlaGraphicInternalTimelineBar, {
      context,
      project,
    }));
  }

  it('offers frame, exposure and layer authoring for a native Definition', () => {
    const { project, animationId } = buildNativeBitmapOnlyProject();
    const extended = extendNativeGraphicExposure(project, {
      animationId,
      count: 1,
    });
    const markup = renderTimelineBar(extended.project, animationId, 'layer-1');
    expect(markup).toContain('data-testid="fla-internal-exposure-controls"');
    expect(markup).toContain('data-testid="fla-internal-exposure-frame"');
    expect(markup).toContain('插入空白关键帧');
    expect(markup).toContain('data-testid="fla-internal-copy-frame"');
    expect(markup).toContain('延长曝光');
    expect(markup).toContain('缩短曝光');
    expect(markup).toContain('data-testid="fla-internal-exposure-layer"');
    expect(markup).toContain('新增层');
    expect(markup).toContain('删除层');
    expect(markup).toContain('层后移');
    expect(markup).toContain('层前移');
    // Held exposure cells are labelable so the creator can navigate them.
    expect(markup).toContain('帧 2（保持）');
  });

  it('keeps exposure controls out of source-backed Definitions', () => {
    const fixture = buildSourceGraphicFixture();
    const definition = fixture.project.animations.find(
      (candidate) => candidate.id === SOURCE_GRAPHIC_ID,
    ) as FlaGraphicDefinition;
    const layer = fixture.project.shots[0]!.layers.find(
      (candidate) => candidate.source.kind === 'animation'
        && candidate.source.animationId === definition.id,
    );
    const markup = renderTimelineBar(fixture.project, definition.id, layer?.id ?? 'layer-1');
    expect(markup).not.toContain('fla-internal-exposure-controls');
    expect(markup).not.toContain('插入空白关键帧');
  });
});
