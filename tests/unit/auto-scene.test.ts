import { describe, expect, it } from 'vitest';
import {
  applyAutoScenePlan,
  isAutoScenePlanStale,
  parseAndPlanAutoScenes,
  parseStructuredSceneBlocks,
  planAutoScenes,
  planStandingPlacement,
  ProjectSchema,
  type AdaptivePartsCharacter,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const SHA_BG = 'a'.repeat(64);
const SHA_PROP = 'b'.repeat(64);
const SHA_GRAPHIC = 'c'.repeat(64);

const EXTRA_IDS = {
  bgDupImage: '11000000-0000-4000-8000-000000000001',
  propCup: '11000000-0000-4000-8000-000000000002',
  bgGraphic: '71000000-0000-4000-8000-000000000001',
  propGraphic: '71000000-0000-4000-8000-000000000002',
  adaptiveChar: '21000000-0000-4000-8000-000000000001',
  adaptiveVoice: '31000000-0000-4000-8000-000000000001',
  dupChar: '21000000-0000-4000-8000-000000000002',
  dupCharVoice: '31000000-0000-4000-8000-000000000002',
  dupCharExpr: '21000000-0000-4000-8000-000000000003',
  thirdChar: '21000000-0000-4000-8000-000000000004',
  thirdCharVoice: '31000000-0000-4000-8000-000000000004',
  thirdCharExpr: '21000000-0000-4000-8000-000000000005',
  thirdCharAsset: '11000000-0000-4000-8000-000000000003',
  dupCharAsset: '11000000-0000-4000-8000-000000000004',
  adaptiveBodyAsset: '11000000-0000-4000-8000-000000000005',
} as const;

function makeGraphic(id: string, name: string): FlaGraphicDefinition {
  return {
    id,
    name,
    kind: 'fla-graphic',
    source: {
      basename: `${name}.fla`,
      sha256: SHA_GRAPHIC,
      renderTargetId: `target-${id}`,
      targetKind: 'graphic-symbol',
      targetName: name,
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 10,
      canvas: { width: 1280, height: 720 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1280, height: 720 },
    },
    durationMs: 100,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: IDS.assetBg,
        sha256: SHA_BG,
        sourceViewport: { x: 0, y: 0, width: 1280, height: 720 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 100,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      symbolDefinitions: {},
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Layer 1',
              nodes: [
                {
                  id: 'bg-shape',
                  sourceAddress: 'g/bg-shape',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  type: 'opaque',
                  opaqueKind: 'shape',
                  fallbackScope: 'subtree',
                  fallbackAssetId: IDS.assetBg,
                  fallbackViewBox: { x: 0, y: 0, width: 1280, height: 720 },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function makeRichProject(options?: {
  duplicateNames?: boolean;
}): Project {
  const base = buildProject();
  const baseAssets = base.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: SHA_BG } : asset,
  );

  const extraAssets: Project['assets'] = [
    {
      id: EXTRA_IDS.propCup,
      kind: 'image',
      name: '茶杯',
      relativePath: 'cup.png',
      mimeType: 'image/png',
      width: 160,
      height: 160,
      sha256: SHA_PROP,
      usage: 'uncategorized',
      keywords: [],
    },
    {
      id: EXTRA_IDS.thirdCharAsset,
      kind: 'image',
      name: '师父立绘',
      relativePath: 'master.png',
      mimeType: 'image/png',
      width: 500,
      height: 700,
      sha256: SHA_PROP,
      usage: 'uncategorized',
      keywords: [],
    },
    {
      id: EXTRA_IDS.adaptiveBodyAsset,
      kind: 'image',
      name: '分件身体',
      relativePath: 'adaptive-body.png',
      mimeType: 'image/png',
      width: 400,
      height: 600,
      sha256: SHA_PROP,
      usage: 'uncategorized',
      keywords: [],
    },
  ];

  if (options?.duplicateNames) {
    extraAssets.push(
      {
        id: EXTRA_IDS.dupCharAsset,
        kind: 'image',
        name: '熊猫分身立绘',
        relativePath: 'panda-dup.png',
        mimeType: 'image/png',
        width: 600,
        height: 600,
        sha256: SHA_PROP,
        usage: 'uncategorized',
        keywords: [],
      },
    );
  }

  const adaptiveChar: AdaptivePartsCharacter = {
    id: EXTRA_IDS.adaptiveChar,
    mode: 'adaptive-parts',
    name: '小师妹',
    defaultVoiceProfileId: EXTRA_IDS.adaptiveVoice,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: '21000000-0000-4000-8000-000000000010',
        source: {
          kind: 'source-instance',
          sourceId: 'part-body',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        assetId: EXTRA_IDS.adaptiveBodyAsset,
        imageMapping: {
          sourceWidth: 400,
          sourceHeight: 600,
          crop: { x: 0, y: 0, width: 400, height: 600 },
          exportScale: 1,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
      },
    ],
  };

  const characters: Project['characters'] = [
    ...base.characters,
    adaptiveChar,
    {
      id: EXTRA_IDS.thirdChar,
      mode: 'single-image',
      name: '师父',
      baseAssetId: EXTRA_IDS.thirdCharAsset,
      defaultVoiceProfileId: EXTRA_IDS.thirdCharVoice,
      expressions: [
        {
          id: EXTRA_IDS.thirdCharExpr,
          name: '正常',
          assetId: EXTRA_IDS.thirdCharAsset,
        },
      ],
      defaultExpressionId: EXTRA_IDS.thirdCharExpr,
      defaultScale: 1,
      defaultFlipX: false,
    },
  ];

  const voiceProfiles: Project['voiceProfiles'] = [
    ...base.voiceProfiles,
    {
      id: EXTRA_IDS.adaptiveVoice,
      name: '小师妹配音',
      characterId: EXTRA_IDS.adaptiveChar,
      locale: 'zh-CN',
      rate: 1,
      pitch: 0,
    },
    {
      id: EXTRA_IDS.thirdCharVoice,
      name: '师父配音',
      characterId: EXTRA_IDS.thirdChar,
      locale: 'zh-CN',
      rate: 1,
      pitch: 0,
    },
  ];

  if (options?.duplicateNames) {
    characters.push({
      id: EXTRA_IDS.dupChar,
      mode: 'single-image',
      name: '熊猫１',
      baseAssetId: EXTRA_IDS.dupCharAsset,
      defaultVoiceProfileId: EXTRA_IDS.dupCharVoice,
      expressions: [
        {
          id: EXTRA_IDS.dupCharExpr,
          name: '正常',
          assetId: EXTRA_IDS.dupCharAsset,
        },
      ],
      defaultExpressionId: EXTRA_IDS.dupCharExpr,
      defaultScale: 1,
      defaultFlipX: false,
    });
    characters.push({
      id: '21000000-0000-4000-8000-000000000009',
      mode: 'single-image',
      name: '熊猫1',
      baseAssetId: IDS.assetChar2,
      defaultVoiceProfileId: '31000000-0000-4000-8000-000000000009',
      expressions: [
        {
          id: '21000000-0000-4000-8000-000000000019',
          name: '正常',
          assetId: IDS.assetChar2,
        },
      ],
      defaultExpressionId: '21000000-0000-4000-8000-000000000019',
      defaultScale: 1,
      defaultFlipX: false,
    });
    voiceProfiles.push(
      {
        id: EXTRA_IDS.dupCharVoice,
        name: '熊猫2配音',
        characterId: EXTRA_IDS.dupChar,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
      {
        id: '31000000-0000-4000-8000-000000000009',
        name: '熊猫1配音',
        characterId: '21000000-0000-4000-8000-000000000009',
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    );
  }

  return ProjectSchema.parse({
    ...base,
    assets: [...baseAssets, ...extraAssets],
    animations: [
      makeGraphic(EXTRA_IDS.bgGraphic, options?.duplicateNames ? '背景' : '宗门大厅'),
      makeGraphic(EXTRA_IDS.propGraphic, '法宝灯笼'),
    ],
    characters,
    voiceProfiles,
  });
}

describe('WF-03 Auto Scene parser, resolver, and shared planner', () => {
  it('generates a single editable shot and 2 consecutive shots on the exact same pipeline with image/Graphic bg and adaptive character', () => {
    const project = makeRichProject();

    // 1. Single shot (length-1 array) with image background, regular + adaptive character, duration, and prop
    const singleInput = [
      '镜头：大厅初见',
      '背景：背景',
      '出场：熊猫、小师妹',
      '站位：双人对话',
      '时长：4.5s',
      '道具：茶杯',
    ].join('\n');

    const singleRes = parseAndPlanAutoScenes(project, singleInput);
    expect(singleRes.parseOk).toBe(true);
    expect(singleRes.plan).not.toBeNull();
    expect(singleRes.plan!.blocks).toHaveLength(1);
    expect(singleRes.plan!.applicableCount).toBe(1);

    const singleApplied = applyAutoScenePlan(project, singleRes.plan!);
    expect(singleApplied.ok).toBe(true);
    if (!singleApplied.ok) return;

    expect(singleApplied.project.shots).toHaveLength(project.shots.length + 1);
    const createdSingle = singleApplied.project.shots.at(-1)!;
    expect(createdSingle.name).toBe('大厅初见');
    expect(createdSingle.durationMs).toBe(4500);
    expect(createdSingle.backgroundLayerId).not.toBeNull();
    expect(
      createdSingle.layers.some(
        (l) => l.source.kind === 'character' && l.source.characterId === IDS.character,
      ),
    ).toBe(true);
    expect(
      createdSingle.layers.some(
        (l) =>
          l.source.kind === 'character' &&
          l.source.characterId === EXTRA_IDS.adaptiveChar,
      ),
    ).toBe(true);
    expect(
      createdSingle.layers.some(
        (l) => l.source.kind === 'asset' && l.source.assetId === EXTRA_IDS.propCup,
      ),
    ).toBe(true);

    // 2. Two consecutive shots separated by `---`, including FLA Graphic background + Graphic prop
    const multiInput = [
      '镜头：第一幕',
      '背景：背景',
      '出场：熊猫',
      '时长：3s',
      '---',
      '镜头：第二幕',
      '背景：宗门大厅',
      '出场：熊猫、小师妹',
      '站位：双人对话',
      '道具：法宝灯笼',
      '时长：5000ms',
    ].join('\n');

    const multiRes = parseAndPlanAutoScenes(project, multiInput);
    expect(multiRes.parseOk).toBe(true);
    expect(multiRes.plan!.blocks).toHaveLength(2);
    expect(multiRes.plan!.applicableCount).toBe(2);

    const multiApplied = applyAutoScenePlan(project, multiRes.plan!);
    expect(multiApplied.ok).toBe(true);
    if (!multiApplied.ok) return;

    expect(multiApplied.createdShotIds).toHaveLength(2);
    const shot2 = multiApplied.project.shots.find((s) => s.name === '第二幕')!;
    expect(shot2.durationMs).toBe(5000);
    const bgLayer2 = shot2.layers.find((l) => l.id === shot2.backgroundLayerId);
    expect(bgLayer2?.source.kind).toBe('animation');
    if (bgLayer2?.source.kind === 'animation') {
      expect(bgLayer2.source.animationId).toBe(EXTRA_IDS.bgGraphic);
    }
    expect(
      shot2.layers.some(
        (l) =>
          l.source.kind === 'animation' &&
          l.source.animationId === EXTRA_IDS.propGraphic,
      ),
    ).toBe(true);
  });

  it('supports pure scenery (0 cast), single-character, and 3+ multi-character scenes without legacy 2-3 shot limits', () => {
    const project = makeRichProject();
    const input = [
      '镜头：纯景空镜',
      '背景：宗门大厅',
      '出场：无',
      '---',
      '镜头：单人镜头',
      '背景：无',
      '出场：小师妹',
      '站位：居中',
      '---',
      '镜头：三人同框',
      '背景：背景',
      '出场：熊猫、小师妹、师父',
      '站位：并排',
      '---',
      '镜头：第四镜头',
      '背景：无',
      '出场：师父',
    ].join('\n');

    const res = parseAndPlanAutoScenes(project, input);
    expect(res.parseOk).toBe(true);
    expect(res.plan!.applicableCount).toBe(4);

    const applied = applyAutoScenePlan(project, res.plan!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const pureScenery = applied.project.shots.find((s) => s.name === '纯景空镜')!;
    expect(pureScenery.layers.filter((l) => l.source.kind === 'character')).toHaveLength(0);
    expect(pureScenery.backgroundLayerId).not.toBeNull();

    const singleChar = applied.project.shots.find((s) => s.name === '单人镜头')!;
    expect(singleChar.backgroundLayerId).toBeNull();
    expect(singleChar.layers.filter((l) => l.source.kind === 'character')).toHaveLength(1);

    const threeChars = applied.project.shots.find((s) => s.name === '三人同框')!;
    const charLayers = threeChars.layers.filter((l) => l.source.kind === 'character');
    expect(charLayers).toHaveLength(3);
    // Ordered left-to-right across the canvas
    expect(charLayers[0]!.x).toBeLessThan(charLayers[1]!.x);
    expect(charLayers[1]!.x).toBeLessThan(charLayers[2]!.x);
  });

  it('supports manual pick for ambiguous names by official ID and partial confirm when assets are missing', () => {
    const project = makeRichProject({ duplicateNames: true });
    const input = [
      '镜头：歧义镜头',
      '背景：背景',
      '出场：熊猫1、不存在的角色',
      '道具：不存在的道具',
    ].join('\n');

    const initial = parseAndPlanAutoScenes(project, input);
    expect(initial.plan).not.toBeNull();
    const block = initial.plan!.blocks[0]!;
    expect(block.background.status).toBe('ambiguous');
    expect(block.background.candidates).toHaveLength(2);
    expect(block.cast[0]!.match.status).toBe('ambiguous');
    expect(block.cast[0]!.match.candidates).toHaveLength(2);
    expect(block.cast[1]!.match.status).toBe('missing');
    expect(block.props[0]!.match.status).toBe('missing');

    // Manually pick official IDs for ambiguous background (Graphic) & character; leave missing items skipped
    const resolved = parseAndPlanAutoScenes(project, input, {
      1: {
        background: { kind: 'graphic', animationId: EXTRA_IDS.bgGraphic },
        cast: {
          0: { characterId: EXTRA_IDS.dupChar },
          1: 'skip',
        },
        props: {
          0: 'skip',
        },
      },
    });

    const resolvedBlock = resolved.plan!.blocks[0]!;
    expect(resolvedBlock.applicable).toBe(true);
    expect(resolvedBlock.background.status).toBe('matched');
    expect(resolvedBlock.background.selectedRef).toEqual({
      kind: 'graphic',
      animationId: EXTRA_IDS.bgGraphic,
    });
    expect(resolvedBlock.cast[0]!.match.selectedRef?.characterId).toBe(EXTRA_IDS.dupChar);
    expect(resolvedBlock.cast[1]!.match.status).toBe('skipped');

    const applied = applyAutoScenePlan(project, resolved.plan!);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const shot = applied.project.shots.find((s) => s.name === '歧义镜头')!;
    const bgLayer = shot.layers.find((l) => l.id === shot.backgroundLayerId);
    expect(bgLayer?.source).toEqual({
      kind: 'animation',
      animationId: EXTRA_IDS.bgGraphic,
    });
    const charLayers = shot.layers.filter((l) => l.source.kind === 'character');
    expect(charLayers).toHaveLength(1);
    expect(charLayers[0]!.source).toMatchObject({
      kind: 'character',
      characterId: EXTRA_IDS.dupChar,
    });
  });

  it('reuses WF-02 standing placement so actual committed coordinates match preview and planStandingPlacement', () => {
    const project = makeRichProject();
    const input = [
      '镜头：站位核对',
      '背景：背景',
      '出场：熊猫、小师妹',
      '站位：双人对话',
    ].join('\n');

    const res = parseAndPlanAutoScenes(project, input);
    const plan = res.plan!;
    const plannedBlock = plan.blocks[0]!;
    expect(plannedBlock.standingPlan?.ok).toBe(true);

    const previewShot = plan.candidateProject!.shots.find(
      (s) => s.id === plannedBlock.createdShotId,
    )!;
    const applied = applyAutoScenePlan(project, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const committedShot = applied.project.shots.find(
      (s) => s.id === plannedBlock.createdShotId,
    )!;
    const previewChars = previewShot.layers.filter((l) => l.source.kind === 'character');
    const committedChars = committedShot.layers.filter((l) => l.source.kind === 'character');
    expect(committedChars.map((l) => ({ x: l.x, y: l.y }))).toEqual(
      previewChars.map((l) => ({ x: l.x, y: l.y })),
    );

    // Cross-check directly against WF-02 planStandingPlacement
    const recheck = planStandingPlacement(applied.project, {
      shotId: committedShot.id,
      layerIds: committedChars.map((l) => l.id),
      timeMs: 0,
      autoKey: false,
    });
    expect(recheck.ok).toBe(true);
    const recheckedShot = recheck.candidateProject!.shots.find(
      (s) => s.id === committedShot.id,
    )!;
    const recheckedChars = recheckedShot.layers.filter(
      (l) => l.source.kind === 'character',
    );
    expect(recheckedChars.map((l) => ({ x: l.x, y: l.y }))).toEqual(
      committedChars.map((l) => ({ x: l.x, y: l.y })),
    );
  });

  it('detects stale plans when project switches, shot name collides, or referenced asset/character changes', () => {
    const project = makeRichProject();
    const res = parseAndPlanAutoScenes(
      project,
      '镜头：防陈旧\n背景：背景\n出场：熊猫',
    );
    const plan = res.plan!;
    expect(isAutoScenePlanStale(project, plan).stale).toBe(false);

    // 1. Project switched
    const otherProject: Project = {
      ...project,
      id: '99999999-0000-4000-8000-000000000099',
    };
    expect(isAutoScenePlanStale(otherProject, plan).stale).toBe(true);
    expect(applyAutoScenePlan(otherProject, plan).ok).toBe(false);

    // 2. Referenced asset deleted
    const assetRemoved: Project = {
      ...project,
      assets: project.assets.filter((a) => a.id !== IDS.assetBg),
    };
    expect(isAutoScenePlanStale(assetRemoved, plan).stale).toBe(true);

    // 3. Referenced character mutated (defaultScale changed)
    const charMutated: Project = {
      ...project,
      characters: project.characters.map((c) =>
        c.id === IDS.character ? { ...c, defaultScale: 1.5 } : c,
      ),
    };
    expect(isAutoScenePlanStale(charMutated, plan).stale).toBe(true);

    // 4. Shot name collision added externally
    const nameCollided: Project = {
      ...project,
      shots: [
        ...project.shots,
        {
          ...project.shots[0]!,
          id: '55555555-0000-4000-8000-000000000055',
          name: '防陈旧',
        },
      ],
    };
    expect(isAutoScenePlanStale(nameCollided, plan).stale).toBe(true);
  });

  it('exposes shared WF-04 scene planner API supporting extra sections and character->layerId lookup', () => {
    const project = makeRichProject();
    const scriptForWf04 = [
      '镜头：宗门对话',
      '背景：宗门大厅',
      '出场：熊猫、小师妹',
      '站位：双人对话',
      '对白：',
      '熊猫：听我解释。',
      '小师妹：你又偷懒了！',
      '表演：',
      '1｜抖动',
    ].join('\n');

    const parsed = parseStructuredSceneBlocks(scriptForWf04, {
      allowExtraSections: ['对白', '表演'],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]!.extraSections?.['对白']).toHaveLength(2);
    expect(parsed.blocks[0]!.extraSections?.['表演']).toHaveLength(1);

    const plan = planAutoScenes(project, parsed.blocks);
    expect(plan.applicableCount).toBe(1);
    const block = plan.blocks[0]!;
    expect(block.createdShotId).toBeTruthy();
    expect(block.castLayerIdsByCharacterId[IDS.character]).toHaveLength(1);
    expect(block.castLayerIdsByCharacterId[EXTRA_IDS.adaptiveChar]).toHaveLength(1);
  });
});
