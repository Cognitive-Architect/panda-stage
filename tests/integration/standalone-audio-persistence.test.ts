import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioClipService, ProjectSchema } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject, IDS } from '../unit/domain/testProject';

const parents: string[] = [];
afterEach(async () => {
  await Promise.all(parents.splice(0).map((parent) => rm(parent, { recursive: true, force: true })));
});

describe('A01 actual ProjectService audio persistence', () => {
  it('saves and reopens bgm/sfx roles and v7 dialogue migration without serializing session state', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-a01-'));
    parents.push(parent);
    const root = path.join(parent, 'audio.pandastage');
    const files = new ProjectService();
    const document = await files.create(root, { name: 'A01' });
    const assetId = '10000000-0000-4000-8000-000000000777';
    const base = buildProject();
    let project = ProjectSchema.parse({ ...base, id: document.project.id,
      assets: [...base.assets, { id: assetId, name: 'sound', kind: 'audio',
        relativePath: 'assets/sound.wav', mimeType: 'audio/wav', durationMs: 2000,
        metadata: { status: 'ready', warnings: [] },
      }],
    });
    const service = new AudioClipService();
    project = service.create(project, { shotId: IDS.shot, assetId, role: 'bgm', startMs: 0 });
    project = service.create(project, { shotId: IDS.shot, assetId, role: 'sfx', startMs: 700 });
    project = service.setVolume(project, { shotId: IDS.shot, clipId: project.shots[0]!.audioClips[1]!.id, volume: 1.8 });
    await files.save(root, project, 1);
    const reopened = await files.open(root);
    expect(reopened.project.shots[0]!.audioClips).toEqual(project.shots[0]!.audioClips);
    const text = await readFile(path.join(root, 'project.json'), 'utf8');
    expect(text).not.toMatch(/selectedAudioClipId|undoCount|history/u);
    const legacy = { ...project, schemaVersion: 7, shots: project.shots.map((shot) => ({ ...shot,
      audioClips: shot.audioClips.map(({ role, ...clip }) => { void role; return clip; }),
    })) };
    await writeFile(path.join(root, 'project.json'), JSON.stringify(legacy), 'utf8');
    const migrated = await files.open(root);
    expect(migrated.sourceVersion).toBe(7);
    expect(migrated.migrated).toBe(true);
    expect(migrated.project.schemaVersion).toBe(8);
    expect(migrated.project.shots[0]!.audioClips).toEqual(legacy.shots[0]!.audioClips.map((clip) => ({ ...clip, role: 'dialogue' })));
    await files.save(root, migrated.project, 2);
    expect((await files.open(root)).project).toEqual(migrated.project);
  });
});
