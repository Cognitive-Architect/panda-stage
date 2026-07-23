import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME,
  ProjectFileSystemService,
  type ProjectFileSystemFaultInjector,
} from '../../src/main/services/ProjectFileSystemService';
import {
  ProjectService,
  ProjectServiceError,
} from '../../src/main/services/ProjectService';
import { PROBE_PROJECT } from '../../src/shared/probe/probe-project';

const FIXED_NOW = '2026-07-23T12:00:00.000Z';
const IDS = [
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
];
const temporaryParents: string[] = [];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function service(faults: ProjectFileSystemFaultInjector = {}): ProjectService {
  let idIndex = 0;
  return new ProjectService({
    fileSystem: new ProjectFileSystemService(faults),
    now: () => new Date(FIXED_NOW),
    createId: () => IDS[idIndex++]!,
  });
}

async function newProjectRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-day12-'));
  temporaryParents.push(parent);
  return path.join(parent, '熊猫 项目 with spaces 🐼.pandastage');
}

async function expectServiceError(
  promise: Promise<unknown>,
  code: ProjectServiceError['code'],
): Promise<ProjectServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).code).toBe(code);
    return error as ProjectServiceError;
  }
  throw new Error(`Expected ProjectServiceError ${code}.`);
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('project directory lifecycle', () => {
  it('creates the exact Unicode project tree and rejects existing directories', async () => {
    const projectRoot = await newProjectRoot();
    const projectService = service();

    const created = await projectService.create(projectRoot, {
      name: '熊猫短片',
    });
    const entries = (await readdir(projectRoot)).sort();

    expect(created.projectRoot).toBe(path.resolve(projectRoot));
    expect(entries).toEqual(
      [...PROJECT_DIRECTORIES, PROJECT_FILE_NAME].sort(),
    );
    await expectServiceError(
      projectService.create(projectRoot, { name: '不得合并' }),
      'PROJECT_ALREADY_EXISTS',
    );
  });

  it('saves over an existing file atomically and reopens relative asset paths', async () => {
    const projectRoot = await newProjectRoot();
    const projectService = service();
    const created = await projectService.create(projectRoot, {
      name: 'Unicode save',
    });
    const project = {
      ...created.project,
      assets: [
        {
          id: '90000000-0000-4000-8000-000000000003',
          kind: 'image' as const,
          name: '角色',
          relativePath: 'assets/角色 image.png',
          mimeType: 'image/png',
          width: 512,
          height: 512,
        },
      ],
      updatedAt: '2026-07-23T13:00:00.000Z',
    };

    await projectService.save(projectRoot, project);
    const opened = await projectService.open(projectRoot);
    const serialized = await readFile(
      path.join(projectRoot, PROJECT_FILE_NAME),
      'utf8',
    );

    expect(opened.project).toEqual(project);
    expect(opened.migrated).toBe(false);
    expect(serialized).toContain('assets/角色 image.png');
    expect(serialized).not.toContain(path.resolve(projectRoot));
    expect(
      (await readdir(projectRoot)).some((entry) => entry.endsWith('.tmp')),
    ).toBe(false);
  });

  it('migrates v0 in memory without changing the source file', async () => {
    const projectRoot = await newProjectRoot();
    await service().create(projectRoot, { name: 'Migration root' });
    const filePath = path.join(projectRoot, PROJECT_FILE_NAME);
    const v0 = { ...structuredClone(PROBE_PROJECT), schemaVersion: 0 };
    const source = `${JSON.stringify(v0, null, 2)}\n`;
    await writeFile(filePath, source, 'utf8');
    const beforeHash = sha256(await readFile(filePath, 'utf8'));

    const opened = await service().open(projectRoot);
    const afterHash = sha256(await readFile(filePath, 'utf8'));

    expect(opened.sourceVersion).toBe(0);
    expect(opened.migrated).toBe(true);
    expect(opened.project.schemaVersion).toBe(1);
    expect(afterHash).toBe(beforeHash);
  });

  it('rejects invalid JSON without changing the source file', async () => {
    const projectRoot = await newProjectRoot();
    await service().create(projectRoot, { name: 'Invalid JSON root' });
    const filePath = path.join(projectRoot, PROJECT_FILE_NAME);
    await writeFile(filePath, '{"schemaVersion": 1,', 'utf8');
    const before = await readFile(filePath, 'utf8');

    await expectServiceError(service().open(projectRoot), 'INVALID_JSON');

    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('rejects future schema versions without changing the source file', async () => {
    const projectRoot = await newProjectRoot();
    await service().create(projectRoot, { name: 'Future root' });
    const filePath = path.join(projectRoot, PROJECT_FILE_NAME);
    const source = '{"schemaVersion": 999}\n';
    await writeFile(filePath, source, 'utf8');
    const beforeHash = sha256(source);

    await expectServiceError(
      service().open(projectRoot),
      'UNSUPPORTED_VERSION',
    );

    expect(sha256(await readFile(filePath, 'utf8'))).toBe(beforeHash);
  });

  it.each([
    ['after temporary sync', 'afterTemporarySync'],
    ['before atomic replace', 'beforeAtomicReplace'],
  ] as const)(
    'preserves the old hash when save fails %s',
    async (_label, faultName) => {
      const projectRoot = await newProjectRoot();
      const initialService = service();
      const created = await initialService.create(projectRoot, {
        name: 'Original',
      });
      const filePath = path.join(projectRoot, PROJECT_FILE_NAME);
      const beforeHash = sha256(await readFile(filePath, 'utf8'));
      const injected = Object.assign(new Error('Injected write fault.'), {
        code: 'EIO',
      });
      const failingService = service({
        [faultName]: () => {
          throw injected;
        },
      });

      await expectServiceError(
        failingService.save(projectRoot, {
          ...created.project,
          name: 'Must not replace original',
        }),
        'SAVE_FAILED',
      );

      const afterHash = sha256(await readFile(filePath, 'utf8'));
      console.info(
        `DAY12_HASH_EVIDENCE fault=${faultName} before=${beforeHash} after=${afterHash}`,
      );
      expect(afterHash).toBe(beforeHash);
      expect(
        (await readdir(projectRoot)).some((entry) => entry.endsWith('.tmp')),
      ).toBe(false);
    },
  );

  it('returns a controlled error for a non-writable target and preserves the old hash', async () => {
    const projectRoot = await newProjectRoot();
    const initialService = service();
    const created = await initialService.create(projectRoot, {
      name: 'Original',
    });
    const filePath = path.join(projectRoot, PROJECT_FILE_NAME);
    const beforeHash = sha256(await readFile(filePath, 'utf8'));
    const permissionError = Object.assign(new Error('Access denied.'), {
      code: 'EACCES',
    });
    const failingService = service({
      beforeTemporaryWrite: () => {
        throw permissionError;
      },
    });

    const error = await expectServiceError(
      failingService.save(projectRoot, {
        ...created.project,
        name: 'Denied update',
      }),
      'PROJECT_NOT_WRITABLE',
    );

    expect(error.message).toContain(projectRoot);
    expect(sha256(await readFile(filePath, 'utf8'))).toBe(beforeHash);
  });

  it('rejects roots that do not use the .pandastage directory contract', async () => {
    const projectRoot = (await newProjectRoot()).replace(/\.pandastage$/u, '');
    await expectServiceError(
      service().create(projectRoot, { name: 'Invalid root' }),
      'INVALID_PROJECT_ROOT',
    );
  });
});
