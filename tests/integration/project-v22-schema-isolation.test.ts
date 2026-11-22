import { expect, it, vi } from 'vitest';
import { migrateProject, PROJECT_SCHEMA_VERSION, ProjectSchema, ProjectV22Schema } from '../../src/domain';
import fixture from '../fixtures/project-v22-mixed-character-motion.json';
import { IDS } from '../unit/domain/testProject';

// Exercise the real reader composition with a simulated addition to each current export.
vi.mock('../../src/domain/models/character', async (importOriginal) => {
  const { z } = await import('zod');
  const actual = await importOriginal<typeof import('../../src/domain/models/character')>();
  const [singleImage] = actual.CharacterSchema.options;
  return {
    ...actual,
    CharacterSchema: z.union([actual.CharacterSchema, singleImage.extend({ label: z.string() })]),
  };
});

vi.mock('../../src/domain/models/timeline-event', async (importOriginal) => {
  const { z } = await import('zod');
  const actual = await importOriginal<typeof import('../../src/domain/models/timeline-event')>();
  return {
    ...actual,
    TimelineEventSchema: z.union([
      actual.TimelineEventSchema,
      actual.VisibilityEventSchema.extend({ label: z.string() }),
    ]),
  };
});

it.each(['character', 'timeline event'])('keeps a future current %s field out of v22 (#1157)', (kind) => {
  const project = ProjectV22Schema.parse(fixture);
  if (kind === 'character') {
    Object.assign(project.characters[0]!, { label: 'Current-only' });
  } else {
    const event = {
      id: '93000000-0000-4000-8000-000000001157', layerId: IDS.layerChar,
      type: 'visibility' as const, startMs: 750, endMs: 1000, visible: false,
      label: 'Current-only',
    };
    project.shots[0]!.timelineEvents.push(event);
  }
  const current = { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
  expect(ProjectSchema.parse(current)).toStrictEqual(current);
  expect(ProjectV22Schema.safeParse(project).success).toBe(false);
  expect(() => migrateProject(project)).toThrow();
});
