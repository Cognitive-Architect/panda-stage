import { describe, expect, it } from 'vitest';
import {
  RecentProjectEntrySchema,
  RecentProjectsListRequestSchema,
  RecentProjectsRelocateRequestSchema,
  RecentProjectsRelocateResponseSchema,
} from '../../src/shared/recent-projects-api';
import { ProjectSchema } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('recent projects API contracts', () => {
  it('keeps list requests capability-free and entries strict', () => {
    expect(RecentProjectsListRequestSchema.parse({})).toEqual({});
    expect(
      RecentProjectsListRequestSchema.safeParse({ path: 'C:\\secret' })
        .success,
    ).toBe(false);
    expect(
      RecentProjectEntrySchema.parse({
        projectId: exampleProject.id,
        projectName: '熊猫项目',
        projectRoot: 'D:\\项目.pandastage',
        lastOpenedAt: '2026-07-24T00:00:00.000Z',
        status: 'missing',
      }).status,
    ).toBe('missing');
  });

  it('validates relocation cancellation and relocated documents', () => {
    expect(
      RecentProjectsRelocateRequestSchema.parse({
        projectRoot: 'D:\\missing.pandastage',
      }),
    ).toEqual({ projectRoot: 'D:\\missing.pandastage' });
    expect(
      RecentProjectsRelocateResponseSchema.parse({
        ok: true,
        status: 'cancelled',
      }),
    ).toMatchObject({ ok: true, status: 'cancelled' });
    const project = ProjectSchema.parse(exampleProject);
    expect(
      RecentProjectsRelocateResponseSchema.parse({
        ok: true,
        status: 'relocated',
        document: {
          projectRoot: 'D:\\moved.pandastage',
          projectFilePath: 'D:\\moved.pandastage\\project.json',
          project,
          migrated: false,
          sourceVersion: 1,
        },
        entries: [
          {
            projectId: project.id,
            projectName: project.name,
            projectRoot: 'D:\\moved.pandastage',
            lastOpenedAt: '2026-07-24T00:00:00.000Z',
            status: 'available',
          },
        ],
      }),
    ).toMatchObject({ ok: true, status: 'relocated' });
  });
});
