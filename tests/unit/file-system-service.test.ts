import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLEANUP_MAX_RETRIES,
  CLEANUP_RETRY_DELAY_MS,
  FileSystemService,
} from '../../src/main/services/FileSystemService';

describe('FileSystemService Unicode paths and cleanup', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('writes in a Unicode root and cleans the same Job idempotently', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-day09-'));
    temporaryRoots.push(parent);
    const unicodeRoot = path.join(parent, '熊猫 临时帧 🐼');
    const projectDirectory = path.join(parent, '项目 空格 🎬');
    await mkdir(projectDirectory, { recursive: true });
    const service = new FileSystemService(unicodeRoot);
    const jobDirectory = await service.createJobDirectory(randomUUID());

    await service.writeFrame(
      jobDirectory,
      'frame_000000.png',
      new Uint8Array([137, 80, 78, 71, 1]),
    );
    expect(await service.listFrameFiles(jobDirectory)).toEqual([
      'frame_000000.png',
    ]);
    expect(await service.assertReadableProjectDirectory(projectDirectory)).toBe(
      path.resolve(projectDirectory),
    );

    await service.cleanupJobDirectory(jobDirectory);
    await service.cleanupJobDirectory(jobDirectory);
    expect(await readdir(unicodeRoot)).toEqual([]);
  });

  it('uses a finite Windows lock retry policy', () => {
    expect(CLEANUP_MAX_RETRIES).toBe(3);
    expect(CLEANUP_RETRY_DELAY_MS).toBe(75);
  });
});
