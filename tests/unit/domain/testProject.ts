import { ProjectSchema, type Project } from '../../../src/domain';

/**
 * Stable UUID identifiers for the test fixture. The formal v5 schema enforces
 * UUID format on every id field, so the fixture and the tests that assert
 * against specific layers/characters share these constants.
 */
export const IDS = {
  project: '00000000-0000-4000-8000-000000000001',
  assetBg: '10000000-0000-4000-8000-000000000001',
  assetChar: '10000000-0000-4000-8000-000000000002',
  assetChar2: '10000000-0000-4000-8000-000000000003',
  character: '20000000-0000-4000-8000-000000000001',
  expressionNormal: '20000000-0000-4000-8000-000000000002',
  expressionAngry: '20000000-0000-4000-8000-000000000003',
  voiceProfile: '30000000-0000-4000-8000-000000000001',
  subtitle: '40000000-0000-4000-8000-000000000001',
  shot: '50000000-0000-4000-8000-000000000001',
  layerBg: '60000000-0000-4000-8000-000000000001',
  layerAsset: '60000000-0000-4000-8000-000000000002',
  layerChar: '60000000-0000-4000-8000-000000000003',
  /** A UUID-format id that intentionally does not belong to any character. */
  unknownExpression: '20000000-0000-4000-8000-000000000099',
} as const;

/** Builds a fully valid v6 project with a background, an asset, and a
 * character layer so preset/evaluator tests have realistic fixtures. */
export function buildProject(): Project {
  return ProjectSchema.parse({
    schemaVersion: 6,
    id: IDS.project,
    name: '测试项目',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: IDS.assetBg,
        kind: 'image',
        name: '背景',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
      {
        id: IDS.assetChar,
        kind: 'image',
        name: '熊猫',
        relativePath: 'char.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
      },
      {
        id: IDS.assetChar2,
        kind: 'image',
        name: '熊猫2',
        relativePath: 'char2.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
      },
    ],
    characters: [
      {
        id: IDS.character,
        name: '熊猫',
        baseAssetId: IDS.assetChar,
        defaultVoiceProfileId: IDS.voiceProfile,
        expressions: [
          { id: IDS.expressionNormal, name: '正常', assetId: IDS.assetChar },
          { id: IDS.expressionAngry, name: '生气', assetId: IDS.assetChar2 },
        ],
        defaultExpressionId: IDS.expressionNormal,
        defaultScale: 1,
        defaultFlipX: false,
      },
    ],
    voiceProfiles: [
      {
        id: IDS.voiceProfile,
        name: '配音',
        characterId: IDS.character,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    subtitleStyles: [
      {
        id: IDS.subtitle,
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
        id: IDS.shot,
        name: '镜头',
        durationMs: 3000,
        defaultSubtitleStyleId: IDS.subtitle,
        dialogues: [],
        audioClips: [],
        backgroundLayerId: IDS.layerBg,
        layers: [
          {
            id: IDS.layerBg,
            name: '背景',
            source: { kind: 'asset', assetId: IDS.assetBg },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
            locked: false,
            flipX: false,
          },
          {
            id: IDS.layerAsset,
            name: '道具',
            source: { kind: 'asset', assetId: IDS.assetBg },
            anchor: 'center',
            x: 500,
            y: 600,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 1,
            locked: false,
            flipX: false,
          },
          {
            id: IDS.layerChar,
            name: '角色',
            source: {
              kind: 'character',
              characterId: IDS.character,
              expressionId: IDS.expressionNormal,
            },
            anchor: 'center',
            x: 500,
            y: 600,
            scaleX: 0.5,
            scaleY: 0.5,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 2,
            locked: false,
            flipX: false,
          },
        ],
        timelineEvents: [],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}
