import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { CharacterService } from '../../src/domain';
import { PROJECT_FILE_NAME } from '../../src/main/services/ProjectFileSystemService';
import { ProjectService } from '../../src/main/services/ProjectService';

const temporaryParents: string[] = [];

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-day19-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '角色 定义 🐼.pandastage');
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Day 19 character persistence', () => {
  it('saves and reopens normal/angry, mouth asset, default expression, scale, flip, and ID-only references', async () => {
    const root = await projectRoot();
    const projectIds = [
      '19200000-0000-4000-8000-000000000001',
      '19200000-0000-4000-8000-000000000002',
    ];
    let projectIdIndex = 0;
    const projectService = new ProjectService({
      createId: () => projectIds[projectIdIndex++]!,
      now: () => new Date('2026-07-25T04:10:00.000Z'),
    });
    const created = await projectService.create(root, {
      name: 'Day 19 character project',
    });
    expect(created.sourceVersion).toBe(2);
    const withAssets = {
      ...created.project,
      assets: [
        {
          id: '19200000-0000-4000-8000-000000000011',
          name: 'normal',
          relativePath: 'assets/normal.png',
          mimeType: 'image/png',
          kind: 'image' as const,
          width: 640,
          height: 640,
        },
        {
          id: '19200000-0000-4000-8000-000000000012',
          name: 'angry',
          relativePath: 'assets/angry.png',
          mimeType: 'image/png',
          kind: 'image' as const,
          width: 900,
          height: 640,
        },
        {
          id: '19200000-0000-4000-8000-000000000013',
          name: 'mouth open',
          relativePath: 'assets/mouth-open.png',
          mimeType: 'image/png',
          kind: 'image' as const,
          width: 640,
          height: 640,
        },
      ],
    };
    await projectService.save(root, withAssets, 1);

    const characterIds = [
      '19200000-0000-4000-8000-000000000021',
      '19200000-0000-4000-8000-000000000022',
      '19200000-0000-4000-8000-000000000023',
      '19200000-0000-4000-8000-000000000024',
    ];
    let characterIdIndex = 0;
    const characterService = new CharacterService({
      createId: () => characterIds[characterIdIndex++]!,
      now: () => new Date('2026-07-25T04:11:00.000Z'),
    });
    const characterProject = characterService.create(withAssets, {
      name: 'Panda',
      expressions: [
        {
          name: 'normal',
          assetId: '19200000-0000-4000-8000-000000000011',
        },
        {
          name: 'angry',
          assetId: '19200000-0000-4000-8000-000000000012',
        },
      ],
      mouthOpenAssetId:
        '19200000-0000-4000-8000-000000000013',
      defaultScale: 0.75,
      defaultFlipX: true,
    });
    await projectService.save(root, characterProject, 2);
    const reopened = await projectService.open(root);
    const serialized = await readFile(
      path.join(root, 'project.json'),
      'utf8',
    );

    expect(reopened.migrated).toBe(false);
    expect(reopened.sourceVersion).toBe(2);
    expect(reopened.project.characters[0]).toEqual(
      characterProject.characters[0],
    );
    expect(reopened.project.voiceProfiles[0]).toEqual(
      characterProject.voiceProfiles[0],
    );
    expect(serialized).toContain('"defaultExpressionId"');
    expect(serialized).toContain('"mouthOpenAssetId"');
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain('data:image');
  });

  it('opens a formal v1 project as migrated v2 without modifying project.json until save', async () => {
    const root = await projectRoot();
    const projectService = new ProjectService();
    await projectService.create(root, { name: 'migration root' });
    const filePath = path.join(root, PROJECT_FILE_NAME);
    const v1Source = `${JSON.stringify(exampleProject, null, 2)}\n`;
    await writeFile(filePath, v1Source, 'utf8');

    const opened = await projectService.open(root);

    expect(opened.sourceVersion).toBe(1);
    expect(opened.migrated).toBe(true);
    expect(opened.project.schemaVersion).toBe(2);
    expect(opened.project.characters[0]).toMatchObject({
      defaultExpressionId:
        exampleProject.characters[0]!.expressions[0]!.id,
      defaultScale: 1,
      defaultFlipX: false,
      baseAssetId: exampleProject.characters[0]!.baseAssetId,
    });
    expect(await readFile(filePath, 'utf8')).toBe(v1Source);
  });
});
