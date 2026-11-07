import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MultiScenePerformancePanel } from '../../src/renderer/features/shots/MultiScenePerformancePanel';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import { buildPerformanceProject } from '../helpers/multiSceneDialogueFixture';

const DRAWER = 'src/renderer/shell/ProjectToolsDrawer.tsx';
const PANEL = 'src/renderer/features/shots/MultiSceneDialoguePanel.tsx';
const WRAPPER = 'src/renderer/features/shots/MultiScenePerformancePanel.tsx';
const PLAN = 'src/renderer/features/shots/multiScenePerformancePlan.ts';
const COMMIT_OWNER = 'src/renderer/features/shots/multiScenePlan.ts';
const STYLES_ENTRY = 'src/renderer/styles.css';
const STYLESHEET =
  './styles/features/shots/s09-08--multi-scene-performance-panel.css';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('AUTO-06 performance orchestration surface', () => {
  it('is reachable from the Project tools drawer without replacing AUTO-05', () => {
    const drawer = source(DRAWER);
    expect(drawer).toContain("'multi-scene-performance': '表演编排'");
    expect(drawer).toContain(
      'data-project-tools-action="multi-scene-performance"',
    );
    expect(drawer).toContain(
      'data-testid="project-tools-multi-scene-performance"',
    );
    expect(drawer).toContain('<MultiScenePerformancePanel />');
    expect(drawer).toContain('<MultiSceneDialoguePanel />');
    expect(drawer).toContain('VIEW_TITLES');
    expect(drawer).toContain("'multi-scene-dialogue': '多镜头对白'");
  });

  it('reuses the AUTO-05 panel with the performance planner injected', () => {
    const wrapper = source(WRAPPER);
    expect(wrapper).toContain('MultiSceneDialoguePanel');
    expect(wrapper).toContain('mode="performance"');
    expect(wrapper).not.toContain('updateProject(');
    const panel = source(PANEL);
    expect(panel).toContain('MultiScenePerformanceService');
    expect(panel).toContain('prepareMultiScenePerformancePreview');
    expect(panel).toContain('commitMultiScenePerformancePreview');
    expect(panel).toContain('PERFORMANCE_ACTION_LABELS');
    expect(panel).toContain('plannedPerformance(');
    // The same input / picker stale gate and one primary button are reused.
    expect(panel).toContain('inputChanged(');
    expect(panel).toContain('submissionBatch(');
    expect(panel).toContain('speakerPicked(');
    expect(panel).toContain('audioPicked(');
    expect(panel.match(/data-testid="multi-scene-dialogue-generate"/gu)).toHaveLength(1);
  });

  it('stays runtime-only: no TimelineEvent JSON, UUIDs or second player', () => {
    const panel = source(PANEL);
    expect(panel).not.toContain('updateProject(');
    expect(panel).not.toContain('JSON.stringify');
    expect(panel).not.toContain('timelineEvents');
    expect(panel).not.toContain('evaluateShotAtTime');
    expect(panel).not.toContain('<h1');
    expect(panel).not.toContain('使用方法');
    expect(panel).toContain('multi-scene-performance-line-message');
    expect(panel).toContain('整批未生成');
  });

  it('keeps one commit owner and a distinct History label', () => {
    expect(source(COMMIT_OWNER).match(/editorStore\.updateProject\(/gu)).toHaveLength(1);
    const plan = source(PLAN);
    expect(plan).not.toContain('editorStore.updateProject(');
    expect(plan).toContain('commitMultiScenePreview');
    expect(plan).toContain('MULTI_SCENE_PERFORMANCE_HISTORY_LABEL');
  });

  it('registers its stylesheet exactly once', () => {
    expect(source(STYLES_ENTRY).split(STYLESHEET).length - 1).toBe(1);
    const css = source(
      'src/renderer/styles/features/shots/s09-08--multi-scene-performance-panel.css',
    );
    expect(css).toContain('.multi-scene-performance-line');
    expect(css).not.toContain('.card');
  });

  it('asks for a Project before offering performance controls', () => {
    const html = renderToStaticMarkup(
      createElement(MultiScenePerformancePanel, { snapshot: null }),
    );
    expect(html).toContain('data-multi-scene-performance="true"');
    expect(html).toContain('请先打开工程');
    expect(html).not.toContain('data-testid="multi-scene-dialogue-input"');
    expect(html).not.toContain('data-testid="multi-scene-dialogue-generate"');
  });

  it('renders a flat performance form with one primary button', () => {
    const snapshot = {
      projectRoot: 'D:\\auto06.pandastage',
      project: buildPerformanceProject(),
      revision: 0,
      dirty: false,
    } as unknown as EditorProjectSnapshot;
    const html = renderToStaticMarkup(
      createElement(MultiScenePerformancePanel, { snapshot }),
    );
    expect(html).toContain('分镜 + 对白 + 表演 输入');
    expect(html).toContain('data-testid="multi-scene-dialogue-input"');
    expect(html).toContain('检查素材、配音与表演');
    expect(html).toContain('生成镜头与表演');
    expect(html).toContain('1｜表情｜生气');
    // AUTO-06-FIX-01 A: the sample keeps one logical property per line, so the
    // second line enters and scales while the fourth line moves.
    expect(html).toContain('2｜右入场');
    expect(html).toContain('2｜放大｜1.20');
    expect(html).toContain('4｜移动｜x=1260｜y=760');
    expect(html).toContain('disabled=""');
    expect(html.match(/data-testid="multi-scene-dialogue-generate"/gu)).toHaveLength(1);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('TimelineEvent');
  });

  it('is covered by the existing shots verification route', () => {
    const manifest = source('scripts/verification-manifest.json');
    expect(manifest).toContain('tests/unit/multi-scene-*.test.ts');
    expect(manifest).toContain('tests/integration/multi-scene-*.test.ts');
  });
});
