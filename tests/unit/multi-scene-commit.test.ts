import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  commitMultiScenePreview,
  MULTI_SCENE_HISTORY_LABEL,
  MultiSceneActionError,
  prepareMultiScenePreview,
} from '../../src/renderer/features/shots/multiScenePlan';
import { buildProject, IDS } from './domain/testProject';

const CAST_IDS = {
  characterLeft: '20000000-0000-4000-8000-000000000011',
  expressionLeftNormal: '20000000-0000-4000-8000-000000000012',
  characterRight: '20000000-0000-4000-8000-000000000021',
  expressionRightNormal: '20000000-0000-4000-8000-000000000022',
  voiceLeft: '30000000-0000-4000-8000-000000000011',
  voiceRight: '30000000-0000-4000-8000-000000000021',
  assetLeftBody: '10000000-0000-4000-8000-000000000011',
  assetLeftFace: '10000000-0000-4000-8000-000000000012',
  assetRightBody: '10000000-0000-4000-8000-000000000021',
  assetRightFace: '10000000-0000-4000-8000-000000000022',
} as const;

function imageAsset(id: string, name: string) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `${name}.png`,
    mimeType: 'image/png',
    width: 640,
    height: 640,
    usage: 'uncategorized' as const,
    keywords: [],
  };
}

function compositeCharacter(
  id: string,
  name: string,
  bodyAssetId: string,
  expressionId: string,
  expressionAssetId: string,
  voiceProfileId: string,
) {
  return {
    id,
    mode: 'composite' as const,
    name,
    baseAssetId: expressionAssetId,
    defaultVoiceProfileId: voiceProfileId,
    expressions: [
      { id: expressionId, name: '正常', assetId: expressionAssetId },
    ],
    defaultExpressionId: expressionId,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId,
    facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
  };
}

function castProject(): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets.map((asset) =>
        asset.id === IDS.assetBg
          ? { ...asset, name: '花园', usage: 'background' as const }
          : asset,
      ),
      imageAsset(CAST_IDS.assetLeftBody, '张三身体'),
      imageAsset(CAST_IDS.assetLeftFace, '张三表情'),
      imageAsset(CAST_IDS.assetRightBody, '李四身体'),
      imageAsset(CAST_IDS.assetRightFace, '李四表情'),
    ],
    characters: [
      {
        ...base.characters[0]!,
        mode: 'composite' as const,
        bodyAssetId: IDS.assetChar,
        facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
      },
      compositeCharacter(
        CAST_IDS.characterLeft,
        '张三',
        CAST_IDS.assetLeftBody,
        CAST_IDS.expressionLeftNormal,
        CAST_IDS.assetLeftFace,
        CAST_IDS.voiceLeft,
      ),
      compositeCharacter(
        CAST_IDS.characterRight,
        '李四',
        CAST_IDS.assetRightBody,
        CAST_IDS.expressionRightNormal,
        CAST_IDS.assetRightFace,
        CAST_IDS.voiceRight,
      ),
    ],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        id: CAST_IDS.voiceLeft,
        name: '张三配音',
        characterId: CAST_IDS.characterLeft,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
      {
        id: CAST_IDS.voiceRight,
        name: '李四配音',
        characterId: CAST_IDS.characterRight,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
    ],
  });
}

const THREE_BLOCKS = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：先走一遍。',
  '李四：好。',
  '---',
  '镜头：宗门大厅',
  '背景：花园',
  '出场：李四、张三',
  '站位：双人对话',
  '对白：',
  '张三：先走一遍。',
  '李四：好。',
  '---',
  '镜头：山门',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：先走一遍。',
  '李四：好。',
].join('\n');

function harness() {
  const editorStore = new EditorProjectStore();
  const shotStore = new ShotStore(editorStore, new ShotService());
  const project = castProject();
  editorStore.open('D:\\auto04.pandastage', project);
  return { editorStore, shotStore, project };
}

describe('AUTO-04 batch commit', () => {
  it('writes three Shots as one revision and one History entry', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);

    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // Preparing is runtime-only: no revision, no History, no dirty flag.
    expect(editorStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);

    const committed = commitMultiScenePreview(prepared.preview, {
      editorStore,
      shotStore,
    });

    expect(editorStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: MULTI_SCENE_HISTORY_LABEL,
    });
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length + 3,
    );
    expect(committed.createdShotIds).toHaveLength(3);
    expect(shotStore.getCurrentShotId()).toBe(committed.createdShotIds.at(-1));
  });

  it('removes the whole batch on one Undo and restores it on one Redo', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    if (!prepared.ok) throw new Error('expected a plan');
    const committed = commitMultiScenePreview(prepared.preview, {
      editorStore,
      shotStore,
    });

    editorStore.undo();
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length,
    );
    expect(shotStore.getCurrentShotId()).toBe(project.shots[0]!.id);

    editorStore.redo();
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length + 3,
    );
    expect(shotStore.getCurrentShotId()).toBe(committed.createdShotIds.at(-1));
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('refuses a stale plan after the Project changed', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    if (!prepared.ok) throw new Error('expected a plan');

    editorStore.updateProject({ ...project, name: 'Edited meanwhile' });

    expect(() =>
      commitMultiScenePreview(prepared.preview, { editorStore, shotStore }),
    ).toThrow(MultiSceneActionError);
    expect(editorStore.getSnapshot()!.project.name).toBe('Edited meanwhile');
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length,
    );
  });

  it('refuses a stale plan after Undo/Redo', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    if (!prepared.ok) throw new Error('expected a plan');

    editorStore.updateProject({ ...project, name: 'First edit' });
    editorStore.undo();
    editorStore.redo();

    expect(() =>
      commitMultiScenePreview(prepared.preview, { editorStore, shotStore }),
    ).toThrow(MultiSceneActionError);
  });

  it('cannot generate a second batch from the same confirmation', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    if (!prepared.ok) throw new Error('expected a plan');
    commitMultiScenePreview(prepared.preview, { editorStore, shotStore });

    expect(() =>
      commitMultiScenePreview(prepared.preview, { editorStore, shotStore }),
    ).toThrow(MultiSceneActionError);
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length + 3,
    );
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('writes nothing when the plan itself fails', () => {
    const editorStore = new EditorProjectStore();
    const shotStore = new ShotStore(editorStore, new ShotService());
    const project = castProject();
    const unusable = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === IDS.assetBg ? { ...asset, usage: 'uncategorized' } : asset,
      ),
    });
    editorStore.open('D:////auto04.pandastage', unusable);

    const prepared = prepareMultiScenePreview(
      parseMultiSceneInput(THREE_BLOCKS),
      [],
      { editorStore, shotStore },
    );
    expect(prepared.ok).toBe(false);
    expect(editorStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(editorStore.getSnapshot()!.project.shots).toHaveLength(
      project.shots.length,
    );
  });

  it('keeps generated Shots as ordinary editable Shots', () => {
    const { editorStore, shotStore, project } = harness();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const prepared = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
    if (!prepared.ok) throw new Error('expected a plan');
    const committed = commitMultiScenePreview(prepared.preview, {
      editorStore,
      shotStore,
    });

    const next = editorStore.getSnapshot()!.project;
    const json = JSON.stringify(next);
    expect(JSON.parse(json).schemaVersion).toBe(project.schemaVersion);
    for (const planned of committed.shots) {
      const shot = next.shots.find((candidate) => candidate.id === planned.shotId);
      expect(shot).toBeDefined();
      // Plain Shot shape: no auto-generation marker is persisted anywhere.
      expect(Object.keys(shot!).sort()).toEqual(
        Object.keys(project.shots[0]!).sort(),
      );
      // Only the background Layer is locked, exactly like a hand-built Shot.
      expect(shot!.layers.every((layer) => layer.locked === (layer.id === shot!.backgroundLayerId))).toBe(true);
    }
  });
});
