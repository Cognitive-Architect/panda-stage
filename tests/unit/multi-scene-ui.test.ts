import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MultiScenePanel } from '../../src/renderer/features/shots/MultiScenePanel';

const STYLES_ENTRY = 'src/renderer/styles.css';
const STYLESHEET = './styles/features/shots/s09-06--multi-scene-panel.css';

describe('AUTO-04 multi-scene surface', () => {
  it('is reachable from the Project tools drawer', () => {
    const source = readFileSync(
      'src/renderer/shell/ProjectToolsDrawer.tsx',
      'utf8',
    );
    expect(source).toContain("'multi-scene'");
    expect(source).toContain("'multi-scene': '多镜头布景'");
    expect(source).toContain('data-testid="project-tools-multi-scene"');
    expect(source).toContain('data-project-tools-action="multi-scene"');
    expect(source).toContain('<MultiScenePanel />');
  });

  it('keeps the batch surface flat: input, check, generate', () => {
    const html = renderToStaticMarkup(
      createElement(MultiScenePanel, { snapshot: null }),
    );
    expect(html).toContain('data-testid="multi-scene-no-project"');
    expect(html).not.toContain('data-testid="multi-scene-generate"');
  });

  it('asks for a Project before offering the batch controls', () => {
    const html = renderToStaticMarkup(
      createElement(MultiScenePanel, { snapshot: null }),
    );
    expect(html).toContain('请先打开工程');
    expect(html).not.toContain('data-testid="multi-scene-input"');
  });

  it('renders no teaching paragraphs or extra labels', () => {
    const html = renderToStaticMarkup(
      createElement(MultiScenePanel, { snapshot: null }),
    );
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('本功能');
    expect(html).not.toContain('使用方法');
  });

  it('registers its stylesheet exactly once', () => {
    const entry = readFileSync(STYLES_ENTRY, 'utf8');
    const matches = entry.split(STYLESHEET).length - 1;
    expect(matches).toBe(1);
  });

  it('never writes the Project from the panel itself', () => {
    const source = readFileSync(
      'src/renderer/features/shots/MultiScenePanel.tsx',
      'utf8',
    );
    // The panel may read the store but every write goes through the plan module.
    expect(source).not.toContain('updateProject(');
    expect(source).toContain('commitMultiScenePreview');
    expect(source).toContain('prepareMultiScenePreview');
  });

  it('keeps the batch plan module the only commit owner', () => {
    const source = readFileSync(
      'src/renderer/features/shots/multiScenePlan.ts',
      'utf8',
    );
    expect(source.match(/updateProject\(/gu)).toHaveLength(1);
    expect(source).toContain('MULTI_SCENE_HISTORY_LABEL');
  });

  it('delegates the batch lifecycle to the panel model', () => {
    const source = readFileSync(
      'src/renderer/features/shots/MultiScenePanel.tsx',
      'utf8',
    );
    // FIX-01: editing the storyboard must invalidate the batch it produced, and
    // the store's identity gate cannot see that, so the panel owns no local
    // checked state of its own.
    expect(source).toContain('initialPanelState');
    expect(source).toContain('inputChanged(');
    expect(source).toContain('checkApplied(');
    expect(source).toContain('submissionBatch(');
    expect(source).not.toContain('setRawInput');
    // FIX-01: a stale batch must also disable the button, not just the handler.
    expect(source).toContain('disabled={!submittable}');
  });
});
