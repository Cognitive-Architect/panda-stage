import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LayerTransformController } from '../../src/renderer/features/properties/LayerTransformPanel';
import { LayerTransformPanel } from '../../src/renderer/features/properties/LayerTransformPanel';
import {
  isLayerTransformEditableAtTime,
  runLayerTransformMutation,
  TEMPORAL_TRANSFORM_STATUS,
} from '../../src/renderer/features/properties/layerTransformTemporalGuard';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

function temporalController(): LayerTransformController {
  const project = buildProject();
  const layer = project.shots[0]!.layers.find(
    (candidate) => candidate.id === IDS.layerChar,
  )!;
  return {
    layer,
    isBackgroundLayer: false,
    selectedLayerId: layer.id,
    draft: {
      x: String(layer.x),
      y: String(layer.y),
      scale: String(layer.scaleX),
      rotationDeg: String(layer.rotationDeg),
      opacity: String(layer.opacity),
    },
    scalePercentDraft: '50',
    formRef: { current: null },
    status: '时间轴预览中 · 回到 0:00 可调整图层',
    temporalInspection: true,
    setStatus: () => undefined,
    updateDraft: () => undefined,
    updateScalePercentDraft: () => undefined,
    updateOpacityPercentDraft: () => undefined,
    commitPendingDraft: () => 'temporal-preview',
    resetTransform: () => undefined,
    adjustScale: () => undefined,
    adjustRotation: () => undefined,
    toggleFlip: () => undefined,
  };
}

describe('Issue #578 Live Scrub follow-up', () => {
  it('keeps Inspector presentation read-only during temporal inspection and editable at zero', () => {
    const temporal = renderToStaticMarkup(
      LayerTransformPanel({
        compact: true,
        controller: temporalController(),
        showResetTransform: true,
      }),
    );
    expect(temporal).toContain('data-temporal-inspection="true"');
    expect(temporal.split(TEMPORAL_TRANSFORM_STATUS).length - 1).toBe(1);
    expect(temporal).not.toContain('data-testid="layer-transform-guidance"');
    expect((temporal.match(/disabled=""/gu) ?? []).length).toBe(11);

    const zeroController = {
      ...temporalController(),
      temporalInspection: false,
      status: '',
    };
    const zero = renderToStaticMarkup(
      LayerTransformPanel({
        compact: true,
        controller: zeroController,
        showResetTransform: true,
      }),
    );
    expect(zero).toContain('data-temporal-inspection="false"');
    expect(zero).not.toContain('disabled=""');
  });

  it('re-checks the live playhead before every guarded mutation, including a blur race', () => {
    let currentTimeMs = 0;
    let writes = 0;
    let blocked = 0;
    const reject = (): void => {
      blocked += 1;
    };

    expect(isLayerTransformEditableAtTime(0)).toBe(true);
    expect(isLayerTransformEditableAtTime(333)).toBe(false);
    expect(
      runLayerTransformMutation(
        () => currentTimeMs,
        reject,
        () => {
          writes += 1;
        },
      ),
    ).toBe(true);
    expect(writes).toBe(1);

    // Draft was created at zero, then the user scrubbed before blur.
    currentTimeMs = 333;
    expect(
      runLayerTransformMutation(
        () => currentTimeMs,
        reject,
        () => {
          writes += 1;
        },
      ),
    ).toBe(false);
    expect(writes).toBe(1);
    expect(blocked).toBe(1);
  });

  it('proves the production Timeline → Canvas seam changes only evaluated visuals', () => {
    const baseProject = buildProject();
    const project = {
      ...baseProject,
      shots: baseProject.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              timelineEvents: [
                {
                  id: '40000000-0000-4000-8000-000000000021',
                  type: 'move' as const,
                  layerId: IDS.layerChar,
                  startMs: 0,
                  endMs: 3000,
                  easing: 'linear' as const,
                  from: { x: 500, y: 600 },
                  to: { x: 1490, y: 600 },
                },
              ],
            }
          : shot,
      ),
    };
    const shot = project.shots[0]!;
    const readyAssetIds = new Set([
      IDS.assetBg,
      IDS.assetChar,
      IDS.assetChar2,
    ]);
    const editor = new EditorProjectStore();
    editor.open('D:\\issue-578.pandastage', project);
    const before = editor.getSnapshot()!;
    const historyBefore = editor.history.getSnapshot();

    const atZero = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: new Map(),
      project: before.project,
      readyAssetIds,
      shot,
    });
    const atScrub = buildEditorTemporalCanvasModel({
      currentTimeMs: 1500,
      previousVisuals: atZero.lastValidVisuals,
      project: before.project,
      readyAssetIds,
      shot,
    });
    const zeroLayer = atZero.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;
    const scrubLayer = atScrub.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(zeroLayer.render.x).toBe(500);
    expect(scrubLayer.render.x).toBe(995);
    expect(atZero.directEditingEnabled).toBe(true);
    expect(atZero.temporalInspection).toBe(false);
    expect(atScrub.directEditingEnabled).toBe(false);
    expect(atScrub.temporalInspection).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editor.history.getSnapshot()).toEqual(historyBefore);
  });

  it('drops the previous visual map when Canvas changes Shot context', () => {
    const baseProject = buildProject();
    const firstShot = baseProject.shots[0]!;
    const secondShot = {
      ...firstShot,
      id: '50000000-0000-4000-8000-000000000002',
      layers: firstShot.layers.map((layer) =>
        layer.id === IDS.layerChar ? { ...layer, x: 1200 } : layer,
      ),
    };
    const first = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: new Map(),
      project: baseProject,
      readyAssetIds: new Set([IDS.assetBg, IDS.assetChar]),
      shot: firstShot,
    });
    const second = buildEditorTemporalCanvasModel({
      currentTimeMs: 333,
      // CanvasStage supplies a fresh map when its context key changes.
      previousVisuals: new Map(),
      project: baseProject,
      readyAssetIds: new Set([IDS.assetBg, IDS.assetChar]),
      shot: secondShot,
    });
    const secondLayer = second.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(first.lastValidVisuals.get(IDS.layerChar)?.x).toBe(500);
    expect(secondLayer.render.x).toBe(1200);
    expect(secondLayer.render.x).not.toBe(first.lastValidVisuals.get(IDS.layerChar)?.x);
  });
});
