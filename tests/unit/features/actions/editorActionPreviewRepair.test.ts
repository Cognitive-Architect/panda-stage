/**
 * Issue #168 — repair of the H1 preview blocker.
 *
 * Two independent defects were proven on the combined acceptance head
 * `999b996` (see `.workbuddy/artifacts/issue-168-root-cause.md`):
 *
 *   A. The overlay mounted the formal `StageRenderer` on its very first commit,
 *      when its asynchronously loaded asset map was still empty. The formal
 *      render model refuses partial scenes (`MISSING_ASSET_URL`), so the
 *      renderer painted the full-bleed red `舞台无法渲染` surface at the start of
 *      every session — including every replay, because the overlay unmounts on
 *      `finish()` and therefore restarts with an empty map.
 *
 *   B. The overlay was mounted as a sibling of the canvas viewport and stretched
 *      across the whole `.project-canvas` panel, rendering its own independent
 *      16:9 stage. That read as a *second, offset* surface next to the editor
 *      canvas rather than a preview of it.
 *
 * These tests lock both repairs, plus the invariants #168 requires: the selected
 * layer survives into the preview scene, the preview scene composition matches
 * the editor's own render contract, and the preview stays side-effect free.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  type Project,
  type Shot,
} from '../../../../src/domain';
import {
  buildStageRenderModel,
  StageAssetError,
  type StageAssetUrlMap,
} from '../../../../src/shared/stage/render-model';
import { isPreviewSceneRenderable } from '../../../../src/renderer/features/actions/editorActionPreviewModel';
import { buildProject, IDS } from '../../domain/testProject';

const OVERLAY_PATH =
  'src/renderer/features/actions/EditorActionPreviewOverlay.tsx';
const CANVAS_PATH = 'src/renderer/features/canvas/CanvasStage.tsx';
const VIEWPORT_PATH = 'src/renderer/features/canvas/CanvasViewport.tsx';
const STYLES_PATH = 'src/renderer/styles.css';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function firstShot(project: Project): Shot {
  const shot = project.shots[0];
  if (!shot) throw new Error('fixture must contain a shot');
  return shot;
}

/** The complete asset map the overlay eventually resolves. */
function completeUrls(project: Project): StageAssetUrlMap {
  const urls: Record<string, string> = {};
  for (const asset of project.assets) {
    if (asset.kind === 'image') {
      urls[asset.id] = `data:image/png;base64,${asset.id}`;
    }
  }
  return urls;
}

describe('Issue #168 A — a preview session never passes through an invalid stage', () => {
  const project = buildProject();
  const shot = firstShot(project);
  const evaluated = evaluateShotAtTime(shot, 0, project);

  it('reproduces the defect: the empty first-commit asset map makes the formal render model throw', () => {
    // This is exactly what the overlay handed to `StageRenderer` on its first
    // commit (and again on every replay, because it remounts with fresh state).
    let thrown: unknown = null;
    try {
      buildStageRenderModel(project, evaluated, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StageAssetError);
    expect((thrown as StageAssetError).code).toBe('MISSING_ASSET_URL');
  });

  it('the readiness gate rejects exactly the states that would render 舞台无法渲染', () => {
    // Empty map — the state at mount and at every replay.
    expect(isPreviewSceneRenderable(evaluated, {})).toBe(false);

    // Partially resolved map: the background arrived, the selected character
    // did not. The render model still throws, so this must be rejected too.
    const partial: StageAssetUrlMap = {
      [IDS.assetBg]: 'data:image/png;base64,bg',
    };
    expect(isPreviewSceneRenderable(evaluated, partial)).toBe(false);
    expect(() => buildStageRenderModel(project, evaluated, partial)).toThrow(
      StageAssetError,
    );

    // A url present but empty is not loadable either.
    const blank: StageAssetUrlMap = Object.fromEntries(
      Object.keys(completeUrls(project)).map((id) => [id, '']),
    );
    expect(isPreviewSceneRenderable(evaluated, blank)).toBe(false);
  });

  it('the readiness gate accepts only a scene the formal render model can build', () => {
    const urls = completeUrls(project);
    expect(isPreviewSceneRenderable(evaluated, urls)).toBe(true);
    expect(() => buildStageRenderModel(project, evaluated, urls)).not.toThrow();
  });

  it('an empty shot is never previewed', () => {
    expect(
      isPreviewSceneRenderable(
        { shotId: shot.id, timeMs: 0, backgroundLayerId: null, layers: [] },
        completeUrls(project),
      ),
    ).toBe(false);
  });

  it('holds across the whole preview window, so replay cannot flash an error frame', () => {
    const urls = completeUrls(project);
    for (const timeMs of [0, 1, 200, 400, 799, 800]) {
      const frame = evaluateShotAtTime(shot, timeMs, project);
      expect(isPreviewSceneRenderable(frame, {})).toBe(false);
      expect(isPreviewSceneRenderable(frame, urls)).toBe(true);
      expect(() => buildStageRenderModel(project, frame, urls)).not.toThrow();
    }
  });

  it('the overlay refuses to mount the formal renderer before the scene is renderable', () => {
    const overlay = readSource(OVERLAY_PATH);
    expect(overlay).toContain('isPreviewSceneRenderable');
    // The gate must live in the early-return guard, i.e. before <CanvasStage>.
    const guardIndex = overlay.indexOf(
      '!isPreviewSceneRenderable(evaluatedShot, assetUrls)',
    );
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(overlay.indexOf('<CanvasStage'));
  });
});

describe('Issue #168 — the selected layer survives into the preview scene', () => {
  const project = buildProject();
  const shot = firstShot(project);
  const urls = completeUrls(project);

  it('every authored layer, including the selected one, is present in the preview render model', () => {
    const model = buildStageRenderModel(
      project,
      evaluateShotAtTime(shot, 0, project),
      urls,
    );
    const renderedIds = model.layers.map((layer) => layer.id);
    expect(renderedIds).toContain(IDS.layerChar);
    expect(renderedIds).toHaveLength(shot.layers.length);
    for (const layer of model.layers) {
      expect(layer.sourceUrl).toBeTruthy();
    }
  });

  it('a move event never removes the selected layer from the scene', () => {
    const moved: Shot = {
      ...shot,
      timelineEvents: [
        {
          id: '90000000-0000-4000-8000-000000000001',
          type: 'move',
          layerId: IDS.layerChar,
          startMs: 0,
          endMs: 800,
          from: { x: -300, y: 600 },
          to: { x: 500, y: 600 },
          easing: 'ease-in-out',
        },
      ],
    };
    for (const timeMs of [0, 400, 800]) {
      const model = buildStageRenderModel(
        project,
        evaluateShotAtTime(moved, timeMs, project),
        urls,
      );
      expect(model.layers.map((layer) => layer.id)).toContain(IDS.layerChar);
    }
  });
});

describe('Issue #168 — preview scene composition matches the editor contract', () => {
  const project = buildProject();
  const shot = firstShot(project);
  const urls = completeUrls(project);

  it('same layers, same order, same render contract as the editor base render path', () => {
    const editorModel = buildEditorStageRenderModel(project, shot);
    const previewModel = buildStageRenderModel(
      project,
      evaluateShotAtTime(shot, 0, project),
      urls,
    );

    expect(previewModel.layers.map((layer) => layer.id)).toEqual(
      editorModel.layers.map((entry) => entry.layer.id),
    );
    expect(previewModel.width).toBe(editorModel.width);
    expect(previewModel.height).toBe(editorModel.height);
    expect(previewModel.shotId).toBe(editorModel.shotId);

    // With no timeline events the evaluated frame must equal the authored
    // state, so both paths must produce identical render instructions.
    expect(previewModel.layers.map((layer) => layer.render)).toEqual(
      editorModel.layers.map((entry) => entry.render),
    );
  });
});

describe('Issue #168 B — the preview occupies the canvas viewport box', () => {
  it('is mounted inside the viewport, not as a sibling of the canvas panel', () => {
    const canvas = readSource(CANVAS_PATH);

    // Still mounted only while a session is active…
    expect(canvas).toMatch(
      /preview\.active\s*\?\s*\(\s*<EditorActionPreviewOverlay/u,
    );
    // …but now handed to the viewport instead of rendered next to it.
    expect(canvas).toContain('overlay={');
    expect(canvas).not.toMatch(
      /<\/CanvasViewport>\s*\{preview\.active\s*\?/u,
    );
  });

  it('the viewport renders the overlay outside the scaled logical stage', () => {
    const viewport = readSource(VIEWPORT_PATH);
    expect(viewport).toContain('overlay?: ReactNode');
    const contentEnd = viewport.indexOf('canvas-viewport-content');
    const logicalStage = viewport.indexOf('canvas-logical-stage');
    const overlaySlot = viewport.indexOf('{overlay}');
    expect(overlaySlot).toBeGreaterThan(-1);
    // The slot must come after the scaled stage markup, i.e. it is a sibling of
    // `.canvas-viewport-content` and is therefore not scaled a second time.
    expect(overlaySlot).toBeGreaterThan(contentEnd);
    expect(overlaySlot).toBeGreaterThan(logicalStage);
  });

  it('the preview stage fills the viewport instead of imposing its own 16:9 box', () => {
    const styles = readSource(STYLES_PATH);
    const rule = styles.slice(
      styles.indexOf('.editor-action-preview .stage-viewport'),
    );
    expect(rule.slice(0, 400)).toContain('height: 100%');
    expect(rule.slice(0, 400)).toContain('aspect-ratio: auto');
  });
});

describe('Issue #168 — the repair keeps the preview side-effect free', () => {
  it('the readiness gate is a pure predicate over an evaluated frame', () => {
    const project = buildProject();
    const shot = firstShot(project);
    const before = JSON.stringify(project);
    const evaluated = evaluateShotAtTime(shot, 0, project);

    isPreviewSceneRenderable(evaluated, {});
    isPreviewSceneRenderable(evaluated, completeUrls(project));

    expect(JSON.stringify(project)).toBe(before);
  });

  it('neither the overlay nor the viewport gained a write path', () => {
    const overlay = readSource(OVERLAY_PATH);
    const viewport = readSource(VIEWPORT_PATH);
    for (const forbidden of [
      'editorProjectStore',
      'selectionStore',
      'layerStore',
      'shotStore',
      'historyStore',
      'window.pandaStage.project',
      'window.pandaStage.autosave',
      'window.pandaStage.recovery',
    ]) {
      expect(overlay).not.toContain(forbidden);
      expect(viewport).not.toContain(forbidden);
    }
    // The overlay still reuses the formal evaluator and renderer.
    expect(overlay).toContain('evaluatePreviewFrame');
    expect(overlay).toContain("from '../../stage/CanvasStage'");
    expect(overlay).not.toContain('buildStageRenderModel(');
  });
});
