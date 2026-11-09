import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  inspectMultiScene,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  commitMultiScenePreview,
  prepareMultiScenePreview,
} from '../../src/renderer/features/shots/multiScenePlan';
import {
  batchUpdated,
  checkApplied,
  initialPanelState,
  inputChanged,
  submissionBatch,
  type MultiSceneBatch,
  type MultiScenePanelState,
} from '../../src/renderer/features/shots/multiScenePanelModel';
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

const STORYBOARD_A = [
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
].join('\n');

const STORYBOARD_B = [
  '镜头：山门',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：先走一遍。',
  '李四：好。',
  '---',
  '镜头：后山',
  '背景：花园',
  '出场：李四、张三',
  '站位：双人对话',
  '对白：',
  '张三：先走一遍。',
  '李四：好。',
].join('\n');

interface Harness {
  editorStore: EditorProjectStore;
  shotStore: ShotStore;
  project: Project;
}

function harness(): Harness {
  const editorStore = new EditorProjectStore();
  const shotStore = new ShotStore(editorStore, new ShotService());
  const project = castProject();
  editorStore.open('D:\\auto04-fix.pandastage', project);
  return { editorStore, shotStore, project };
}

/**
 * Mirrors what the panel's buildBatch does, so the sequence under test is the
 * same one the author walks through.
 */
function checkStoryboard(
  { editorStore, shotStore }: Harness,
  rawInput: string,
): { state: MultiScenePanelState; batch: MultiSceneBatch } {
  const blocks = parseMultiSceneInput(rawInput);
  const outcome = prepareMultiScenePreview(blocks, [], { editorStore, shotStore });
  if (!outcome.ok) throw new Error(`expected a plan: ${outcome.message}`);
  const batch: MultiSceneBatch = {
    blocks,
    selections: [],
    report: inspectMultiScene(editorStore.getSnapshot()!.project, blocks, []),
    preview: outcome.preview,
    status: '',
  };
  return { state: checkApplied(rawInput, batch), batch };
}

describe('AUTO-04-FIX-01 panel batch lifecycle', () => {
  it('offers nothing to submit before the storyboard is checked', () => {
    expect(submissionBatch(initialPanelState())).toBeNull();
    expect(submissionBatch(inputChanged(STORYBOARD_A))).toBeNull();
  });

  it('turns a checked storyboard into a submittable preview', () => {
    const context = harness();
    const { state, batch } = checkStoryboard(context, STORYBOARD_A);

    expect(state.checkedInput).toBe(STORYBOARD_A);
    expect(batch.report?.ready).toBe(true);
    expect(batch.blocks).toHaveLength(2);
    expect(submissionBatch(state)).toBe(batch);

    // Checking is runtime only: no revision, no History, no Project edit.
    expect(context.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(context.editorStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('drops the whole batch the moment the storyboard changes', () => {
    const context = harness();
    const checked = checkStoryboard(context, STORYBOARD_A).state;
    const edited = inputChanged(STORYBOARD_B);

    // The old preview, blocks, report, selections and status are all gone.
    expect(edited.rawInput).toBe(STORYBOARD_B);
    expect(edited.checkedInput).toBeNull();
    expect(edited.batch).toEqual({
      blocks: [],
      selections: [],
      report: null,
      preview: null,
      status: '',
    });
    expect(submissionBatch(edited)).toBeNull();

    // Editing is not a Project edit either.
    const snapshot = context.editorStore.getSnapshot();
    expect(snapshot).toMatchObject({ revision: 0, dirty: false });
    expect(context.editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(snapshot!.project.shots).toHaveLength(context.project.shots.length);
    expect(checked.batch.preview).not.toBeNull();
  });

  it('refuses a stale preview that survived the edit', () => {
    const context = harness();
    const { batch } = checkStoryboard(context, STORYBOARD_A);

    // Worse case: the old batch object is still around but the text moved on.
    const stale = batchUpdated(inputChanged(STORYBOARD_B), batch);
    expect(stale.batch.preview).not.toBeNull();
    expect(submissionBatch(stale)).toBeNull();
  });

  it('keeps a candidate pick submittable without a re-check', () => {
    const context = harness();
    const { state, batch } = checkStoryboard(context, STORYBOARD_A);
    const repicked = batchUpdated(state, { ...batch, preview: batch.preview });

    // A pick re-resolves the same checked text, so it must stay submittable.
    expect(repicked.checkedInput).toBe(STORYBOARD_A);
    expect(submissionBatch(repicked)).not.toBeNull();
  });

  it('generates the re-checked storyboard, never the abandoned one', () => {
    const context = harness();
    checkStoryboard(context, STORYBOARD_A);
    const rechecked = checkStoryboard(context, STORYBOARD_B).state;

    const pending = submissionBatch(rechecked);
    expect(pending).not.toBeNull();
    const committed = commitMultiScenePreview(pending!.preview!, {
      editorStore: context.editorStore,
      shotStore: context.shotStore,
    });

    const names = committed.createdShotIds.map(
      (shotId) =>
        context.editorStore
          .getSnapshot()!
          .project.shots.find((shot) => shot.id === shotId)!.name,
    );
    expect(names).toEqual(['山门', '后山']);
    expect(
      context.editorStore
        .getSnapshot()!
        .project.shots.some((shot) => shot.name === '宗门大厅'),
    ).toBe(false);
    expect(context.editorStore.history.getSnapshot().undoCount).toBe(1);
  });
});
