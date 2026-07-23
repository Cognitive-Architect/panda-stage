import { describe, expect, it } from 'vitest';
import {
  ProjectCreateRequestSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
} from '../../src/shared/project-api';

describe('project API contracts', () => {
  it('accepts only the explicit create and open request shapes', () => {
    expect(
      ProjectCreateRequestSchema.parse({
        projectRoot: 'D:\\作品\\短片.pandastage',
        metadata: { name: '短片' },
      }),
    ).toBeTruthy();
    expect(
      ProjectOpenRequestSchema.safeParse({
        projectRoot: 'D:\\作品\\短片.pandastage',
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid save payload before it reaches the main service', () => {
    expect(
      ProjectSaveRequestSchema.safeParse({
        projectRoot: 'project.pandastage',
        project: { schemaVersion: 99 },
      }).success,
    ).toBe(false);
  });

  it('validates standardized operation errors', () => {
    expect(
      ProjectOperationResponseSchema.parse({
        ok: false,
        error: {
          code: 'PROJECT_NOT_WRITABLE',
          message: 'The project directory is not writable.',
          projectRoot: 'D:\\作品\\短片.pandastage',
        },
      }),
    ).toBeTruthy();
  });

  it('exposes a distinct project identity mismatch error', () => {
    expect(
      ProjectOperationResponseSchema.parse({
        ok: false,
        error: {
          code: 'PROJECT_ID_MISMATCH',
          message:
            'Project identity mismatch between the target and incoming project.',
          projectRoot: 'D:\\作品\\短片.pandastage',
        },
      }),
    ).toBeTruthy();
  });
});
