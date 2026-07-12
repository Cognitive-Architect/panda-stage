import { describe, it, expect } from 'vitest';
import type { Project } from '../../shared/types';
import { ProjectSchema } from '../../shared/types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, FPS } from '../../shared/constants';

// ─── Simple migration utility for testing ───

interface LegacyV0Project {
  id?: string;
  title?: string;
  width?: number;
  height?: number;
  fps?: number;
  assets?: unknown[];
  characters?: unknown[];
  voiceProfiles?: unknown[];
  subtitleStyles?: unknown[];
  shots?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

export function migrateV0ToV1(raw: unknown): Project {
  if (raw === null || raw === undefined) {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: '00000000-0000-0000-0000-000000000000',
      title: 'Untitled Project',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: FPS,
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  const legacy = raw as LegacyV0Project;
  const now = new Date().toISOString();

  // Ensure id is a valid UUID; fallback if not
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const id = legacy.id && uuidRegex.test(legacy.id) ? legacy.id : '00000000-0000-0000-0000-000000000000';

  const migrated: Project = {
    schemaVersion: 1,
    id,
    title: legacy.title ?? 'Untitled Project',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: FPS,
    assets: Array.isArray(legacy.assets) ? legacy.assets as Project['assets'] : [],
    characters: Array.isArray(legacy.characters) ? legacy.characters as Project['characters'] : [],
    voiceProfiles: Array.isArray(legacy.voiceProfiles) ? legacy.voiceProfiles as Project['voiceProfiles'] : [],
    subtitleStyles: Array.isArray(legacy.subtitleStyles) ? legacy.subtitleStyles as Project['subtitleStyles'] : [],
    shots: Array.isArray(legacy.shots) ? legacy.shots as Project['shots'] : [],
    createdAt: legacy.createdAt ?? now,
    updatedAt: legacy.updatedAt ?? now,
  };

  return migrated;
}

export function validateProject(data: unknown): { success: true; project: Project } | { success: false; errors: string[] } {
  const result = ProjectSchema.safeParse(data);
  if (result.success) {
    return { success: true, project: result.data };
  }
  return { success: false, errors: result.error.issues.map(i => i.message) };
}

// ─── Tests ───

describe('project migration', () => {
  it('migrates an empty legacy project to schemaVersion 1', () => {
    const legacy = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Old Project',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.title).toBe('Old Project');
    expect(migrated.width).toBe(CANVAS_WIDTH);
    expect(migrated.height).toBe(CANVAS_HEIGHT);
    expect(migrated.fps).toBe(FPS);
    expect(migrated.assets).toEqual([]);
    expect(migrated.shots).toEqual([]);
  });

  it('fills missing fields with defaults during migration', () => {
    const legacy = {};

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.id).toBeDefined();
    expect(migrated.title).toBe('Untitled Project');
    expect(migrated.width).toBe(CANVAS_WIDTH);
    expect(migrated.height).toBe(CANVAS_HEIGHT);
    expect(migrated.fps).toBe(FPS);
    expect(migrated.assets).toEqual([]);
    expect(migrated.characters).toEqual([]);
    expect(migrated.voiceProfiles).toEqual([]);
    expect(migrated.subtitleStyles).toEqual([]);
    expect(migrated.shots).toEqual([]);
    expect(migrated.createdAt).toBeDefined();
    expect(migrated.updatedAt).toBeDefined();
  });

  it('preserves existing arrays during migration', () => {
    const legacy = {
      assets: [{ id: '550e8400-e29b-41d4-a716-446655440001', type: 'image', name: 'test.png', relativePath: 'assets/test.png' }],
      shots: [{ id: '550e8400-e29b-41d4-a716-446655440002', name: 'Intro', durationMs: 5000 }],
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.assets).toHaveLength(1);
    expect(migrated.shots).toHaveLength(1);
  });

  it('validates a correctly structured project', () => {
    const now = new Date().toISOString();
    const project: Project = {
      schemaVersion: 1,
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Valid Project',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: FPS,
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = validateProject(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.title).toBe('Valid Project');
    }
  });

  it('rejects project with wrong schemaVersion', () => {
    const now = new Date().toISOString();
    const invalid = {
      schemaVersion: 2, // Invalid: should be 1
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Invalid',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: FPS,
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = validateProject(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects project with missing required fields', () => {
    const incomplete = {
      schemaVersion: 1,
      id: '550e8400-e29b-41d4-a716-446655440003',
      // Missing title, width, height, fps, etc.
    };

    const result = validateProject(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects project with invalid width/height', () => {
    const now = new Date().toISOString();
    const wrongSize = {
      schemaVersion: 1,
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Wrong Size',
      width: 1280, // Invalid: should be 1920
      height: 720, // Invalid: should be 1080
      fps: FPS,
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = validateProject(wrongSize);
    expect(result.success).toBe(false);
  });

  it('rejects project with invalid fps', () => {
    const now = new Date().toISOString();
    const wrongFps = {
      schemaVersion: 1,
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Wrong FPS',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: 30, // Invalid: should be 24
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = validateProject(wrongFps);
    expect(result.success).toBe(false);
  });

  it('round-trips a project through migration and validation', () => {
    const legacy = {
      id: '550e8400-e29b-41d4-a716-446655440004',
      title: 'Legacy Project',
      assets: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'image',
          name: 'bg.png',
          relativePath: 'assets/bg.png',
        },
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const migrated = migrateV0ToV1(legacy);
    const validated = validateProject(migrated);
    expect(validated.success).toBe(true);
  });

  it('handles null/undefined input gracefully', () => {
    const migrated = migrateV0ToV1(null);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.title).toBe('Untitled Project');
  });
});

// ─── Asset Migration Tests ───

describe('asset migration', () => {
  it('preserves asset type and path during migration', () => {
    const legacy = {
      assets: [
        { id: '550e8400-e29b-41d4-a716-446655440005', type: 'image', name: 'bg.png', relativePath: 'assets/bg.png' },
        { id: '550e8400-e29b-41d4-a716-446655440006', type: 'audio', name: 'dialogue.mp3', relativePath: 'assets/dialogue.mp3' },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.assets).toHaveLength(2);
    expect(migrated.assets[0].type).toBe('image');
    expect(migrated.assets[1].type).toBe('audio');
  });
});

// ─── Shot Migration Tests ───

describe('shot migration', () => {
  it('preserves shot duration and layers', () => {
    const legacy = {
      shots: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Opening',
          durationMs: 5000,
          layers: [
            {
              id: '550e8400-e29b-41d4-a716-446655440007',
              type: 'character',
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              opacity: 1,
              flipX: false,
              zIndex: 0,
              visible: true,
              locked: false,
            },
          ],
          dialogues: [],
          audioClips: [],
          events: [],
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.shots).toHaveLength(1);
    expect(migrated.shots[0].durationMs).toBe(5000);
    expect(migrated.shots[0].layers).toHaveLength(1);
  });
});

// ─── Dialogue Migration Tests ───

describe('dialogue migration', () => {
  it('preserves dialogue text and timing', () => {
    const legacy = {
      shots: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Scene 1',
          durationMs: 10000,
          layers: [],
          dialogues: [
            {
              id: '550e8400-e29b-41d4-a716-446655440008',
              characterId: 'char-1',
              text: 'Hello 世界',
              startMs: 1000,
              durationMs: 3000,
              volume: 1,
              subtitleEnabled: true,
            },
          ],
          audioClips: [],
          events: [],
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    const dialogue = migrated.shots[0].dialogues[0];
    expect(dialogue.text).toBe('Hello 世界');
    expect(dialogue.startMs).toBe(1000);
    expect(dialogue.durationMs).toBe(3000);
    expect(dialogue.subtitleEnabled).toBe(true);
  });
});

// ─── Event Migration Tests ───

describe('event migration', () => {
  it('preserves event order and payload', () => {
    const legacy = {
      shots: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Scene',
          durationMs: 5000,
          layers: [],
          dialogues: [],
          audioClips: [],
          events: [
            {
              id: '550e8400-e29b-41d4-a716-446655440009',
              targetLayerId: 'layer-1',
              type: 'move',
              startMs: 0,
              endMs: 1000,
              easing: 'ease-in-out',
              payload: { toX: 500, toY: 300 },
              order: 1,
            },
          ],
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    const event = migrated.shots[0].events[0];
    expect(event.type).toBe('move');
    expect(event.order).toBe(1);
    expect(event.easing).toBe('ease-in-out');
    expect((event as Record<string, unknown>).payload).toEqual({ toX: 500, toY: 300 });
  });
});

// ─── Chinese Path Compatibility ───

describe('Chinese path compatibility', () => {
  it('handles Chinese characters in project title', () => {
    const legacy = {
      title: '中文项目测试',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.title).toBe('中文项目测试');
  });

  it('handles Chinese characters in asset names', () => {
    const legacy = {
      assets: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          type: 'image',
          name: '背景.png',
          relativePath: 'assets/背景.png',
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.assets[0].name).toBe('背景.png');
    expect(migrated.assets[0].relativePath).toBe('assets/背景.png');
  });

  it('handles Chinese characters in dialogue text', () => {
    const legacy = {
      shots: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Scene',
          durationMs: 5000,
          layers: [],
          dialogues: [
            {
              id: '550e8400-e29b-41d4-a716-446655440008',
              characterId: 'char-1',
              text: '你好，世界！这是熊猫舞台。',
              startMs: 0,
              durationMs: 3000,
              volume: 1,
              subtitleEnabled: true,
            },
          ],
          audioClips: [],
          events: [],
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    expect(migrated.shots[0].dialogues[0].text).toBe('你好，世界！这是熊猫舞台。');
  });
});

// ─── Edge Case Tests ───

describe('migration edge cases', () => {
  it('handles shot with zero duration gracefully', () => {
    const legacy = {
      shots: [
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          name: 'Empty',
          durationMs: 0,
          layers: [],
          dialogues: [],
          audioClips: [],
          events: [],
        },
      ],
    };

    const migrated = migrateV0ToV1(legacy);
    // Note: zod schema requires durationMs >= 500, so this will fail validation
    const validated = validateProject(migrated);
    expect(validated.success).toBe(false);
  });

  it('handles deeply nested or circular references without crashing', () => {
    const legacy: Record<string, unknown> = {};
    legacy.self = legacy; // Circular reference

    // Should not throw
    expect(() => migrateV0ToV1(legacy)).not.toThrow();
  });

  it('handles arrays with mixed types gracefully', () => {
    const legacy = {
      assets: [
        { id: '550e8400-e29b-41d4-a716-446655440001', type: 'image', name: 'test.png', relativePath: 'assets/test.png' },
        'invalid-string',
        null,
      ],
    };

    // Should not throw, but may produce invalid data
    expect(() => migrateV0ToV1(legacy)).not.toThrow();
    const migrated = migrateV0ToV1(legacy);
    expect(migrated.assets).toHaveLength(3);
  });
});
