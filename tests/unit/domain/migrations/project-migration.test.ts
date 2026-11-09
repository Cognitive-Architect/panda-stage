import { asExpressionCharacter } from '../../../helpers/characterAssertions';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  migrateProject,
  ProjectSchema,
  ProjectV12Schema,
  ProjectV13Schema,
  ProjectV14Schema,
  ProjectV15Schema,
  ProjectV15AdaptiveSchema,
  ProjectV16Schema,
  ProjectV17Schema,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  type Project,
} from '../../../../src/domain';
import {
  buildProject,
  buildProjectWithAnimation,
  IDS,
  legacyShot,
  legacyShots,
} from '../testProject';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../../../helpers/adaptivePartsFixtures';

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

/**
 * Legacy envelopes predate Shot templates, so every downgraded fixture drops
 * the current-only collection before it is parsed as V11–V15.
 */
function withVersion<
  T extends { shotTemplates?: unknown; schemaVersion?: number },
>(
  project: T,
  schemaVersion: number,
): Omit<T, 'shotTemplates' | 'schemaVersion'> & { schemaVersion: number } {
  const {
    shotTemplates: _shotTemplates,
    schemaVersion: _schemaVersion,
    ...rest
  } = project;
  void _shotTemplates;
  void _schemaVersion;
  return { ...rest, schemaVersion };
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
    const original = asExpressionCharacter(current.characters[0]!);
    const { animations: _animations, ...version11Fields } = current;
    void _animations;
    const legacyV11 = {
      ...withVersion(version11Fields, 11),
      shots: legacyShots(current.shots),
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
    const character = asExpressionCharacter(result.characters[0]!);

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
      ...withVersion(withoutAnimations, 12),
      shots: legacyShots(current.shots),
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
    expect(migrated.shots.map(legacyShot)).toEqual(legacyV12.shots);
    expect(legacyV12).toEqual(before);
  });

  it('migrates strict v13 projects to v16 with an empty animation collection', () => {
    const current = buildProject();
    const { animations: _animations, ...version13Fields } = current;
    void _animations;
    const legacyV13 = {
      ...withVersion(version13Fields, 13),
      shots: legacyShots(current.shots),
    };
    const before = structuredClone(legacyV13);

    expect(ProjectV13Schema.parse(legacyV13)).toEqual(legacyV13);
    expect(ProjectSchema.safeParse(legacyV13).success).toBe(false);

    const migrated = migrateProject(legacyV13);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.animations).toEqual([]);
    expect(migrated.assets).toEqual(current.assets);
    expect(legacyV13).toEqual(before);
  });

  it('strictly migrates v14 projects to v16 while retaining animation definitions', () => {
    const current = buildProjectWithAnimation();
    const legacyV14 = {
      ...withVersion(current, 14),
      shots: legacyShots(current.shots),
    };
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

  it('strictly migrates v15 animation instances to v16 with once+hold defaults', () => {
    const current = buildProjectWithAnimation();
    const shot = legacyShot(current.shots[0]!);
    const v15Layer = {
      id: IDS.animationLayer,
      name: 'walk instance',
      source: { kind: 'animation' as const, animationId: IDS.animation },
      startTimeMs: 1_234,
      anchor: 'center' as const,
      x: 510,
      y: 520,
      scaleX: 1.25,
      scaleY: 1.25,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: 3,
    };
    const legacyV15 = {
      ...withVersion(current, 15),
      shots: [{ ...shot, layers: [...shot.layers, v15Layer] }],
    };
    const before = structuredClone(legacyV15);

    expect(ProjectV15Schema.parse(legacyV15)).toEqual(legacyV15);
    expect(ProjectSchema.safeParse(legacyV15).success).toBe(false);
    expect(ProjectV15Schema.safeParse({
      ...legacyV15,
      shots: [{
        ...legacyV15.shots[0]!,
        layers: [...legacyV15.shots[0]!.layers, {
          ...v15Layer,
          animationPlayback: { mode: 'once', endBehavior: 'hold' },
          id: '70000000-0000-4000-8000-000000000003',
        }],
      }],
    }).success).toBe(false);

    const migrated = migrateProject(legacyV15);
    const migratedLayer = migrated.shots[0]!.layers.at(-1)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migratedLayer).toMatchObject({
      id: IDS.animationLayer,
      source: { kind: 'animation', animationId: IDS.animation },
      startTimeMs: 1_234,
      x: 510,
      y: 520,
      scaleX: 1.25,
      scaleY: 1.25,
      animationPlayback: { mode: 'once', endBehavior: 'hold' },
    });
    expect(legacyV15).toEqual(before);
  });

  it('strictly migrates main v15 Adaptive Parts projects without changing their references', () => {
    const current = buildProject();
    const characterId = randomUUID();
    const voiceProfileId = randomUUID();
    const adaptiveCharacter = {
      id: characterId,
      name: 'Adaptive v15 Character',
      mode: 'adaptive-parts' as const,
      defaultVoiceProfileId: voiceProfileId,
      defaultScale: 1,
      defaultFlipX: false,
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    };
    const shot = legacyShot(current.shots[0]!);
    const legacyV15 = {
      ...withVersion(current, 15),
      characters: [...current.characters, adaptiveCharacter],
      voiceProfiles: [
        ...current.voiceProfiles,
        {
          id: voiceProfileId,
          name: 'Adaptive v15 Voice',
          characterId,
          locale: 'en-US',
          rate: 1,
          pitch: 0,
        },
      ],
      shots: [
        {
          ...shot,
          layers: [
            ...shot.layers,
            {
              id: randomUUID(),
              name: 'Adaptive v15 layer',
              source: { kind: 'character' as const, characterId },
              anchor: 'center' as const,
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              visible: true,
              locked: false,
              flipX: false,
              zIndex: shot.layers.length,
            },
          ],
        },
      ],
    };
    const before = structuredClone(legacyV15);

    expect(ProjectV15AdaptiveSchema.parse(legacyV15)).toEqual(legacyV15);
    expect(ProjectV15Schema.safeParse(legacyV15).success).toBe(false);

    const migrated = migrateProject(legacyV15);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.characters.at(-1)).toMatchObject({
      id: characterId,
      mode: 'adaptive-parts',
      parts: adaptiveCharacter.parts,
      sourceRootTransform: adaptiveCharacter.sourceRootTransform,
    });
    expect(migrated.shots[0]!.layers.at(-1)!.source).toEqual({
      kind: 'character',
      characterId,
    });
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
    expect(migrateProject(migrated)).toEqual(migrated);
    expect(legacyV15).toEqual(before);
  });

  it('fails closed for v15 projects that mix Adaptive Parts and animation shapes', () => {
    const current = buildProjectWithAnimation();
    const characterId = randomUUID();
    const voiceProfileId = randomUUID();
    const adaptiveCharacter = {
      id: characterId,
      name: 'Mixed v15 Character',
      mode: 'adaptive-parts' as const,
      defaultVoiceProfileId: voiceProfileId,
      defaultScale: 1,
      defaultFlipX: false,
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    };
    const shot = legacyShot(current.shots[0]!);
    const mixedV15 = {
      ...withVersion(current, 15),
      characters: [...current.characters, adaptiveCharacter],
      voiceProfiles: [
        ...current.voiceProfiles,
        {
          id: voiceProfileId,
          name: 'Mixed v15 Voice',
          characterId,
          locale: 'en-US',
          rate: 1,
          pitch: 0,
        },
      ],
      shots: [
        {
          ...shot,
          layers: [
            ...shot.layers,
            {
              id: randomUUID(),
              name: 'Animation v15 layer',
              source: { kind: 'animation' as const, animationId: IDS.animation },
              startTimeMs: 500,
              anchor: 'center' as const,
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              visible: true,
              locked: false,
              flipX: false,
              zIndex: shot.layers.length,
            },
          ],
        },
      ],
    };

    expect(ProjectV15AdaptiveSchema.safeParse(mixedV15).success).toBe(false);
    expect(ProjectV15Schema.safeParse(mixedV15).success).toBe(false);
    expect(() => migrateProject(mixedV15)).toThrow(/matches neither/u);
  });

  it('accepts the shared static v15 shape when both strict historical schemas agree', () => {
    const currentStatic = buildProject();
    const staticV15 = {
      ...withVersion(currentStatic, 15),
      shots: legacyShots(currentStatic.shots),
    };

    expect(ProjectV15Schema.safeParse(staticV15).success).toBe(true);
    expect(ProjectV15AdaptiveSchema.safeParse(staticV15).success).toBe(true);
    expect(migrateProject(staticV15).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('strictly upgrades v16 and rejects Part pose data in the v16 contract', () => {
    const current = buildProject();
    // v16 predates both the project-local Shot template list and the persisted
    // per-Shot camera track, so the fixture drops them before parsing.
    const v16 = {
      ...withVersion(current, 16),
      shots: legacyShots(current.shots),
    };
    expect(ProjectV16Schema.parse(v16)).toEqual(v16);
    expect(ProjectSchema.safeParse(v16).success).toBe(false);
    expect(migrateProject(v16).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const shot = v16.shots[0]!;
    const layerWithFutureField = {
      ...v16,
      shots: [
        {
          ...shot,
          layers: [
            { ...shot.layers[0]!, poseAnimation: { version: 1 } },
            ...shot.layers.slice(1),
          ],
        },
      ],
    };
    expect(ProjectV16Schema.safeParse(layerWithFutureField).success).toBe(false);
    expect(() => migrateProject(layerWithFutureField)).toThrow();
  });

  it('strictly upgrades v17 and rejects preset data in the v17 contract', () => {
    const current = buildProject();
    // v17 already carries the project-local Shot template list; it predates
    // only the v18 per-Shot camera track and the v18 user Part pose presets.
    const { schemaVersion: _schemaVersion, ...v17Rest } = current;
    void _schemaVersion;
    const v17 = {
      ...v17Rest,
      schemaVersion: 17,
      shots: legacyShots(current.shots),
    };
    expect(ProjectV17Schema.parse(v17)).toEqual(v17);
    expect(ProjectSchema.safeParse(v17).success).toBe(false);

    const migrated = migrateProject(v17);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.partPosePresets).toBeUndefined();

    const withFutureField = {
      ...v17,
      partPosePresets: [
        {
          id: randomUUID(),
          name: '过早',
          characterId: randomUUID(),
          durationMs: 1_000,
          sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          fixedCharacterCenter: { x: 0, y: 0 },
          tracks: [
            {
              partId: 'part',
              pivotSource: { x: 0, y: 0 },
              sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
              keys: [
                {
                  timeMs: 0,
                  offsetX: 0,
                  offsetY: 0,
                  rotationDeg: 0,
                  scale: 1,
                  easingToNext: 'linear',
                },
              ],
            },
          ],
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(ProjectV17Schema.safeParse(withFutureField).success).toBe(false);
    expect(() => migrateProject(withFutureField)).toThrow();
  });
});
