import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('image author metadata persistence', () => {
  it('survives project save and reopen with audio and FLA source data intact', async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), 'panda-issue825-asset-metadata-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'project.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'Asset author metadata',
    });
    const image = {
      id: randomUUID(),
      kind: 'image' as const,
      name: '木门·关闭',
      relativePath: 'assets/door.png',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      sha256: 'a'.repeat(64),
      usage: 'prop' as const,
      keywords: ['门', '关闭'],
      flaSnapshot: {
        sourceBasename: 'doors.fla',
        sourceSha256: 'b'.repeat(64),
        targetName: 'DoorClosed',
        renderTargetId: 'target-door-closed',
        selectedFrameIndex: 2,
        previewSha256: 'a'.repeat(64),
      },
    };
    const audio = {
      id: randomUUID(),
      kind: 'audio' as const,
      name: 'Room tone',
      relativePath: 'assets/room.wav',
      mimeType: 'audio/wav',
      durationMs: 1200,
    };
    const project = { ...created.project, assets: [image, audio] };

    await projectService.save(projectRoot, project, 1);
    const reopened = await projectService.open(projectRoot);
    const serialized = JSON.parse(
      await readFile(path.join(projectRoot, 'project.json'), 'utf8'),
    ) as { schemaVersion: number };

    expect(reopened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.project.assets).toEqual([image, audio]);
    expect(reopened.migrated).toBe(false);
    expect(serialized.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });
});
