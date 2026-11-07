import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  ShotService,
  type Layer,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import {
  QuickLayoutPreviewStore,
  matchesQuickLayoutPreview,
} from '../../src/renderer/stores/quickLayoutPreviewStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const LEFT_LAYER = '60000000-0000-4000-8000-0000000000b1';
const RIGHT_LAYER = '60000000-0000-4000-8000-0000000000b2';
const OTHER_SHOT = '50000000-0000-4000-8000-0000000000b2';

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
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        layers: [
          background,
          characterLayer(LEFT_LAYER, '张三', 1),
          characterLayer(RIGHT_LAYER, '李四', 2),
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
  editor.open('D:/quick-layout-preview.pandastage', project);
  const shots = new ShotStore(editor, new ShotService());
  const preview = new QuickLayoutPreviewStore({
    editorStore: editor,
    shotSelection: shots,
  });
  return { editor, shots, preview };
}

const CANDIDATE = {
  leftLayerId: LEFT_LAYER,
  rightLayerId: RIGHT_LAYER,
  left: { x: 652.8, y: 833.6 },
  right: { x: 1267.2, y: 913.6 },
};

describe('AUTO-01 quick layout runtime preview', () => {
  it('publishes candidate positions without a Project or History write', () => {
    const { editor, preview } = harness();
    const before = editor.getSnapshot()!;

    expect(preview.show(CANDIDATE)).toBe(true);

    const shown = preview.getSnapshot()!;
    expect(shown).toMatchObject(CANDIDATE);
    expect(
      matchesQuickLayoutPreview(shown, {
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
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0 });
    preview.dispose();
  });

  it('drops the preview as soon as the formal Project revision moves', () => {
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

  it('drops the preview when the current Shot changes', () => {
    const { shots, preview } = harness();
    preview.show(CANDIDATE);
    expect(preview.getSnapshot()).not.toBeNull();

    shots.select(OTHER_SHOT);

    expect(preview.getSnapshot()).toBeNull();
    preview.dispose();
  });

  it('clears explicitly when the tool is left', () => {
    const { preview } = harness();
    preview.show(CANDIDATE);
    preview.clear();

    expect(preview.getSnapshot()).toBeNull();
    preview.dispose();
  });

  it('renders candidate positions through the canvas model without touching the Project', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const model = buildEditorTemporalCanvasModel({
      project,
      shot,
      currentTimeMs: 0,
      readyAssetIds: new Set(),
      previousVisuals: new Map(),
      positionOverrides: new Map([
        [LEFT_LAYER, CANDIDATE.left],
        [RIGHT_LAYER, CANDIDATE.right],
      ]),
    });

    const leftRender = model.stageModel.layers.find(
      ({ layer }) => layer.id === LEFT_LAYER,
    )!;
    expect(leftRender.render).toMatchObject(CANDIDATE.left);
    expect(
      model.evaluatedShot.layers.find((layer) => layer.id === LEFT_LAYER),
    ).toMatchObject(CANDIDATE.left);
    expect(
      model.evaluatedShot.layers.find((layer) => layer.id === RIGHT_LAYER),
    ).toMatchObject(CANDIDATE.right);
    expect(model.evaluatedShot.layers.find((layer) => layer.id === IDS.layerBg))
      .toMatchObject({ x: 960, y: 540 });
    expect(
      shot.layers.find((layer) => layer.id === LEFT_LAYER),
    ).toMatchObject({ x: 200, y: 300 });
  });
});
