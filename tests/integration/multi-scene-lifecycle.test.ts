import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  evaluateShotAtTime,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  commitMultiScenePreview,
  prepareMultiScenePreview,
} from '../../src/renderer/features/shots/multiScenePlan';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

const temporaryParents: string[] = [];

const IDS = {
  backgroundAsset: '10000000-0000-4000-8000-0000000000a1',
  leftBody: '10000000-0000-4000-8000-0000000000a2',
  leftFace: '10000000-0000-4000-8000-0000000000a3',
  rightBody: '10000000-0000-4000-8000-0000000000a4',
  rightFace: '10000000-0000-4000-8000-0000000000a5',
  leftCharacter: '20000000-0000-4000-8000-0000000000a1',
  leftExpression: '20000000-0000-4000-8000-0000000000a2',
  rightCharacter: '20000000-0000-4000-8000-0000000000a3',
  rightExpression: '20000000-0000-4000-8000-0000000000a4',
  leftVoice: '30000000-0000-4000-8000-0000000000a1',
  rightVoice: '30000000-0000-4000-8000-0000000000a2',
} as const;

const STORYBOARD = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '---',
  '镜头：宗门大厅',
  '背景：花园',
  '出场：李四、张三',
  '站位：双人对话',
  '---',
  '镜头：山门',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
].join('\n');

function imageAsset(id: string, name: string, usage: 'background' | 'uncategorized') {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `${name}.png`,
    mimeType: 'image/png',
    width: usage === 'background' ? 1920 : 640,
    height: usage === 'background' ? 1080 : 640,
    usage,
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

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-auto04-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, 'auto04.pandastage');
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function withCast(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      imageAsset(IDS.backgroundAsset, '花园', 'background'),
      imageAsset(IDS.leftBody, '张三身体', 'uncategorized'),
      imageAsset(IDS.leftFace, '张三表情', 'uncategorized'),
      imageAsset(IDS.rightBody, '李四身体', 'uncategorized'),
      imageAsset(IDS.rightFace, '李四表情', 'uncategorized'),
    ],
    characters: [
      ...project.characters,
      compositeCharacter(
        IDS.leftCharacter,
        '张三',
        IDS.leftBody,
        IDS.leftExpression,
        IDS.leftFace,
        IDS.leftVoice,
      ),
      compositeCharacter(
        IDS.rightCharacter,
        '李四',
        IDS.rightBody,
        IDS.rightExpression,
        IDS.rightFace,
        IDS.rightVoice,
      ),
    ],
    voiceProfiles: [
      ...project.voiceProfiles,
      {
        id: IDS.leftVoice,
        name: '张三配音',
        characterId: IDS.leftCharacter,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
      {
        id: IDS.rightVoice,
        name: '李四配音',
        characterId: IDS.rightCharacter,
        locale: 'zh-CN',
        rate: 1,
        pitch: 1,
      },
    ],
  });
}

describe('AUTO-04 batch lifecycle', () => {
  it('saves, reopens, and keeps the three generated Shots fully editable', async () => {
    const root = await projectRoot();
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2a40000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-11-07T06:00:00.000Z'),
    });
    const created = await projectService.create(root, {
      name: 'AUTO-04 三镜头',
    });
    const cast = withCast(created.project);

    const editorStore = new EditorProjectStore();
    const shotStore = new ShotStore(editorStore, new ShotService());
    editorStore.open(root, cast);

    const prepared = prepareMultiScenePreview(
      parseMultiSceneInput(STORYBOARD),
      [],
      { editorStore, shotStore },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const committed = commitMultiScenePreview(prepared.preview, {
      editorStore,
      shotStore,
    });

    await projectService.save(
      root,
      editorStore.getSnapshot()!.project,
      1,
    );
    const reopened = await projectService.open(root);

    const generated = reopened.project.shots.filter((shot) =>
      committed.createdShotIds.includes(shot.id),
    );
    expect(generated.map((shot) => shot.name)).toEqual([
      '花园相遇',
      '宗门大厅',
      '山门',
    ]);
    for (const shot of generated) {
      expect(shot.layers).toHaveLength(3);
      expect(shot.backgroundLayerId).not.toBeNull();
      expect(shot.dialogues).toEqual([]);
      expect(shot.audioClips).toEqual([]);
      const characterLayers = shot.layers.filter(
        (layer) => layer.source.kind === 'character',
      );
      expect(characterLayers).toHaveLength(2);
      // Ordinary editable Layers: unlocked, unrotated, unscaled, unflipped.
      expect(characterLayers.every((layer) => !layer.locked)).toBe(true);
      expect(characterLayers.every((layer) => layer.rotationDeg === 0)).toBe(true);
      expect(characterLayers.every((layer) => layer.scaleX === 1)).toBe(true);
      expect(characterLayers.every((layer) => layer.flipX === false)).toBe(true);
      // The render pipeline still resolves every generated Shot.
      const evaluated = evaluateShotAtTime(shot, 0, reopened.project);
      expect(evaluated.layers).toHaveLength(3);
    }
  });
});
