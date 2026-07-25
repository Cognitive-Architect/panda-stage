import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  projectDurationMs,
  ProjectSchema,
  ShotService,
} from '../../src/domain';

describe('projectDurationMs', () => {
  it('returns zero for no shots and the exact ordered-shot duration sum', () => {
    const empty = ProjectSchema.parse({
      ...exampleProject,
      shots: [],
    });
    const service = new ShotService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2010000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
    });
    const one = service.create(empty, { name: 'A', durationMs: 500 });
    const two = service.create(one, { name: 'B', durationMs: 1_501 });

    expect(projectDurationMs(empty)).toBe(0);
    expect(projectDurationMs(two)).toBe(2_001);
  });
});
