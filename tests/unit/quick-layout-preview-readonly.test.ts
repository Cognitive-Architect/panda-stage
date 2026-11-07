import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Layer, type Project } from '../../src/domain';
import {
  buildEditorTemporalCanvasModel,
  canvasDirectEditingEnabled,
  NO_PREVIEW_LAYER_IDS,
} from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

const LEFT_LAYER = '60000000-0000-4000-8000-0000000000c1';
const RIGHT_LAYER = '60000000-0000-4000-8000-0000000000c2';

function characterLayer(id: string, name: string, zIndex: number): Layer {
  return {
    id,
    name,
    source: {
      kind: 'character',
      characterId: IDS.character,
      expressionId: IDS.expressionNormal,
    },
    anchor: 'center',
    x: 200,
    y: 300,
    scaleX: 0.5,
    scaleY: 0.5,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex,
    locked: false,
    flipX: false,
  };
}

function fixture(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const background = shot.layers.find((layer) => layer.id === IDS.layerBg)!;
  const prop = shot.layers.find((layer) => layer.id === IDS.layerAsset)!;
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        layers: [
          background,
          prop,
          characterLayer(LEFT_LAYER, '张三', 2),
          characterLayer(RIGHT_LAYER, '李四', 3),
        ],
      },
    ],
  });
}

const CANDIDATE_OVERRIDES = new Map<string, { x: number; y: number }>([
  [LEFT_LAYER, { x: 652.8, y: 833.6 }],
  [RIGHT_LAYER, { x: 1267.2, y: 913.6 }],
]);

function model(positionOverrides?: ReadonlyMap<string, { x: number; y: number }>) {
  const project = fixture();
  return buildEditorTemporalCanvasModel({
    project,
    shot: project.shots[0]!,
    currentTimeMs: 0,
    readyAssetIds: new Set(),
    previousVisuals: new Map(),
    ...(positionOverrides ? { positionOverrides } : {}),
  });
}

describe('AUTO-01 fix: Quick Layout preview stays read-only', () => {
  it('marks exactly the two preview Layers as read-only', () => {
    const withPreview = model(CANDIDATE_OVERRIDES);

    expect([...withPreview.previewReadOnlyLayerIds].sort()).toEqual(
      [LEFT_LAYER, RIGHT_LAYER].sort(),
    );
    expect(withPreview.previewReadOnlyLayerIds.has(IDS.layerAsset)).toBe(false);
    expect(withPreview.previewReadOnlyLayerIds.has(IDS.layerBg)).toBe(false);
  });

  it('allows drag and transform again as soon as the preview is gone', () => {
    const cleared = model();

    expect(cleared.previewReadOnlyLayerIds.size).toBe(0);
    expect(cleared.previewReadOnlyLayerIds).toBe(NO_PREVIEW_LAYER_IDS);
  });

  it('keeps both targets un-editable and leaves every other Layer untouched', () => {
    const { previewReadOnlyLayerIds } = model(CANDIDATE_OVERRIDES);
    const gate = (layerId: string, stageEnabled = true) =>
      canvasDirectEditingEnabled({
        layerId,
        previewReadOnlyLayerIds,
        stageEnabled,
      });

    expect(gate(LEFT_LAYER)).toBe(false);
    expect(gate(RIGHT_LAYER)).toBe(false);
    // A third, uninvolved Layer is not a Quick Layout target.
    expect(gate(IDS.layerAsset)).toBe(true);
    expect(gate(IDS.layerBg)).toBe(true);
    // Clearing the preview restores ordinary editing immediately.
    expect(
      canvasDirectEditingEnabled({
        layerId: LEFT_LAYER,
        previewReadOnlyLayerIds: NO_PREVIEW_LAYER_IDS,
        stageEnabled: true,
      }),
    ).toBe(true);
    // A read-only preview never overrides a stage that is already unwritable.
    expect(
      canvasDirectEditingEnabled({
        layerId: IDS.layerAsset,
        previewReadOnlyLayerIds,
        stageEnabled: false,
      }),
    ).toBe(false);
  });

  it('does not write a revision or a History entry while the preview shows', () => {
    const project = fixture();
    const editor = new EditorProjectStore();
    editor.open('D:/quick-layout-readonly.pandastage', project);
    const before = editor.getSnapshot()!;
    const built = buildEditorTemporalCanvasModel({
      project: before.project,
      shot: before.project.shots[0]!,
      currentTimeMs: 0,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      positionOverrides: CANDIDATE_OVERRIDES,
    });

    expect(built.previewReadOnlyLayerIds.size).toBe(2);
    expect(editor.getSnapshot()).toMatchObject({
      revision: before.revision,
      dirty: false,
      project: before.project,
    });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('routes the canvas edit gate through the preview read-only set', () => {
    const stage = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    ).replace(/\r\n/gu, '\n');

    expect(stage).toContain('canvasDirectEditingEnabled({');
    expect(stage).toContain('previewReadOnlyLayerIds,');
    expect(stage).toContain('data-preview-read-only-layer-ids');
    // The Transformer and the drag handler both consume the same gate.
    expect(stage).toContain('directEditingEnabledForStageLayer(selectedStageLayer)');
    expect(stage).toContain(
      'directEditingEnabled={directEditingEnabledForStageLayer(stageLayer)}',
    );
  });
});
