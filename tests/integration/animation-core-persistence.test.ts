import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAnimationClipAtTime } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { ProjectOperationResponseSchema } from '../../src/shared/project-api';
import { animationCoreFixture } from '../helpers/animationCoreFixture';
import { graphicFaceProject, FACE_GRAPHIC_ID } from '../helpers/graphicFaceProject';

describe('Animation Core v21 file persistence', () => {
  it('upgrades a v20 file, saves/reopens image and Graphic bases with identical seek results', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-core-'));
    try {
      const root = path.join(parent, 'core.pandastage');
      await mkdir(root);
      const { project, clip, layerId } = animationCoreFixture();
      const graphic = graphicFaceProject();
      project.assets = graphic.assets;
      project.animations = graphic.animations;
      const layer = project.shots[0]!.layers.find(l => l.id === layerId)!;
      delete layer.animationClip;
      const historical = { ...project, schemaVersion: 20 };
      const file = path.join(root, 'project.json');
      await writeFile(file, JSON.stringify(historical));
      const opened = await new ProjectService().open(root);
      expect(opened.sourceVersion).toBe(20);
      expect(opened.migrated).toBe(true);
      expect(opened.project).toEqual({ ...historical, schemaVersion: 21 });
      expect(ProjectOperationResponseSchema.safeParse({ ok: true, value: opened }).success).toBe(true);
      const target = { ...clip.targetBases[0]!.target, partId: '71000000-0000-4000-8000-000000000002' };
      clip.targetBases.push({ ...clip.targetBases[0]!, target, drawOrder: 1,
        visualSource: { kind: 'fla-graphic', animationId: FACE_GRAPHIC_ID, instanceTransformOverrides: {
          '0': { '["face-0"]': { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 5 } },
        } },
      });
      clip.tracks.push({ ...clip.tracks[0]!, target, property: 'transform.scaleX', keys: [
        { timeMs: 0, value: 1, interpolationToNext: 'ease-in-out' },
        { timeMs: 1000, value: 2, interpolationToNext: 'linear' },
      ] });
      opened.project.shots[0]!.layers.find(l => l.id === layerId)!.animationClip = clip;
      const expected = [0, 250, 500, 900, 1000, 2000].map(time => evaluateAnimationClipAtTime(clip, time));
      await new ProjectService().save(root, opened.project, 1);
      const reopened = await new ProjectService().open(root);
      expect(reopened.sourceVersion).toBe(21);
      expect(reopened.migrated).toBe(false);
      expect(reopened.project).toEqual(opened.project);
      const persisted = reopened.project.shots[0]!.layers.find(l => l.id === layerId)!.animationClip!;
      expect(persisted).toEqual(clip);
      expect([0, 250, 500, 900, 1000, 2000].map(time => evaluateAnimationClipAtTime(persisted, time))).toEqual(expected);
      expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(21);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
