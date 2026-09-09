import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Issue #470 historical subtitle background compatibility', () => {
  it('normalizes the persisted historical default while preserving custom backgrounds', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-issue470-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'historical-default.pandastage');
    const projectFile = path.join(projectRoot, 'project.json');
    const base = buildProject();
    const persisted = {
      ...base,
      subtitleStyles: [
        {
          ...base.subtitleStyles[0]!,
          backgroundColor: '#0a1411c7',
        },
        {
          ...base.subtitleStyles[0]!,
          id: '40000000-0000-4000-8000-000000000002',
          name: 'Explicit red background',
          backgroundColor: '#ff0000',
        },
      ],
    };
    const serialized = `${JSON.stringify(persisted, null, 2)}\n`;

    await mkdir(projectRoot, { recursive: true });
    await writeFile(projectFile, serialized, 'utf8');

    const service = new ProjectService();
    const opened = await service.open(projectRoot);

    expect(opened.sourceVersion).toBe(6);
    expect(opened.migrated).toBe(false);
    expect(opened.project.subtitleStyles[0]!.backgroundColor).toBe(
      '#0a141100',
    );
    expect(opened.project.subtitleStyles[1]!.backgroundColor).toBe(
      '#ff0000',
    );
    expect(await readFile(projectFile, 'utf8')).toBe(serialized);

    await service.save(projectRoot, opened.project);
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as {
      subtitleStyles: Array<{ backgroundColor: string }>;
    };
    expect(saved.subtitleStyles[0]!.backgroundColor).toBe('#0a141100');
    expect(saved.subtitleStyles[1]!.backgroundColor).toBe('#ff0000');
  });
});
