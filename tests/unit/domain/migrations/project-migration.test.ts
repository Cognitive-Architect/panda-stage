import { describe, expect, it } from 'vitest';
import { migrateProject, ProjectSchema, type Project } from '../../../../src/domain';

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
    expect(result.schemaVersion).toBe(5);
    expect(result.shots.length).toBeGreaterThan(0);
    for (const shot of result.shots) {
      expect(Array.isArray(shot.timelineEvents)).toBe(true);
      expect(shot.timelineEvents).toEqual([]);
    }
  });

  it('v2 旧项目（缺 timelineEvents）可被打开且结果含空数组', () => {
    const result = migrateProject(v2WithoutTimelineEvents()) as Project;
    expect(result.schemaVersion).toBe(5);
    for (const shot of result.shots) {
      expect(Array.isArray(shot.timelineEvents)).toBe(true);
      expect(shot.timelineEvents).toEqual([]);
    }
  });

  it('迁移结果通过严格 ProjectDataSchema 校验', () => {
    const result = migrateProject(v1WithoutTimelineEvents());
    expect(() => ProjectSchema.parse(result)).not.toThrow();
  });
});
