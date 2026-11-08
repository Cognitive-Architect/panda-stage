import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  ShotService,
  type Layer,
  type Project,
} from '../../src/domain';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  LayerLayoutPreviewStore,
  matchesLayerLayoutPreview,
  type LayerLayoutPreviewTransform,
} from '../../src/renderer/stores/layerLayoutPreviewStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const LAYER_A = '60000000-0000-4000-8000-0000000000c1';
const LAYER_B = '60000000-0000-4000-8000-0000000000c2';
const OTHER_SHOT = '50000000-0000-4000-8000-0000000000c2';

function characterLayer(
  id: string,
  name: string,
  scale: number,
  zIndex: number,
): Layer {
  return {
    id,
    name,
    source: {
      kind: 'character',
      characterId: IDS.character,
      expressionId: IDS.expressionNormal,
    },
    anchor: 'center',
    x: 400,
    y: 400,
    scaleX: scale,
    scaleY: scale,
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
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        layers: [
          background,
          characterLayer(LAYER_A, '张三', 0.4, 1),
          characterLayer(LAYER_B, '李四', 0.25, 2),
        ],
      },
      {
        ...shot,
        id: OTHER_SHOT,
        name: '镜头二',
        layers: [background],
      },
    ],
  });
}

function harness(project: Project = fixture()) {
  const editor = new EditorProjectStore();
  editor.open('D:/layer-align-preview.pandastage', project);
  const shots = new ShotStore(editor, new ShotService());
  const preview = new LayerLayoutPreviewStore({
    editorStore: editor,
    shotSelection: shots,
  });
  return { editor, shots, preview };
}

const CANDIDATE = new Map<string, LayerLayoutPreviewTransform>([
  [LAYER_A, { x: 400, y: 400, scaleX: 0.4, scaleY: 0.4 }],
  [LAYER_B, { x: 400, y: 400, scaleX: 0.4, scaleY: 0.4 }],
]);

describe('EF-02 align/distribute runtime preview', () => {
  it('publishes candidates without a Project, dirty, revision or History write', () => {
    const { editor, preview } = harness();
    const before = editor.getSnapshot()!;

    expect(preview.show(CANDIDATE)).toBe(true);

    const shown = preview.getSnapshot()!;
    expect(shown.transforms).toBe(CANDIDATE);
    expect(
      matchesLayerLayoutPreview(shown, {
        projectInstanceId: editor.getProjectInstanceId()!,
        projectId: before.project.id,
        projectRoot: before.projectRoot,
        revision: before.revision,
        shotId: before.project.shots[0]!.id,
      }),
    ).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({
      revision: before.revision,
      dirty: false,
      project: before.project,
    });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    preview.dispose();
  });

  it('drops the candidates as soon as the formal revision moves', () => {
    const { editor, preview } = harness();
    preview.show(CANDIDATE);
    expect(preview.getSnapshot()).not.toBeNull();

    const current = editor.getSnapshot()!;
    editor.updateProject(
      ProjectSchema.parse({ ...current.project, name: '改名' }),
      'Rename project',
    );

    expect(preview.getSnapshot()).toBeNull();
    preview.dispose();
  });

  it('drops the candidates when the current Shot changes', () => {
    const { shots, preview } = harness();
    preview.show(CANDIDATE);

    shots.select(OTHER_SHOT);

    expect(preview.getSnapshot()).toBeNull();
    preview.dispose();
  });

  it('clears explicitly when the tool is left, and rejects empty or invalid input', () => {
    const { preview } = harness();
    preview.show(CANDIDATE);
    preview.clear();
    expect(preview.getSnapshot()).toBeNull();

    expect(preview.show(new Map())).toBe(false);
    expect(
      preview.show(
        new Map([[LAYER_A, { x: Number.NaN, y: 0 }]]),
      ),
    ).toBe(false);
    expect(
      preview.show(new Map([[LAYER_A, { x: 0, y: 0, scaleX: 0 }]])),
    ).toBe(false);
    expect(preview.getSnapshot()).toBeNull();
    preview.dispose();
  });

  it('renders the equal-height candidate size through the shared canvas model', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const model = buildEditorTemporalCanvasModel({
      project,
      shot,
      currentTimeMs: 0,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      positionOverrides: CANDIDATE,
    });

    const a = model.stageModel.layers.find(({ layer }) => layer.id === LAYER_A)!;
    const b = model.stageModel.layers.find(({ layer }) => layer.id === LAYER_B)!;
    // The formal Layer values are untouched …
    expect(b.layer).toMatchObject({ x: 400, y: 400, scaleX: 0.25, scaleY: 0.25 });
    // … while the render instruction carries the candidate size and position.
    expect(b.render).toMatchObject({ x: 400, y: 400, scaleX: 0.4, scaleY: 0.4 });
    expect(a.render).toMatchObject({ scaleX: 0.4, scaleY: 0.4 });
    // A preview Layer is read-only; an uninvolved Layer keeps editing.
    expect([...model.previewReadOnlyLayerIds].sort()).toEqual(
      [LAYER_A, LAYER_B].sort(),
    );
    expect(model.previewReadOnlyLayerIds.has(IDS.layerBg)).toBe(false);
  });
});
