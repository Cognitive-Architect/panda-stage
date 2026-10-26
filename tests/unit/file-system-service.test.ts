import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLEANUP_MAX_RETRIES,
  CLEANUP_RETRY_DELAY_MS,
  FileSystemService,
  isWithinWindowsFormalExportPathLimit,
} from '../../src/main/services/FileSystemService';
import { formatFrameFileName } from '../../src/shared/export-types';

describe('FileSystemService Unicode paths and cleanup', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('checks the 259-character Windows formal-output and staging-path boundaries', () => {
    const stagingAtLimitDirectory = `C:\\${'a'.repeat(158)}`;
    const stagingOverLimitDirectory = `C:\\${'a'.repeat(159)}`;
    expect(
      isWithinWindowsFormalExportPathLimit(
        path.win32.join(stagingAtLimitDirectory, 'out.mp4'),
      ),
    ).toBe(true);
    expect(
      isWithinWindowsFormalExportPathLimit(
        path.win32.join(stagingOverLimitDirectory, 'out.mp4'),
      ),
    ).toBe(false);

    const shortStagingDirectory = `C:\\${'b'.repeat(100)}`;
    expect(
      path.win32.join(
        shortStagingDirectory,
        `${'x'.repeat(151)}.mp4`,
      ).length,
    ).toBe(259);
    expect(
      isWithinWindowsFormalExportPathLimit(
        path.win32.join(shortStagingDirectory, `${'x'.repeat(151)}.mp4`),
      ),
    ).toBe(true);
    expect(
      path.win32.join(
        shortStagingDirectory,
        `${'x'.repeat(152)}.mp4`,
      ).length,
    ).toBe(260);
    expect(
      isWithinWindowsFormalExportPathLimit(
        path.win32.join(shortStagingDirectory, `${'x'.repeat(152)}.mp4`),
      ),
    ).toBe(false);
  });

  it('suggests the next unused same-name MP4 without touching existing outputs', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-export-name-'),
    );
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'frames'));
    const outputPath = path.join(parent, 'Scene.mp4');

    await expect(service.suggestFormalOutputPath(outputPath)).resolves.toBe(
      outputPath,
    );
    await writeFile(outputPath, 'first export', 'utf8');
    const secondOutputPath = path.join(parent, 'Scene (2).mp4');
    await expect(service.suggestFormalOutputPath(outputPath)).resolves.toBe(
      secondOutputPath,
    );
    await writeFile(secondOutputPath, 'second export', 'utf8');

    await expect(service.suggestFormalOutputPath(outputPath)).resolves.toBe(
      path.join(parent, 'Scene (3).mp4'),
    );
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('first export');
    await expect(readFile(secondOutputPath, 'utf8')).resolves.toBe(
      'second export',
    );
  });

  it('writes in a Unicode root and cleans the same Job idempotently', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-day09-'));
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

  it('writes canonical six- and seven-digit frames and lists them by numeric index', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-frame-sequence-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'jobs'));
    const jobDirectory = await service.createJobDirectory(randomUUID());
    const frames = [
      { index: 1_000_000, bytes: new Uint8Array([10, 11, 12]) },
      { index: 999_999, bytes: new Uint8Array([7, 8, 9]) },
      { index: 1_999_999, bytes: new Uint8Array([13, 14, 15]) },
      { index: 0, bytes: new Uint8Array([1, 2, 3]) },
    ];

    for (const frame of frames) {
      const fileName = formatFrameFileName(frame.index);
      await service.writeFrame(jobDirectory, fileName, frame.bytes);
      expect(
        new Uint8Array(await readFile(path.join(jobDirectory, fileName))),
      ).toEqual(frame.bytes);
    }

    await writeFile(path.join(jobDirectory, 'frame_000042.png.tmp'), 'temporary');
    await mkdir(path.join(jobDirectory, 'frame_000043.png'));

    await expect(service.listFrameFiles(jobDirectory)).resolves.toEqual([
      'frame_000000.png',
      'frame_999999.png',
      'frame_1000000.png',
      'frame_1999999.png',
    ]);

    await expect(
      service.writeFrame(
        jobDirectory,
        'frame_000000.png',
        new Uint8Array([99]),
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(
      new Uint8Array(
        await readFile(path.join(jobDirectory, 'frame_000000.png')),
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));

    for (const fileName of [
      '../frame_000004.png',
      'frame_000004.jpg',
      'frame_00004.png',
      'frame_000004.png/child',
      'frame_000004.png\\child',
      'frame_000004.png\n',
      'frame_0000000.png',
    ]) {
      await expect(
        service.writeFrame(jobDirectory, fileName, new Uint8Array([0])),
      ).rejects.toThrow('Invalid frame file name:');
    }

    await expect(
      service.writeFrame(
        parent,
        'frame_000004.png',
        new Uint8Array([0]),
      ),
    ).rejects.toThrow('Path escapes the frame-job root:');
  });

  it('writes only named frozen audio media inside the owned Job directory', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-audio-job-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'jobs'));
    const jobDirectory = await service.createJobDirectory(randomUUID());
    const assetId = '10000000-0000-4000-8000-000000000821';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const audioPath = await service.writeFrozenAudio(
      jobDirectory,
      `audio-${assetId}.wav`,
      bytes,
    );

    expect(audioPath).toBe(path.join(jobDirectory, `audio-${assetId}.wav`));
    expect(new Uint8Array(await readFile(audioPath))).toEqual(bytes);
    await expect(
      service.writeFrozenAudio(jobDirectory, '../outside.wav', bytes),
    ).rejects.toThrow('Invalid frozen audio file name.');
    await expect(
      service.writeFrozenAudio(jobDirectory, `audio-${assetId}.wav`, bytes),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('uses a finite Windows lock retry policy', () => {
    expect(CLEANUP_MAX_RETRIES).toBe(3);
    expect(CLEANUP_RETRY_DELAY_MS).toBe(75);
  });

  it('commits a same-directory Job staging file without pre-deleting the formal output', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-day09-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'frames'));
    const outputPath = path.join(parent, '正式 输出.MP4');
    await writeFile(outputPath, 'old video', 'utf8');
    await expect(service.prepareFinalOutput(outputPath, false)).rejects.toThrow(
      /正式输出已存在且未允许覆盖/,
    );
    await expect(service.prepareFinalOutput(outputPath, true)).resolves.toBe(
      path.resolve(outputPath),
    );
    const jobId = randomUUID();
    const stagingPath = service.createFinalOutputStagingPath(jobId, outputPath);

    expect(path.dirname(stagingPath)).toBe(path.dirname(outputPath));
    expect(path.basename(stagingPath)).toContain(jobId);
    expect(path.basename(stagingPath)).toMatch(
      /^\.panda-stage-export-[0-9a-f-]+-[0-9a-f-]+\.mp4$/iu,
    );
    expect(stagingPath.toLowerCase().endsWith('.mp4')).toBe(true);
    await writeFile(stagingPath, 'new video', 'utf8');
    await service.commitFinalOutput(stagingPath, outputPath, true);

    await expect(readFile(outputPath, 'utf8')).resolves.toBe('new video');
    await expect(stat(stagingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await service.cleanupFinalOutputStaging(stagingPath);
  });

  it('formally commits a new target with an exclusive same-directory hard link', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-no-clobber-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'frames'), {
      inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
    });
    const outputPath = path.join(parent, 'new-output.mp4');
    const stagingPath = service.createFinalOutputStagingPath(randomUUID(), outputPath);
    await writeFile(stagingPath, 'verified export', 'utf8');

    await expect(service.prepareFormalOutput(outputPath)).resolves.toBe(path.resolve(outputPath));
    await service.commitFormalOutputNoReplace(stagingPath, outputPath);

    await expect(readFile(outputPath, 'utf8')).resolves.toBe('verified export');
    await expect(stat(stagingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(parent)).resolves.toEqual(['new-output.mp4']);
  });

  it('preserves a file created after preflight when the exclusive commit meets a name conflict', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-race-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'frames'), {
      inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
    });
    const outputPath = path.join(parent, 'raced-output.mp4');
    const stagingPath = service.createFinalOutputStagingPath(randomUUID(), outputPath);
    const externalBytes = Buffer.from('third-party output');
    await writeFile(stagingPath, 'verified export', 'utf8');
    await service.prepareFormalOutput(outputPath);
    await writeFile(outputPath, externalBytes);

    await expect(service.commitFormalOutputNoReplace(stagingPath, outputPath)).rejects.toThrow(
      /created before commit/,
    );
    await expect(readFile(outputPath)).resolves.toEqual(externalBytes);
    await service.cleanupFinalOutputStaging(stagingPath);
    await expect(stat(stagingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { driveType: 'Fixed', fileSystem: 'ReFS' },
    { driveType: 'Network', fileSystem: 'NTFS' },
  ])('fails closed on an unsupported $driveType $fileSystem volume before staging', async ({ driveType, fileSystem }) => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-unsupported-'));
    temporaryRoots.push(parent);
    const service = new FileSystemService(path.join(parent, 'frames'), {
      inspectWindowsVolume: async () => ({ driveType, fileSystem }),
    });
    const outputPath = path.join(parent, 'unsupported.mp4');

    await expect(service.prepareFormalOutput(outputPath)).rejects.toThrow(/local NTFS/);
    await expect(readdir(parent)).resolves.toEqual([]);
  });

  it('rejects a formal staging file from a different directory', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-cross-directory-'));
    temporaryRoots.push(parent);
    const stageDirectory = path.join(parent, 'stage');
    const targetDirectory = path.join(parent, 'target');
    await Promise.all([
      mkdir(stageDirectory, { recursive: true }),
      mkdir(targetDirectory, { recursive: true }),
    ]);
    const service = new FileSystemService(path.join(parent, 'frames'), {
      inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
    });
    const stagingPath = path.join(stageDirectory, 'stage.mp4');
    const outputPath = path.join(targetDirectory, 'target.mp4');
    await writeFile(stagingPath, 'verified export', 'utf8');

    await expect(service.commitFormalOutputNoReplace(stagingPath, outputPath)).rejects.toThrow(
      /same directory/,
    );
    await expect(readFile(stagingPath, 'utf8')).resolves.toBe('verified export');
    await expect(stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps formal output staging names short for long user-selected file names', () => {
    const parent = path.join(os.tmpdir(), 'panda-stage-long-output-name');
    const service = new FileSystemService(path.join(parent, 'frames'));
    const outputPath = path.join(parent, `${'long-export-name-'.repeat(12)}.mp4`);
    const stagingPath = service.createFinalOutputStagingPath(randomUUID(), outputPath);

    expect(path.dirname(stagingPath)).toBe(parent);
    expect(path.basename(stagingPath).length).toBeLessThan(100);
    expect(path.basename(stagingPath)).not.toContain('long-export-name');
  });
});
