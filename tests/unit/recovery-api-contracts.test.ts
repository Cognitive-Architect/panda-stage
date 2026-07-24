import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  AutosaveTrackRequestSchema,
  RecoveryEnvelopeSchema,
} from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('recovery API contracts', () => {
  const project = ProjectSchema.parse(exampleProject);

  it('requires integer timestamps and a matching project identity', () => {
    expect(
      RecoveryEnvelopeSchema.parse({
        schemaVersion: 1,
        projectId: project.id,
        savedAtMs: 1_700_000_000_000,
        project,
      }),
    ).toBeTruthy();
    expect(
      RecoveryEnvelopeSchema.safeParse({
        schemaVersion: 1,
        projectId: '99000000-0000-4000-8000-000000000001',
        savedAtMs: 1_700_000_000_000.5,
        project,
      }).success,
    ).toBe(false);
  });

  it('strictly validates autosave dirty state and revision', () => {
    expect(
      AutosaveTrackRequestSchema.parse({
        projectRoot: 'D:\\project.pandastage',
        project,
        dirty: true,
        revision: 3,
      }),
    ).toBeTruthy();
    expect(
      AutosaveTrackRequestSchema.safeParse({
        projectRoot: 'D:\\project.pandastage',
        project,
        dirty: true,
        revision: -1,
        intervalMs: 1,
      }).success,
    ).toBe(false);
  });
});
