import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  migrateProject,
  ProjectSchema,
  ProjectV12Schema,
  ProjectV13Schema,
  ProjectV14Schema,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  type Project,
} from '../../../../src/domain';
import { buildProject, buildProjectWithAnimation, IDS } from '../testProject';

function v1WithoutTimelineEvents(): unknown {
  return {
    schemaVersion: 1,
    id: '10000000-0000-4000-8000-000000000001',
    name: '旧版项目',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        kind: 'image',
        name: '背景',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
    ],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: '字幕',
        fontFamily: 'Arial',
        fontSize: 44,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [
      {
        id: '50000000-0000-4000-8000-000000000001',
        name: '镜头',
        durationMs: 1000,
        defaultSubtitleStyleId: '40000000-0000-4000-8000-000000000001',
        dialogues: [],
        audioClips: [],
        layers: [
          {
            id: '60000000-0000-4000-8000-000000000001',
            name: '背景',
            source: {
              kind: 'asset',
              assetId: '10000000-0000-4000-8000-000000000001',
            },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
          },
        ],
        // 故意缺少 timelineEvents（旧版本引入该字段之前）
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function v2WithoutTimelineEvents(): unknown {
  return {
    schemaVersion: 2,
    id: '20000000-0000-4000-8000-000000000001',
    name: '旧版项目2',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        kind: 'image',
        name: '背景',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        kind: 'image',
        name: '角色',
        relativePath: 'c.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
      },
    ],
    characters: [
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: '熊猫',
        baseAssetId: '10000000-0000-4000-8000-000000000002',
        defaultVoiceProfileId: '30000000-0000-4000-8000-000000000001',
        expressions: [
          {
            id: '20000000-0000-4000-8000-000000000003',
            name: '正常',
            assetId: '10000000-0000-4000-8000-000000000002',
          },
        ],
        defaultExpressionId: '20000000-0000-4000-8000-000000000003',
        defaultScale: 1,
        defaultFlipX: false,
      },
    ],
    voiceProfiles: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        name: '配音',
        characterId: '20000000-0000-4000-8000-000000000002',
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    subtitleStyles: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: '字幕',
        fontFamily: 'Arial',
        fontSize: 44,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [
      {
        id: '50000000-0000-4000-8000-000000000001',
        name: '镜头',
        durationMs: 1000,
        defaultSubtitleStyleId: '40000000-0000-4000-8000-000000000001',
        dialogues: [],
        audioClips: [],
        layers: [
          {
            id: '60000000-0000-4000-8000-000000000001',
            name: '背景',
            source: {
              kind: 'asset',
              assetId: '10000000-0000-4000-8000-000000000001',
            },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
          },
        ],
        // 故意缺少 timelineEvents
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('T01 迁移回填 timelineEvents', () => {
  it('v1 旧项目（缺 timelineEvents）可被打开且结果含空数组', () => {
    const result = migrateProject(v1WithoutTimelineEvents()) as Project;
    expect(result.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(result.shots.length).toBeGreaterThan(0);
    for (const shot of result.shots) {
      expect(Array.isArray(shot.timelineEvents)).toBe(true);
      expect(shot.timelineEvents).toEqual([]);
    }
  });

  it('v2 旧项目（缺 timelineEvents）可被打开且结果含空数组', () => {
    const result = migrateProject(v2WithoutTimelineEvents()) as Project;
    expect(result.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    for (const shot of result.shots) {
      expect(Array.isArray(shot.timelineEvents)).toBe(true);
      expect(shot.timelineEvents).toEqual([]);
    }
  });

  it('迁移结果通过严格 ProjectDataSchema 校验', () => {
    const result = migrateProject(v1WithoutTimelineEvents());
    expect(() => ProjectSchema.parse(result)).not.toThrow();
  });

  it('migrates strict v11 composite data with default Body placement and preserves its visual', () => {
    const current = buildProject();
    const original = current.characters[0]!;
    const { animations: _animations, ...version11Fields } = current;
    void _animations;
    const legacyV11 = {
      ...version11Fields,
      schemaVersion: 11,
      assets: current.assets.map((asset) => {
        if (asset.kind !== 'image') return asset;
        const { usage: _usage, keywords: _keywords, ...version11Asset } = asset;
        void _usage;
        void _keywords;
        return version11Asset;
      }),
      characters: [
        {
          ...original,
          mode: 'composite' as const,
          bodyAssetId: IDS.assetBg,
          facePlacement: {
            offsetX: 82,
            offsetY: -36,
            scale: 0.74,
            rotationDeg: 18,
            flipX: true,
          },
          head: {
            assetId: IDS.assetChar2,
            placement: {
              offsetX: -16,
              offsetY: -152,
              scale: 0.86,
              rotationDeg: -12,
              flipX: true,
            },
            pivot: { x: 306, y: 412 },
          },
          mouthOpenAssetId: IDS.assetChar2,
          talkingHeadMotionIntensityPercent: 137,
        },
      ],
    };
    const before = structuredClone(legacyV11);
    const result = migrateProject(legacyV11);
    const character = result.characters[0]!;

    expect(result.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(character).toMatchObject({
      mode: 'composite',
      bodyAssetId: IDS.assetBg,
      bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
      facePlacement: legacyV11.characters[0]!.facePlacement,
      head: legacyV11.characters[0]!.head,
      talkingHeadMotionIntensityPercent: 137,
      mouthOpenAssetId: IDS.assetChar2,
      expressions: original.expressions,
    });
    expect(legacyV11).toEqual(before);
    expect(() => ProjectSchema.parse(result)).not.toThrow();

    const shot = result.shots[0]!;
    const visual = resolveLayerVisualParts(
      result,
      shot,
      evaluateShotAtTime(shot, 0, result).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!,
    );
    const bodyAsset = result.assets.find(
      (asset) => asset.id === IDS.assetBg,
    );
    expect(bodyAsset?.kind).toBe('image');
    if (bodyAsset?.kind !== 'image') throw new Error('Expected Body image.');
    expect(visual.parts.find((part) => part.slot === 'body')?.localRect).toEqual({
      x: -bodyAsset.width / 2,
      y: -bodyAsset.height / 2,
      width: bodyAsset.width,
      height: bodyAsset.height,
    });
    expect(visual.headGroup?.pivot).toEqual({ x: 306, y: 412 });
  });

  it('migrates strict v12 assets to explicitly uncategorized v13 metadata', () => {
    const current = buildProject();
    const { animations: _animations, ...withoutAnimations } = current;
    void _animations;
    const legacyV12 = {
      ...withoutAnimations,
      schemaVersion: 12,
      assets: current.assets.map((asset) => {
        if (asset.kind !== 'image') return asset;
        const { usage: _usage, keywords: _keywords, ...version12Asset } = asset;
        void _usage;
        void _keywords;
        return version12Asset;
      }),
    };
    const before = structuredClone(legacyV12);

    expect(ProjectV12Schema.parse(legacyV12)).toEqual(legacyV12);
    expect(ProjectSchema.safeParse(legacyV12).success).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...legacyV12,
        schemaVersion: PROJECT_SCHEMA_VERSION,
      }).success,
    ).toBe(false);

    const migrated = migrateProject(legacyV12);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(
      migrated.assets.filter((asset) => asset.kind === 'image'),
    ).toEqual(
      legacyV12.assets.map((asset) => ({
        ...asset,
        usage: 'uncategorized',
        keywords: [],
      })),
    );
    expect(migrated.characters).toEqual(legacyV12.characters);
    expect(migrated.shots).toEqual(legacyV12.shots);
    expect(legacyV12).toEqual(before);
  });

  it('migrates strict v13 projects to v15 with an empty animation collection', () => {
    const current = buildProject();
    const { animations: _animations, ...version13Fields } = current;
    void _animations;
    const legacyV13 = { ...version13Fields, schemaVersion: 13 };
    const before = structuredClone(legacyV13);

    expect(ProjectV13Schema.parse(legacyV13)).toEqual(legacyV13);
    expect(ProjectSchema.safeParse(legacyV13).success).toBe(false);

    const migrated = migrateProject(legacyV13);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.animations).toEqual([]);
    expect(migrated.assets).toEqual(current.assets);
    expect(legacyV13).toEqual(before);
  });

  it('strictly migrates v14 projects to v15 while retaining animation definitions', () => {
    const current = buildProjectWithAnimation();
    const legacyV14 = { ...current, schemaVersion: 14 };
    const before = structuredClone(legacyV14);

    expect(ProjectV14Schema.parse(legacyV14)).toEqual(legacyV14);
    expect(ProjectSchema.safeParse(legacyV14).success).toBe(false);

    const migrated = migrateProject(legacyV14);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.animations).toEqual(current.animations);
    expect(migrated.shots).toEqual(current.shots);
    expect(legacyV14).toEqual(before);

    const withV15Layer = {
      ...legacyV14,
      shots: legacyV14.shots.map((shot) => ({
        ...shot,
        layers: [
          ...shot.layers,
          {
            id: IDS.animationLayer,
            name: 'test animation',
            source: { kind: 'animation', animationId: IDS.animation },
            startTimeMs: 1_000,
            anchor: 'center',
            x: 500,
            y: 500,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: 4,
          },
        ],
      })),
    };
    expect(ProjectV14Schema.safeParse(withV15Layer).success).toBe(false);
  });
});
