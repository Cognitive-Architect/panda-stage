import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema, upsertExpressionEventAtTime } from '../../src/domain';
import { ExpressionAtTimeControl } from '../../src/renderer/features/properties/ExpressionAtTimeControl';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { buildProject, IDS } from './domain/testProject';

vi.mock('../../src/renderer/features/timeline/timelineUiStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/features/timeline/timelineUiStore')>();
  return { ...actual, useTimelineUi: () => actual.timelineUiStore.getSnapshot() };
});

describe('Issue #627 Expression-at-time control', () => {
  it('shows the selected occurrence’s current Face, visual choices and existing switch', () => {
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({ ...shot, durationMs: 6_000 })),
    });
    const authored = upsertExpressionEventAtTime(
      project, IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_000,
    );
    timelineUiStore.seek(3_000, 6_000);
    const shot = authored.shots[0]!;
    const layer = shot.layers.find((candidate) => candidate.id === IDS.layerChar)!;
    const markup = renderToStaticMarkup(createElement(ExpressionAtTimeControl, {
      project: authored,
      projectRoot: 'D:\expression-ui.pandastage',
      shot,
      layer,
    }));

    expect(markup).toContain('data-testid="expression-at-time"');
    expect(markup).toContain('00:03.000');
    expect(markup).toContain('当前：<strong>生气</strong>');
    expect(markup).toContain(`data-expression-id="${IDS.expressionNormal}"`);
    expect(markup).toContain(`data-expression-id="${IDS.expressionAngry}"`);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('切换点');
    expect(markup).toContain('删除 00:03.000 的 生气 切换');

    const ordinary = renderToStaticMarkup(createElement(ExpressionAtTimeControl, {
      project: authored,
      projectRoot: 'D:\expression-ui.pandastage',
      shot,
      layer: shot.layers.find((candidate) => candidate.id === IDS.layerAsset)!,
    }));
    expect(ordinary).toBe('');
  });
});
