import { describe, expect, it } from 'vitest';
import {
  MULTI_SCENE_SHOT_DURATION_MS,
  MultiSceneInputError,
  MultiSceneService,
  ProjectSchema,
  inspectMultiScene,
  parseMultiSceneInput,
  quickLayoutVisualRect,
  QUICK_LAYOUT_GROUND_Y,
  QUICK_LAYOUT_LEFT_X,
  QUICK_LAYOUT_RIGHT_X,
  type Project,
} from '../../src/domain';
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
  assetDuplicateBg: '10000000-0000-4000-8000-000000000031',
  assetHugeBody: '10000000-0000-4000-8000-000000000041',
} as const;

function imageAsset(
  id: string,
  name: string,
  size: { width: number; height: number } = { width: 640, height: 640 },
  usage: 'background' | 'uncategorized' = 'uncategorized',
) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `${name}.png`,
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
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
    expressions: [{ id: expressionId, name: '正常', assetId: expressionAssetId }],
    defaultExpressionId: expressionId,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId,
    facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
  };
}

/**
 * A Project that can satisfy the AUTO-04 contract: two castable composite
 * Characters plus a usable background asset.
 */
function castProject(
  options: { backgroundName?: string; bodySize?: { width: number; height: number } } = {},
): Project {
  const base = buildProject();
  const bodySize = options.bodySize ?? { width: 640, height: 640 };
  // The base fixture's own Layer keeps referencing its Character and assets, so
  // this fixture extends rather than replaces them.
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets.map((asset) =>
        asset.id === IDS.assetBg
          ? {
              ...asset,
              name: options.backgroundName ?? '花园',
              usage: 'background' as const,
            }
          : asset,
      ),
      imageAsset(CAST_IDS.assetLeftBody, '张三身体', bodySize),
      imageAsset(CAST_IDS.assetLeftFace, '张三表情'),
      imageAsset(CAST_IDS.assetRightBody, '李四身体', bodySize),
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

const TWO_BLOCKS = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '---',
  '镜头：宗门大厅',
  '背景：花园',
  '出场：李四、张三',
  '站位：双人对话',
].join('\n');

const THREE_BLOCKS = [
  TWO_BLOCKS,
  '---',
  '镜头：山门',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
].join('\n');

describe('AUTO-04 strict storyboard parser', () => {
  it('parses two and three explicit blocks', () => {
    const two = parseMultiSceneInput(TWO_BLOCKS);
    expect(two).toHaveLength(2);
    expect(two[0]).toEqual({
      index: 1,
      shotName: '花园相遇',
      backgroundName: '花园',
      cast: ['张三', '李四'],
      stance: '双人对话',
    });

    const three = parseMultiSceneInput(THREE_BLOCKS);
    expect(three.map((block) => block.shotName)).toEqual([
      '花园相遇',
      '宗门大厅',
      '山门',
    ]);
  });

  it('accepts ASCII colons and English commas with surrounding whitespace', () => {
    const parsed = parseMultiSceneInput(
      [
        '镜头: 花园相遇',
        '背景: 花园',
        '出场: 张三 , 李四',
        '站位: 双人对话',
        '---',
        '镜头：宗门大厅',
        '背景：花园',
        '出场：李四、张三',
        '站位：双人对话',
      ].join('\n'),
    );
    expect(parsed[0]!.cast).toEqual(['张三', '李四']);
  });

  const rejections: readonly [string, string, string][] = [
    [
      'a single block',
      'BLOCK_COUNT_OUT_OF_RANGE',
      ['镜头：花园相遇', '背景：花园', '出场：张三、李四', '站位：双人对话'].join('\n'),
    ],
    [
      'four blocks',
      'BLOCK_COUNT_OUT_OF_RANGE',
      [THREE_BLOCKS, '---', '镜头：四', '背景：花园', '出场：张三、李四', '站位：双人对话'].join('\n'),
    ],
    [
      'a missing field',
      'MISSING_FIELD',
      [TWO_BLOCKS.split('---')[0]!.replace('背景：花园', ''), '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'a duplicate field',
      'DUPLICATE_FIELD',
      [TWO_BLOCKS.split('---')[0]!, '背景：花园', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'an unknown field',
      'UNKNOWN_FIELD',
      [TWO_BLOCKS.split('---')[0]!, '时长：3', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'an empty field',
      'EMPTY_FIELD',
      ['镜头：花园相遇', '背景：', '出场：张三、李四', '站位：双人对话', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'a cast of one',
      'INVALID_CAST_COUNT',
      ['镜头：花园相遇', '背景：花园', '出场：张三', '站位：双人对话', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'a cast of three',
      'INVALID_CAST_COUNT',
      ['镜头：花园相遇', '背景：花园', '出场：张三、李四、王五', '站位：双人对话', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'the same Character twice in one shot',
      'SAME_CHARACTER',
      ['镜头：花园相遇', '背景：花园', '出场：张三、张三', '站位：双人对话', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'a duplicate shot name inside the batch',
      'DUPLICATE_SHOT_NAME',
      ['镜头：花园相遇', '背景：花园', '出场：张三、李四', '站位：双人对话', '---', '镜头：花园相遇', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
    [
      'an unsupported stance',
      'INVALID_STANCE',
      ['镜头：花园相遇', '背景：花园', '出场：张三、李四', '站位：三人对话', '---', '镜头：宗门大厅', '背景：花园', '出场：李四、张三', '站位：双人对话'].join('\n'),
    ],
  ];

  for (const [label, code, input] of rejections) {
    it(`rejects ${label}`, () => {
      try {
        parseMultiSceneInput(input);
        throw new Error('expected a parser refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(MultiSceneInputError);
        expect((error as MultiSceneInputError).code).toBe(code);
      }
    });
  }
});

describe('AUTO-04 exact-name resolution', () => {
  const blocks = parseMultiSceneInput(TWO_BLOCKS);

  it('marks every slot ready when each name is unique', () => {
    const report = inspectMultiScene(castProject(), blocks);
    expect(report.ready).toBe(true);
    expect(report.blocks.every((block) => block.ready)).toBe(true);
    // Block 1 casts 张三、李四; block 2 casts 李四、张三 on purpose.
    expect(report.blocks[0]!.background.selectedId).toBe(IDS.assetBg);
    expect(report.blocks[0]!.left.selectedId).toBe(CAST_IDS.characterLeft);
    expect(report.blocks[0]!.right.selectedId).toBe(CAST_IDS.characterRight);
    expect(report.blocks[1]!.left.selectedId).toBe(CAST_IDS.characterRight);
    expect(report.blocks[1]!.right.selectedId).toBe(CAST_IDS.characterLeft);
  });

  it('refuses the whole batch when a background is missing', () => {
    const report = inspectMultiScene(castProject({ backgroundName: '宗门大厅' }), blocks);
    expect(report.ready).toBe(false);
    expect(report.blocks[0]!.background.status).toBe('missing');
    expect(report.blocks[0]!.ready).toBe(false);
  });

  it('refuses the whole batch when a Character is missing', () => {
    const project = castProject();
    const renamed = ProjectSchema.parse({
      ...project,
      characters: project.characters.map((character) =>
        character.id === CAST_IDS.characterRight
          ? { ...character, name: '大长老' }
          : character,
      ),
    });
    const report = inspectMultiScene(renamed, blocks);
    expect(report.ready).toBe(false);
    expect(report.blocks[0]!.right.status).toBe('missing');
  });

  it('requires an explicit pick when a name is ambiguous', () => {
    const project = castProject();
    const duplicated = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        imageAsset(CAST_IDS.assetDuplicateBg, '花园', {
          width: 1920,
          height: 1080,
        }, 'background'),
      ],
    });

    const unresolved = inspectMultiScene(duplicated, blocks);
    expect(unresolved.ready).toBe(false);
    expect(unresolved.blocks[0]!.background.status).toBe('ambiguous');
    expect(unresolved.blocks[0]!.background.choices).toHaveLength(2);

    const resolved = inspectMultiScene(
      duplicated,
      blocks,
      blocks.map(() => ({ backgroundAssetId: CAST_IDS.assetDuplicateBg })),
    );
    expect(resolved.ready).toBe(true);
    expect(resolved.blocks[0]!.background.selectedId).toBe(
      CAST_IDS.assetDuplicateBg,
    );
    expect(resolved.blocks[1]!.background.selectedId).toBe(
      CAST_IDS.assetDuplicateBg,
    );
  });

  it('reports an unusable candidate with its reason instead of picking it', () => {
    const project = castProject();
    const unusable = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === IDS.assetBg ? { ...asset, usage: 'uncategorized' } : asset,
      ),
    });
    const report = inspectMultiScene(unusable, blocks);
    expect(report.ready).toBe(false);
    expect(report.blocks[0]!.background.status).toBe('unusable');
    expect(report.blocks[0]!.background.message).toContain('不是可用的背景图片素材');
  });
});

describe('AUTO-04 batch planning', () => {
  const service = new MultiSceneService();

  it('builds one background plus two Character layers per Shot', () => {
    const project = castProject();
    const outcome = service.plan(project, parseMultiSceneInput(THREE_BLOCKS));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.plan.shots).toHaveLength(3);
    for (const planned of outcome.plan.shots) {
      const shot = outcome.plan.candidateProject.shots.find(
        (candidate) => candidate.id === planned.shotId,
      );
      expect(shot).toBeDefined();
      expect(shot!.durationMs).toBe(MULTI_SCENE_SHOT_DURATION_MS);
      expect(shot!.layers).toHaveLength(3);
      expect(shot!.backgroundLayerId).toBe(planned.backgroundLayerId);
      expect(shot!.dialogues).toEqual([]);
      expect(shot!.audioClips).toEqual([]);
      expect(shot!.timelineEvents).toEqual([]);
      const characterLayers = shot!.layers.filter(
        (layer) => layer.source.kind === 'character',
      );
      expect(characterLayers).toHaveLength(2);
      expect(characterLayers.map((layer) => layer.rotationDeg)).toEqual([0, 0]);
      expect(characterLayers.map((layer) => layer.scaleX)).toEqual([1, 1]);
      expect(characterLayers.map((layer) => layer.flipX)).toEqual([false, false]);
    }
  });

  it('uses the AUTO-01 planner for the two-person stance', () => {
    const project = castProject();
    const outcome = service.plan(project, parseMultiSceneInput(TWO_BLOCKS));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    for (const planned of outcome.plan.shots) {
      expect(planned.leftPosition.x).toBe(QUICK_LAYOUT_LEFT_X);
      expect(planned.rightPosition.x).toBe(QUICK_LAYOUT_RIGHT_X);
      const shot = outcome.plan.candidateProject.shots.find(
        (candidate) => candidate.id === planned.shotId,
      )!;
      for (const [layerId, position] of [
        [planned.leftLayerId, planned.leftPosition],
        [planned.rightLayerId, planned.rightPosition],
      ] as const) {
        const layer = shot.layers.find((candidate) => candidate.id === layerId)!;
        expect(layer.x).toBe(position.x);
        expect(layer.y).toBe(position.y);
        const rect = quickLayoutVisualRect(
          outcome.plan.candidateProject,
          shot,
          layerId,
          position,
        );
        expect(rect).not.toBeNull();
        expect(Math.abs(rect!.bottom - QUICK_LAYOUT_GROUND_Y)).toBeLessThan(1e-6);
      }
    }
  });

  it('fails the whole batch when a visual cannot fit the canvas', () => {
    const project = castProject({ bodySize: { width: 1_800, height: 1_800 } });
    const outcome = service.plan(project, parseMultiSceneInput(TWO_BLOCKS));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('LAYOUT_OUT_OF_CANVAS');
    expect(outcome.blockIndex).toBe(1);
  });

  it('refuses a batch whose name already exists in the project', () => {
    const project = castProject();
    const outcome = service.plan(project, parseMultiSceneInput(TWO_BLOCKS));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const blocked = service.plan(outcome.plan.candidateProject, parseMultiSceneInput(TWO_BLOCKS));
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe('SHOT_NAME_CONFLICT');
  });

  it('leaves every existing Shot untouched', () => {
    const project = castProject();
    const before = JSON.stringify(project.shots);
    const outcome = service.plan(project, parseMultiSceneInput(THREE_BLOCKS));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const existing = outcome.plan.candidateProject.shots.slice(
      0,
      project.shots.length,
    );
    expect(JSON.stringify(existing)).toBe(before);
    expect(outcome.plan.candidateProject.shots).toHaveLength(
      project.shots.length + 3,
    );
  });

  it('keeps the baseline project unchanged', () => {
    const project = castProject();
    const before = JSON.stringify(project);
    service.plan(project, parseMultiSceneInput(TWO_BLOCKS));
    expect(JSON.stringify(project)).toBe(before);
  });

  it('does not produce a plan when any slot is unresolved', () => {
    const project = castProject({ backgroundName: '宗门大厅' });
    const outcome = service.plan(project, parseMultiSceneInput(TWO_BLOCKS));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('SCENE_SLOT_UNRESOLVED');
  });
});
