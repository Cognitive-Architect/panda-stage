import { describe, expect, it } from 'vitest';
import {
  PROJECT_NAME_MAX_LENGTH,
  ProjectCreateAtRequestSchema,
  ProjectCreateRequestSchema,
  ProjectOpenRequestSchema,
  ProjectOperationResponseSchema,
  ProjectSaveRequestSchema,
  projectNameIssue,
} from '../../src/shared/project-api';
import { ProjectSchema } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

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

  it('accepts a create-at request that submits only the path parts', () => {
    expect(
      ProjectCreateAtRequestSchema.parse({
        parentDirectory: 'D:\\作品',
        projectName: '短片',
        metadata: { name: '短片' },
      }),
    ).toEqual({
      parentDirectory: 'D:\\作品',
      projectName: '短片',
      metadata: { name: '短片' },
    });
  });

  it('refuses a create-at request that carries an assembled project root', () => {
    expect(
      ProjectCreateAtRequestSchema.safeParse({
        parentDirectory: 'D:\\作品',
        projectName: '短片',
        metadata: { name: '短片' },
        projectRoot: 'D:\\作品\\短片.pandastage',
      }).success,
    ).toBe(false);
    expect(
      ProjectCreateAtRequestSchema.safeParse({
        parentDirectory: 'D:\\作品',
        metadata: { name: '短片' },
      }).success,
    ).toBe(false);
  });

  it('rejects every project name that is not a single safe directory component', () => {
    for (const projectName of [
      '',
      '   ',
      '..',
      '.',
      '..\\..\\系统',
      '子目录/短片',
      '子目录\\短片',
      '短片<1>',
      '短片:1',
      'CON',
      'lpt9',
      '短片.',
      '短片 .',
      '短片.pandastage',
      'x'.repeat(PROJECT_NAME_MAX_LENGTH + 1),
    ]) {
      expect(projectNameIssue(projectName)).not.toBeNull();
      expect(
        ProjectCreateAtRequestSchema.safeParse({
          parentDirectory: 'D:\\作品',
          projectName,
          metadata: { name: '短片' },
        }).success,
      ).toBe(false);
    }
    for (const projectName of [
      '短片',
      '熊猫 项目 🐼',
      'my-project_01',
      // Surrounding whitespace is trimmed, not rejected.
      '  短片  ',
      'x'.repeat(PROJECT_NAME_MAX_LENGTH),
    ]) {
      expect(projectNameIssue(projectName)).toBeNull();
      expect(
        ProjectCreateAtRequestSchema.parse({
          parentDirectory: 'D:\\作品',
          projectName,
          metadata: { name: '短片' },
        }).projectName,
      ).toBe(projectName.trim());
    }
  });

  it('reports the first violated project-name rule by code', () => {
    expect(projectNameIssue('  ')).toBe('EMPTY');
    expect(projectNameIssue('a/b')).toBe('PATH_SEPARATOR');
    expect(projectNameIssue('..')).toBe('RELATIVE_SEGMENT');
    expect(projectNameIssue('a|b')).toBe('INVALID_CHARACTER');
    expect(projectNameIssue('nul')).toBe('RESERVED_DEVICE_NAME');
    expect(projectNameIssue('demo.')).toBe('TRAILING_DOT_OR_SPACE');
    expect(projectNameIssue('demo.pandastage')).toBe('REDUNDANT_EXTENSION');
    expect(projectNameIssue('y'.repeat(PROJECT_NAME_MAX_LENGTH + 1))).toBe(
      'TOO_LONG',
    );
  });

  it('rejects an invalid save payload before it reaches the main service', () => {
    expect(
      ProjectSaveRequestSchema.safeParse({
        projectRoot: 'project.pandastage',
        project: { schemaVersion: 99 },
      }).success,
    ).toBe(false);
  });

  it('requires the editor revision on a valid formal save request', () => {
    const project = ProjectSchema.parse(exampleProject);
    expect(
      ProjectSaveRequestSchema.safeParse({
        projectRoot: 'project.pandastage',
        project,
      }).success,
    ).toBe(false);
    expect(
      ProjectSaveRequestSchema.parse({
        projectRoot: 'project.pandastage',
        project,
        revision: 4,
      }),
    ).toBeTruthy();
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
