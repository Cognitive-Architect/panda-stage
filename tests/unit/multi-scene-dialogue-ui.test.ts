import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MultiSceneDialoguePanel } from '../../src/renderer/features/shots/MultiSceneDialoguePanel';

const DRAWER = 'src/renderer/shell/ProjectToolsDrawer.tsx';
const PANEL = 'src/renderer/features/shots/MultiSceneDialoguePanel.tsx';
const PLAN = 'src/renderer/features/shots/multiSceneDialoguePlan.ts';
const COMMIT_OWNER = 'src/renderer/features/shots/multiScenePlan.ts';
const STYLES_ENTRY = 'src/renderer/styles.css';
const STYLESHEET =
  './styles/features/shots/s09-07--multi-scene-dialogue-panel.css';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('AUTO-05 multi-scene dialogue surface', () => {
  it('is reachable from the Project tools drawer', () => {
    const drawer = source(DRAWER);
    expect(drawer).toContain("'multi-scene-dialogue'");
    expect(drawer).toContain("'multi-scene-dialogue': '多镜头对白'");
    expect(drawer).toContain('data-testid="project-tools-multi-scene-dialogue"');
    expect(drawer).toContain('data-project-tools-action="multi-scene-dialogue"');
    expect(drawer).toContain('<MultiSceneDialoguePanel />');
    expect(drawer).toContain('VIEW_TITLES');
  });

  it('asks for a Project before offering the batch controls', () => {
    const html = renderToStaticMarkup(
      createElement(MultiSceneDialoguePanel, { snapshot: null }),
    );
    expect(html).toContain('data-testid="multi-scene-dialogue-no-project"');
    expect(html).toContain('请先打开工程');
    expect(html).not.toContain('data-testid="multi-scene-dialogue-input"');
    expect(html).not.toContain('data-testid="multi-scene-dialogue-generate"');
  });

  it('keeps one flat primary button and no teaching paragraphs', () => {
    const panel = source(PANEL);
    expect(panel.match(/data-testid="multi-scene-dialogue-generate"/gu)).toHaveLength(1);
    expect(panel).not.toContain('<h1');
    expect(panel).not.toContain('使用方法');
    expect(panel).not.toContain('本功能');
    const html = renderToStaticMarkup(
      createElement(MultiSceneDialoguePanel, { snapshot: null }),
    );
    expect(html).not.toContain('AI 帮我整理');
  });

  it('shows the real Shot extension in the preview, not a second confirm', () => {
    const panel = source(PANEL);
    expect(panel).toContain('镜头时长');
    expect(panel).toContain('formatDurationMs');
    expect(panel).not.toContain('仅生成镜头与对白草稿');
  });

  it('registers its stylesheet exactly once', () => {
    const entry = source(STYLES_ENTRY);
    expect(entry.split(STYLESHEET).length - 1).toBe(1);
  });

  it('never writes the Project from the panel itself', () => {
    const panel = source(PANEL);
    expect(panel).not.toContain('updateProject(');
    expect(panel).toContain('commitMultiSceneDialoguePreview');
    expect(panel).toContain('prepareMultiSceneDialoguePreview');
  });

  it('keeps the AUTO-04 plan module the only commit owner', () => {
    expect(source(COMMIT_OWNER).match(/editorStore\.updateProject\(/gu)).toHaveLength(1);
    expect(source(PLAN)).not.toContain('editorStore.updateProject(');
    expect(source(PLAN)).toContain('MULTI_SCENE_DIALOGUE_HISTORY_LABEL');
  });

  it('delegates the batch lifecycle to the panel model', () => {
    const panel = source(PANEL);
    expect(panel).toContain('initialPanelState');
    expect(panel).toContain('inputChanged(');
    expect(panel).toContain('checkApplied(');
    expect(panel).toContain('submissionBatch(');
    expect(panel).toContain('disabled={!submittable}');
    expect(panel).not.toContain('setRawInput');
  });

  it('registers the new tests under the shots verification route', () => {
    const manifest = source('scripts/verification-manifest.json');
    expect(manifest).toContain('tests/unit/multi-scene-*.test.ts');
    expect(manifest).toContain('tests/integration/multi-scene-*.test.ts');
  });
});
