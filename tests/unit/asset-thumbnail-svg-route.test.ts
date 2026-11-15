import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { isGeneratedFlaSvgAsset } from '../../src/domain/selectors/isGeneratedFlaSvgAsset';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import type { MediaInspectionService } from '../../src/main/services/MediaInspectionService';
import { AssetCanvasImageReadResponseSchema, CANVAS_IMAGE_MAX_BYTES } from '../../src/shared/asset-canvas-image-api';
import { graphicThumbnailFixture } from '../helpers/graphicThumbnailFixture';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function setup(shape = false, svg?: string) {
  const fixture = graphicThumbnailFixture(svg, shape);
  const projectRoot = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-svg-thumbnail-'));
  directories.push(projectRoot);
  await mkdir(path.join(projectRoot, 'assets'));
  const sourcePath = path.join(projectRoot, fixture.asset.relativePath);
  await writeFile(sourcePath, fixture.bytes);
  const inspect = vi.fn().mockRejectedValue(new Error('SVG must not enter raster inspection'));
  const service = new AssetCanvasImageService({ getCurrentProjectSnapshot: () => ({ project: fixture.project }), inspectionService: { inspect } as unknown as MediaInspectionService });
  return { ...fixture, projectRoot, sourcePath, inspect, service, request: { projectRoot, assetId: fixture.asset.id, sha256: fixture.asset.sha256! } };
}

describe('Issue #1116 internal SVG reuses the Canvas Image owner', () => {
  it.each([false, true])('reads frame/Shape (%s) SVG bytes and bypasses raster inspection', async shape => {
    const input = await setup(shape);
    expect(isGeneratedFlaSvgAsset(input.project, input.asset)).toBe(true);
    if (shape) expect(input.asset).not.toHaveProperty('flaGraphicFrame');
    const response = await input.service.read(input.request);
    expect(AssetCanvasImageReadResponseSchema.parse(response)).toMatchObject({ ok: true, mimeType: 'image/svg+xml', bytes: input.bytes });
    expect(input.inspect).not.toHaveBeenCalled();
  });
  it('preserves request/actual HASH_MISMATCH, ASSET_NOT_FOUND and SOURCE_MISSING', async () => {
    const input = await setup(true);
    for (const [request, code] of [
      [{ ...input.request, assetId: '10000000-0000-4000-8000-000000999999' }, 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND'],
      [{ ...input.request, sha256: 'f'.repeat(64) }, 'ASSET_CANVAS_IMAGE_HASH_MISMATCH'],
    ] as const) await expect(input.service.read(request)).resolves.toMatchObject({ ok: false, error: { code } });
    await writeFile(input.sourcePath, input.bytes.toString().replace('#336699', '#ff0000'));
    await expect(input.service.read(input.request)).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_HASH_MISMATCH', relativePath: input.asset.relativePath } });
    await rm(input.sourcePath);
    await expect(input.service.read(input.request)).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_SOURCE_MISSING', relativePath: input.asset.relativePath } });
  });
  it.each(['<script/>', '<foreignObject/>', '<image href="https://example.test/image.png"/>'])('uses existing SVG safety rejection: %s', async contents => {
    const input = await setup(true, `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="70">${contents}</svg>`);
    await expect(input.service.read(input.request)).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', relativePath: input.asset.relativePath, message: expect.stringContaining('Panda-generated SVG') } });
  });
  it('accepts internal references and embedded PNGs under the existing validator', async () => {
    const png = await readFile(path.resolve('tests/fixtures/assets/熊猫 图片.png'));
    const input = await setup(true, `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="70"><defs><path id="shape" d="M0 0H20V20H0Z"/></defs><use href="#shape"/><image width="16" height="12" href="data:image/png;base64,${png.toString('base64')}"/></svg>`);
    await expect(input.service.read(input.request)).resolves.toMatchObject({ ok: true, mimeType: 'image/svg+xml' });
  });
  it('requires formal ownership and SVG MIME; names alone grant no access', async () => {
    const input = await setup();
    const external = { ...input.asset, id: '10000000-0000-4000-8000-000000999999', name: 'fla-shape-fake' };
    Reflect.deleteProperty(external, 'flaGraphicFrame');
    const project = ProjectSchema.parse({ ...input.project, assets: [...input.project.assets, external] });
    expect(isGeneratedFlaSvgAsset(project, external)).toBe(false);
    expect(isGeneratedFlaSvgAsset(project, project.assets.find(asset => asset.mimeType === 'image/png')!)).toBe(false);
    await expect(new AssetCanvasImageService({ getCurrentProjectSnapshot: () => ({ project }) }).read({ ...input.request, assetId: external.id })).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' } });
  });
  it('preserves controlled paths and the existing 64MB payload bound', async () => {
    const input = await setup(true);
    const project = ProjectSchema.parse({ ...input.project, assets: input.project.assets.map(asset => asset.id === input.asset.id ? { ...asset, relativePath: 'outside.svg' } : asset) });
    await expect(new AssetCanvasImageService({ getCurrentProjectSnapshot: () => ({ project }) }).read(input.request)).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' } });
    const handle = await open(input.sourcePath, 'w'); await handle.truncate(CANVAS_IMAGE_MAX_BYTES + 1); await handle.close();
    await expect(input.service.read(input.request)).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', message: expect.stringContaining('limit') } });
  });
});
