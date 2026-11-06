import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, ProjectSchema, SceneCreationService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  SceneCreationActionError,
  commitSceneCreationPreview,
  isSceneCreationPreviewCurrent,
  prepareSceneCreationPreview,
  toSceneCreationCanvasPreview,
} from '../../src/renderer/features/shots/createSceneFromStructuredInput';

function makePreviewProject() {
  const migrated = migrateProject(exampleProject);
  const backgroundId = migrated.assets.find((asset) => asset.kind === 'image')?.id;
  if (!backgroundId) throw new Error('Fixture must contain an image asset.');
  return ProjectSchema.parse({
    ...migrated,
    assets: migrated.assets.map((asset) =>
      asset.id === backgroundId && asset.kind === 'image'
        ? { ...asset, usage: 'background' }
        : asset,
    ),
    characters: migrated.characters.map((character) => {
      if (character.mode === 'adaptive-parts') {
        throw new Error('Fixture must use image-based Characters.');
      }
      return {
        ...character,
        mode: 'composite',
        bodyAssetId: character.baseAssetId,
        bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        facePlacement: {
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotationDeg: 0,
          flipX: false,
        },
        defaultExpressionId: character.expressions[0]?.id ?? '',
        defaultScale: 0.72,
        defaultFlipX: false,
        talkingHeadMotionIntensityPercent: 100,
      };
    }),
  });
}

function prepare(store: EditorProjectStore) {
  const snapshot = store.getSnapshot();
  if (!snapshot) throw new Error('Test project must be open.');
  const service = new SceneCreationService();
  const background = service
    .listBackgroundCandidates(snapshot.project)
    .find((candidate) => candidate.selectable)?.value;
  const character = service
    .listCharacterCandidates(snapshot.project)
    .find((candidate) => candidate.selectable)?.value;
  if (!background || !character) {
    throw new Error('Fixture must contain a usable background and character.');
  }
  const rawInput = [
    '镜头：临时主画布预览',
    `背景：${background.name}`,
    `出场：${character.name}`,
  ].join('\n');
  const plan = prepareSceneCreationPreview(
    rawInput,
    { backgroundAssetId: background.id, characterId: character.id },
    {
      editorStore: store,
      shotStore: { getCurrentShotId: () => null, select: vi.fn() },
      service,
    },
  );
  return { plan, rawInput, background, character };
}

describe('scene creation canvas preview', () => {
  it('builds a temporary canvas Shot without changing Project or History', () => {
    const store = new EditorProjectStore();
    const project = makePreviewProject();
    store.open('D:\\acceptance\\scene-preview.pandastage', project);
    const openedProject = store.getSnapshot()?.project;

    const { plan, background, character } = prepare(store);
    const preview = toSceneCreationCanvasPreview(plan);

    expect(preview.identity).toEqual(plan.identity);
    expect(preview.shot.id).toBe(plan.result.shotId);
    expect(preview.shot.layers).toHaveLength(2);
    expect(preview.shot.layers.some((layer) =>
      layer.source.kind === 'asset' && layer.source.assetId === background.id,
    )).toBe(true);
    expect(preview.shot.layers.some((layer) =>
      layer.source.kind === 'character' && layer.source.characterId === character.id,
    )).toBe(true);
    expect(store.getSnapshot()?.project).toBe(openedProject);
    expect(store.getSnapshot()?.revision).toBe(0);
    expect(store.getSnapshot()?.dirty).toBe(false);
    expect(store.history.getSnapshot().undoCount).toBe(0);
    expect(isSceneCreationPreviewCurrent(plan, store)).toBe(true);
    expect(store.getSnapshot()?.project.shots).not.toContainEqual(preview.shot);
  });

  it('rejects a preview after the Project revision or open instance changes', () => {
    const store = new EditorProjectStore();
    const project = makePreviewProject();
    const projectRoot = 'D:\\acceptance\\scene-preview-stale.pandastage';
    store.open(projectRoot, project);

    const { plan } = prepare(store);
    const revisionedProject = { ...project, name: '已修改的项目' };
    store.updateProject(revisionedProject, 'External edit');
    const historyAfterEdit = store.history.getSnapshot();

    expect(isSceneCreationPreviewCurrent(plan, store)).toBe(false);
    expect(() =>
      commitSceneCreationPreview(plan, {
        editorStore: store,
        shotStore: { getCurrentShotId: () => null, select: vi.fn() },
      }),
    ).toThrow(SceneCreationActionError);
    expect(store.getSnapshot()?.project.shots).toHaveLength(project.shots.length);
    expect(store.history.getSnapshot()).toEqual(historyAfterEdit);

    store.open(projectRoot, revisionedProject);
    expect(isSceneCreationPreviewCurrent(plan, store)).toBe(false);
  });
});
