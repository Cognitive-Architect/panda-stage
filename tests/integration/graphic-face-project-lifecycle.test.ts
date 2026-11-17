import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CharacterService, PROJECT_SCHEMA_VERSION, ProjectV19Schema, migrateProject } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { ProjectOperationResponseSchema } from '../../src/shared/project-api';
import historicalV19 from '../fixtures/project-v19-image-face.json';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

describe('v20 Graphic face file lifecycle (#1112)', () => {
  it('opens the original v19 writer fixture without rewriting image, timing, voice or narrator data', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v20-'));
    try {
      const root = path.join(parent, 'legacy.pandastage');
      await mkdir(root);
      const file = path.join(root, 'project.json');
      await writeFile(file, JSON.stringify(historicalV19));
      expect(ProjectV19Schema.safeParse(historicalV19).success).toBe(true);
      const service = new ProjectService();
      const opened = await service.open(root);
      expect(opened.sourceVersion).toBe(19);
      expect(opened.migrated).toBe(true);
      expect(opened.project).toEqual({ ...historicalV19, schemaVersion: PROJECT_SCHEMA_VERSION });
      expect(ProjectOperationResponseSchema.safeParse({ ok: true, value: opened }).success).toBe(true);
      await service.save(root, opened.project, 1);
      const reopened = await new ProjectService().open(root);
      expect(reopened.project).toEqual(opened.project);
      expect(reopened.sourceVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(reopened.migrated).toBe(false);
      expect(migrateProject(JSON.parse(await readFile(file, 'utf8')))).toEqual(opened.project);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it('saves and reopens Graphic expression/default/mouth identity without raster aliases', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-face-'));
    try {
      const root = path.join(parent, 'graphic.pandastage');
      await mkdir(root);
      const initial = graphicFaceProject();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(initial));
      const service = new CharacterService();
      let project = service.setExpressionVisualSource(initial, IDS.character, IDS.expressionNormal, faceSource(1));
      project = service.setMouthOpenVisualSource(project, IDS.character, faceSource(3));
      await new ProjectService().save(root, project, 1);
      const reopened = await new ProjectService().open(root);
      expect(reopened.project).toEqual(project);
      expect(reopened.project.characters[0]).not.toHaveProperty('baseAssetId');
      expect(reopened.project.characters[0]).not.toHaveProperty('mouthOpenAssetId');
      expect(reopened.project.characters[0]).toHaveProperty('expressions.0.visualSource', faceSource(1));
      expect(reopened.project.characters[0]).toHaveProperty('mouthOpenVisualSource', faceSource(3));
      expect(reopened.project.animations).toEqual(initial.animations);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
