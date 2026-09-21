import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LayerTransformController } from '../../src/renderer/features/properties/LayerTransformPanel';
import { LayerTransformPanel } from '../../src/renderer/features/properties/LayerTransformPanel';
import { evaluateShotAtTime } from '../../src/domain';
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

describe('Issue #578/#579 Live Scrub editor contract', () => {
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

  it('renders PK-05 ready and active states with Position-only controls', () => {
    const ready = renderToStaticMarkup(
      LayerTransformPanel({
        compact: true,
        controller: {
          ...temporalController(),
          positionAuthoringAvailable: true,
          positionHoldAvailable: true,
          startPositionAuthoring: () => undefined,
          createPositionHold: () => undefined,
        },
        showResetTransform: true,
      }),
    );
    expect(ready).toContain('我要调整位置');
    expect(ready).toContain('保持不动到这里');
    expect(ready).not.toContain('把人物拖到想要的位置');
    expect(ready).toMatch(
      /data-testid="layer-transform-x"[^>]*value="500"/u,
    );
    expect(ready).toMatch(
      /data-testid="layer-transform-x"[^>]*disabled=""/u,
    );

    const active = renderToStaticMarkup(
      LayerTransformPanel({
        compact: true,
        controller: {
          ...temporalController(),
          positionAuthoringActive: true,
        },
        showResetTransform: true,
      }),
    );
    expect(active).toContain('把人物拖到想要的位置');
    expect(active).not.toContain('我要调整位置');
    expect(active).not.toContain('保持不动到这里');
    expect(active).not.toContain('应用变换');
    expect(active).not.toMatch(
      /data-testid="layer-transform-x"[^>]*disabled=""/u,
    );
    expect(active).toMatch(
      /data-testid="layer-transform-scale"[\s\S]*disabled=""/u,
    );
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
                  from: { x: 1200, y: 600 },
                  to: { x: 1490, y: 600 },
                },
                {
                  id: '40000000-0000-4000-8000-000000000022',
                  type: 'scale' as const,
                  layerId: IDS.layerChar,
                  startMs: 0,
                  endMs: 3000,
                  easing: 'linear' as const,
                  from: { x: 1.5, y: 1.5 },
                  to: { x: 2, y: 2 },
                },
                {
                  id: '40000000-0000-4000-8000-000000000023',
                  type: 'expression' as const,
                  layerId: IDS.layerChar,
                  startMs: 0,
                  endMs: 3000,
                  expressionId: IDS.expressionAngry,
                },
                {
                  id: '40000000-0000-4000-8000-000000000024',
                  type: 'opacity' as const,
                  layerId: IDS.layerBg,
                  startMs: 0,
                  endMs: 3000,
                  easing: 'linear' as const,
                  from: 0,
                  to: 1,
                },
                {
                  id: '40000000-0000-4000-8000-000000000025',
                  type: 'visibility' as const,
                  layerId: IDS.layerAsset,
                  startMs: 0,
                  endMs: 3000,
                  visible: false,
                },
                {
                  id: '40000000-0000-4000-8000-000000000026',
                  type: 'flip' as const,
                  layerId: IDS.layerAsset,
                  startMs: 0,
                  endMs: 3000,
                  axis: 'horizontal' as const,
                  flipped: true,
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
    const runtimeAtZero = evaluateShotAtTime(shot, 0, before.project);
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

    const zeroBackground = atZero.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerBg,
    )!;
    const scrubBackground = atScrub.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerBg,
    )!;
    const zeroAsset = atZero.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerAsset,
    )!;
    const scrubAsset = atScrub.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerAsset,
    )!;

    expect(zeroLayer.render.x).toBe(500);
    expect(zeroLayer.render.scaleX).toBe(0.5);
    expect(zeroLayer.render.assetId).toBe(IDS.assetChar);
    expect(scrubLayer.render.x).toBe(1345);
    expect(scrubLayer.render.scaleX).toBe(1.75);
    expect(scrubLayer.render.assetId).toBe(IDS.assetChar2);
    expect(zeroBackground.render.opacity).toBe(1);
    expect(scrubBackground.render.opacity).toBe(0.5);
    expect(zeroAsset.render.visible).toBe(true);
    expect(zeroAsset.render.scaleX).toBe(1);
    expect(scrubAsset.render.visible).toBe(false);
    expect(scrubAsset.render.scaleX).toBe(-1);
    // Runtime Preview/Export semantics stay formal-evaluator based; only the
    // Editor seam intentionally chooses Base Edit View at 0ms.
    expect(runtimeAtZero.layers.find((layer) => layer.id === IDS.layerChar)?.x).toBe(1200);
    expect(runtimeAtZero.layers.find((layer) => layer.id === IDS.layerBg)?.opacity).toBe(0);
    expect(atZero.directEditingEnabled).toBe(true);
    expect(atZero.temporalInspection).toBe(false);
    expect(atScrub.directEditingEnabled).toBe(false);
    expect(atScrub.temporalInspection).toBe(true);

    const atReturnToZero = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: atScrub.lastValidVisuals,
      project: before.project,
      readyAssetIds,
      shot,
    });
    const returnedLayer = atReturnToZero.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;
    expect(returnedLayer.render.x).toBe(500);
    expect(returnedLayer.render.scaleX).toBe(0.5);
    expect(returnedLayer.render.assetId).toBe(IDS.assetChar);
    expect(atReturnToZero.lastValidVisuals.size).toBe(0);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editor.history.getSnapshot()).toEqual(historyBefore);
  });

  it('renders a Position draft as main Position plus Shake without baking Shake', () => {
    const baseProject = buildProject();
    const project = {
      ...baseProject,
      shots: baseProject.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              timelineEvents: [
                {
                  id: '40000000-0000-4000-8000-000000000031',
                  type: 'move' as const,
                  layerId: IDS.layerChar,
                  startMs: 0,
                  endMs: 2_000,
                  easing: 'linear' as const,
                  from: { x: 500, y: 600 },
                  to: { x: 700, y: 600 },
                },
                {
                  id: '40000000-0000-4000-8000-000000000032',
                  type: 'shake' as const,
                  layerId: IDS.layerChar,
                  startMs: 1_000,
                  endMs: 1_500,
                  amplitudeX: 20,
                  amplitudeY: 10,
                  frequencyHz: 1,
                },
              ],
            }
          : shot,
      ),
    };
    const shot = project.shots[0]!;
    const model = buildEditorTemporalCanvasModel({
      currentTimeMs: 1_250,
      previousVisuals: new Map(),
      positionDraft: {
        layerId: IDS.layerChar,
        position: { x: 900, y: 700 },
      },
      project,
      readyAssetIds: new Set([IDS.assetBg, IDS.assetChar, IDS.assetChar2]),
      shot,
    });
    const layer = model.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(layer.render.x).toBe(920);
    expect(layer.render.y).toBe(710);
    expect(model.positionAuthoringShakeOffset).toEqual({ x: 20, y: 10 });
    expect(project.shots[0]!.timelineEvents).toHaveLength(2);
    expect(model.directEditingEnabled).toBe(false);
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
      currentTimeMs: 333,
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
