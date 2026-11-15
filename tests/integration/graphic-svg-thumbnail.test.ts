import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { AssetCanvasImageReadResponseSchema } from '../../src/shared/asset-canvas-image-api';
import { graphicThumbnailFixture } from '../helpers/graphicThumbnailFixture';

describe('Issue #1116 SVG source persistence', () => {
  it.each([false, true])('reopens frame/Shape (%s) files with the same Canvas Image result', async shape => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-svg-thumb-'));
    const root = path.join(parent, 'graphic.pandastage');
    try {
      const { project, asset, bytes } = graphicThumbnailFixture(undefined, shape);
      await mkdir(path.join(root, 'assets'), { recursive: true });
      await writeFile(path.join(root, 'project.json'), JSON.stringify(project));
      await writeFile(path.join(root, asset.relativePath), bytes);
      const before = await readFile(path.join(root, 'project.json'));
      for (let reopen = 0; reopen < 2; reopen++) {
        const opened = await new ProjectService().open(root);
        const service = new AssetCanvasImageService({ getCurrentProjectSnapshot: () => ({ project: opened.project }) });
        const response = AssetCanvasImageReadResponseSchema.parse(await service.read({ projectRoot: root, assetId: asset.id, sha256: asset.sha256 }));
        expect(response).toMatchObject({ ok: true, mimeType: 'image/svg+xml', bytes });
      }
      expect(await readFile(path.join(root, 'project.json'))).toEqual(before);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
