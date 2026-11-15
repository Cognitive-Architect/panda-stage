// @vitest-environment happy-dom
import { act, createElement, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAsset, Project } from '../../src/domain';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { ImageAssetPicker } from '../../src/renderer/features/characters/ImageAssetPicker';
import { useGraphicSvgThumbnails } from '../../src/renderer/features/characters/useGraphicSvgThumbnails';
import { graphicThumbnailFixture } from '../helpers/graphicThumbnailFixture';

class ControlledImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  succeed() { this.onload?.(); }
  fail() { this.onerror?.(); }
}
let root: Root;
let container: HTMLDivElement;
let images: ControlledImage[];
let createUrl: ReturnType<typeof vi.spyOn>;
let revokeUrl: ReturnType<typeof vi.spyOn>;
const fixture = graphicThumbnailFixture(undefined, true);
const assetId = fixture.asset.id;
const ready = { ok: true, status: 'ready', assetId, mimeType: 'image/svg+xml', width: 80, height: 70, byteLength: fixture.bytes.length, bytes: new Uint8Array(fixture.bytes) };

function Harness({ project = fixture.project, projectRoot = 'D:/svg-uat' }: { project?: Project; projectRoot?: string }) {
  const assets = useMemo(() => project.assets.filter((asset): asset is ImageAsset => asset.kind === 'image' && asset.id === assetId), [project]);
  const thumbnails = useGraphicSvgThumbnails(projectRoot, project, assets);
  return createElement(ImageAssetPicker, { assets, thumbnails: thumbnails.thumbnails, onThumbnailError: thumbnails.onThumbnailError, label: 'SVG', selectedAssetId: assetId, onChange: () => {}, testId: 'svg-picker' });
}
async function render(project = fixture.project, projectRoot = 'D:/svg-uat') {
  await act(async () => root.render(createElement(Harness, { project, projectRoot })));
}
async function settle() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
function api(response: unknown = ready) {
  const readCanvasImage = vi.fn().mockResolvedValue(response);
  const readThumbnail = vi.fn().mockImplementation(async request => ({ ok: true, status: 'ready', assetId: request.assetId, dataUrl: 'data:image/png;base64,cG5n' }));
  Object.defineProperty(window, 'pandaStage', { configurable: true, value: { assets: { readCanvasImage, readThumbnail } } });
  return { readCanvasImage, readThumbnail };
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  images = [];
  vi.spyOn(window, 'Image').mockImplementation(function () { const image = new ControlledImage(); images.push(image); return image as unknown as HTMLImageElement; });
  createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:svg-${images.length + 1}`);
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); container.remove(); Reflect.deleteProperty(window, 'pandaStage'); vi.restoreAllMocks(); });

describe('Issue #1116 SVG picker routing and ObjectURL lifetime', () => {
  it('reuses a decoded ObjectURL across project revisions and picker reopen, then revokes on unmount', async () => {
    const reads = api();
    await render(); await settle();
    expect(createUrl).toHaveBeenCalledOnce();
    expect((createUrl.mock.calls[0]![0] as Blob).type).toBe('image/svg+xml');
    await act(async () => images[0]!.succeed());
    expect(container.querySelector('img')?.src).toBe('blob:svg-1');
    for (let i = 0; i < 3; i++) await render({ ...fixture.project });
    for (let i = 0; i < 2; i++) await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="svg-picker-selected"]')!.click());
    expect(reads.readCanvasImage).toHaveBeenCalledOnce();
    expect(reads.readThumbnail).not.toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:svg-1');
  });
  it('releases superseded hash/context resources and ignores late reads after unmount', async () => {
    const reads = api(); await render(); await settle(); await act(async () => images[0]!.succeed());
    const changed = { ...fixture.project, assets: fixture.project.assets.map(asset => asset.id === assetId ? { ...asset, sha256: 'f'.repeat(64) } : asset) };
    await render(changed); await settle(); await act(async () => images[1]!.succeed());
    expect(revokeUrl).toHaveBeenCalledWith('blob:svg-1');
    await render(changed, 'D:/second-project'); await settle();
    expect(revokeUrl).toHaveBeenCalledWith('blob:svg-2');
    await act(async () => root.render(null));
    expect(revokeUrl).toHaveBeenCalledWith('blob:svg-3');
    let resolveLate!: (value: typeof ready) => void;
    reads.readCanvasImage.mockReturnValueOnce(new Promise(resolve => { resolveLate = resolve; }));
    await render(); await act(async () => root.render(null));
    resolveLate(ready); await settle();
    expect(createUrl).toHaveBeenCalledTimes(3);
  });
  it.each(['ASSET_CANVAS_IMAGE_HASH_MISMATCH', 'ASSET_CANVAS_IMAGE_SOURCE_MISSING', 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND', 'ASSET_CANVAS_IMAGE_READ_FAILED'])('preserves exact backend %s and details', async code => {
    api({ ok: false, error: { code, assetId, message: 'Exact SVG read error', relativePath: fixture.asset.relativePath } });
    await render(); await settle();
    const thumbnail = container.querySelector<HTMLElement>('[data-thumbnail-status]')!;
    expect(thumbnail.dataset.thumbnailErrorCode).toBe(code);
    expect(thumbnail.dataset.thumbnailFailureLayer).toBe('backend');
    expect(thumbnail.title).toContain('Exact SVG read error');
    expect(thumbnail.title).toContain(fixture.asset.relativePath);
    expect(thumbnail.textContent).toBe(code.endsWith('SOURCE_MISSING') ? '源文件缺失' : '缩略图加载失败');
    expect(createUrl).not.toHaveBeenCalled();
  });
  it('marks Main-ready decode failure as renderer-decode and revokes its URL', async () => {
    api(); await render(); await settle(); await act(async () => images[0]!.fail());
    const thumbnail = container.querySelector<HTMLElement>('[data-thumbnail-status]')!;
    expect(thumbnail.dataset.thumbnailFailureLayer).toBe('renderer-decode');
    expect(thumbnail.dataset.thumbnailErrorCode).toBe('RENDERER_THUMBNAIL_DECODE_FAILED');
    expect(revokeUrl).toHaveBeenCalledWith('blob:svg-1');
  });
  it('uses the Canvas route for owned SVGs and keeps PNG/JPEG on the existing thumbnail API in Character Manager', async () => {
    const reads = api();
    await act(async () => root.render(createElement(CharacterManager, { snapshot: { project: fixture.project, projectRoot: 'D:/svg-uat', revision: 0, dirty: false }, view: 'create' })));
    await settle();
    const ownedIds = fixture.project.assets.filter(asset => asset.mimeType === 'image/svg+xml').map(asset => asset.id);
    expect(reads.readCanvasImage.mock.calls.map(([request]) => request.assetId)).toEqual(expect.arrayContaining(ownedIds));
    expect(reads.readThumbnail.mock.calls.every(([request]) => !ownedIds.includes(request.assetId))).toBe(true);
    expect(reads.readThumbnail).toHaveBeenCalled();
  });
});
