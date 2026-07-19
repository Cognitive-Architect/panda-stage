import { describe, expect, it } from 'vitest';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
} from '../../src/shared/domain';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const ASSET_ID = '00000000-0000-4000-8000-000000000002';
const SHOT_ID = '00000000-0000-4000-8000-000000000003';
const LAYER_ID = '00000000-0000-4000-8000-000000000004';
const EVENT_ID = '00000000-0000-4000-8000-000000000005';

function createProjectInput(): unknown {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: PROJECT_ID,
    name: 'Day 02 Schema Fixture',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: [
      {
        id: ASSET_ID,
        kind: 'image',
        name: 'Character',
        relativePath: 'assets/character.png',
        mimeType: 'image/png',
        width: 512,
        height: 512,
      },
    ],
    shots: [
      {
        id: SHOT_ID,
        name: 'Opening',
        durationMs: 2_000,
        layers: [
          {
            id: LAYER_ID,
            assetId: ASSET_ID,
            name: 'Lead character',
            anchor: 'center',
            x: 240,
            y: 540,
            zIndex: 0,
          },
        ],
        timelineEvents: [
          {
            id: EVENT_ID,
            type: 'move',
            layerId: LAYER_ID,
            startMs: 250,
            durationMs: 1_000,
            from: { x: 240, y: 540 },
            to: { x: 1_680, y: 540 },
            easing: 'linear',
          },
        ],
      },
    ],
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('ProjectSchema', () => {
  it('parses a serializable project with fixed video constants', () => {
    const project = ProjectSchema.parse(createProjectInput());

    expect(project).toMatchObject({
      schemaVersion: 1,
      width: 1920,
      height: 1080,
      fps: 24,
    });
    expect(project.shots[0]?.layers[0]).toMatchObject({
      anchor: 'center',
      x: 240,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
    });
    const serializedProject = JSON.stringify(project);
    expect(ProjectSchema.parse(JSON.parse(serializedProject))).toEqual(project);
  });

  it.each([
    ['width', 1280],
    ['height', 720],
    ['fps', 30],
    ['schemaVersion', 2],
  ])('rejects an unsupported %s', (field, value) => {
    const input = createProjectInput() as Record<string, unknown>;
    input[field] = value;

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });

  it('rejects fractional millisecond fields', () => {
    const input = createProjectInput() as {
      shots: Array<{ timelineEvents: Array<{ startMs: number }> }>;
    };
    input.shots[0]!.timelineEvents[0]!.startMs = 250.5;

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });

  it('rejects events that reference an unknown layer', () => {
    const input = createProjectInput() as {
      shots: Array<{
        timelineEvents: Array<{ layerId: string }>;
      }>;
    };
    input.shots[0]!.timelineEvents[0]!.layerId =
      '00000000-0000-4000-8000-000000000099';

    const result = ProjectSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('unknown layer'),
          }),
        ]),
      );
    }
  });

  it('rejects project-external asset paths', () => {
    const input = createProjectInput() as {
      assets: Array<{ relativePath: string }>;
    };
    input.assets[0]!.relativePath = '../outside/character.png';

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });
});
