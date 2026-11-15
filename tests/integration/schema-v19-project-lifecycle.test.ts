import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogueService } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { ProjectOperationResponseSchema } from '../../src/shared/project-api';
import historicalV18 from '../fixtures/project-v18-character-dialogue.json';

const parents: string[] = [];
afterEach(async () => {
  await Promise.all(parents.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('v19 file lifecycle (#1111)', () => {
  it('opens an actual v18 writer fixture, saves narrator v19 and reopens losslessly', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v19-'));
    parents.push(parent);
    const root = path.join(parent, 'project.pandastage');
    await mkdir(root);
    const file = path.join(root, 'project.json');
    const serialized = JSON.stringify(historicalV18);
    await writeFile(file, serialized, 'utf8');
    const service = new ProjectService();
    const opened = await service.open(root);
    expect(opened.sourceVersion).toBe(18);
    expect(opened.migrated).toBe(true);
    expect(opened.project).toEqual({ ...historicalV18, schemaVersion: 19 });
    expect(ProjectOperationResponseSchema.safeParse({ ok: true, value: opened }).success).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(serialized);
    await service.save(root, opened.project, 1);
    let project = new DialogueService().create(opened.project, {
      shotId: opened.project.shots[0]!.id,
      speakerType: 'narrator', text: 'Narration in v19', pointTimeMs: 1600,
    });
    project = new DialogueService().setTiming(project, {
      shotId: project.shots[0]!.id, dialogueId: project.shots[0]!.dialogues[1]!.id,
      startMs: 1600, endMs: 2000,
    });
    await service.save(root, project, 2);
    const reopened = await new ProjectService().open(root);
    expect(reopened.sourceVersion).toBe(19);
    expect(reopened.migrated).toBe(false);
    expect(reopened.project).toEqual(project);
    const narrator = reopened.project.shots[0]!.dialogues[1]!;
    expect(narrator.speakerType).toBe('narrator');
    expect(narrator.characterId).toBeUndefined();
    expect(narrator.voiceProfileId).toBeUndefined();
    expect(reopened.project.shots[0]!.dialogues[0]).toEqual(historicalV18.shots[0]!.dialogues[0]);
  });
});
