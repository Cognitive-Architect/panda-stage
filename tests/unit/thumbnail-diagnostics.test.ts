// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import type { AssetThumbnailReadResponse } from '../../src/shared/asset-thumbnail-api';
import {
  thumbnailStateAfterDecodeError,
  thumbnailStateFromResponse,
} from '../../src/renderer/features/assets/AssetCard';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { useProjectImageThumbnails } from '../../src/renderer/features/characters/CharacterIdentity';
import { ImageAssetPicker } from '../../src/renderer/features/characters/ImageAssetPicker';

const project = migrateProject(exampleProject);
const assets = project.assets.filter((asset) => asset.kind === 'image');
const asset = assets[0]!;
const backendCodes = [
  'ASSET_THUMBNAIL_INVALID_REQUEST',
  'ASSET_THUMBNAIL_PROJECT_NOT_TRACKED',
  'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
  'ASSET_THUMBNAIL_HASH_MISMATCH',
  'ASSET_THUMBNAIL_SOURCE_MISSING',
  'ASSET_THUMBNAIL_READ_FAILED',
] as const;
const ready: AssetThumbnailReadResponse = {
  ok: true, status: 'ready', assetId: asset.id, dataUrl: 'data:image/png;base64,cG5n',
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, 'pandaStage');
  vi.restoreAllMocks();
});

async function click(selector: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

function ThumbnailHookPicker() {
  const { thumbnails, onThumbnailError } = useProjectImageThumbnails('D:/uat', assets);
  return createElement(ImageAssetPicker, {
    label: '图片', assets, thumbnails, onThumbnailError,
    selectedAssetId: asset.id, onChange: () => {}, testId: 'hook-picker',
  });
}

describe('Issue #1115 thumbnail failure diagnostics', () => {
  it.each(backendCodes)('retains exact backend %s, message and path in picker cards', async (code) => {
    const response: AssetThumbnailReadResponse = {
      ok: false, error: { code, message: `Exact failure <${code}>`, assetId: asset.id, relativePath: asset.relativePath },
    };
    const readThumbnail = vi.fn().mockResolvedValue(response);
    Object.defineProperty(window, 'pandaStage', { configurable: true, value: { assets: { readThumbnail } } });
    await act(async () => root.render(createElement(CharacterManager, {
      snapshot: { projectRoot: 'D:/uat', project, revision: 0, dirty: false }, view: 'create',
    })));
    await click('[data-testid="character-create-normal-picker-selected"]');
    const card = container.querySelector(`[data-testid="character-create-normal-picker-candidates"] [data-asset-id="${asset.id}"]`)!;
    const thumbnail = card.querySelector<HTMLElement>('[data-thumbnail-status]')!;
    expect(thumbnail.dataset.thumbnailErrorCode).toBe(code);
    expect(thumbnail.dataset.thumbnailFailureLayer).toBe('backend');
    expect(thumbnail.title).toContain(response.error.message);
    expect(thumbnail.title).toContain(response.error.relativePath);
    expect(card.textContent).toContain(code === 'ASSET_THUMBNAIL_SOURCE_MISSING' ? '源文件缺失' : '缩略图加载失败');
    expect(card.textContent).not.toContain(code);
    expect(card.textContent).not.toContain(response.error.message);
    expect(thumbnailStateAfterDecodeError(thumbnailStateFromResponse(response))).toEqual(thumbnailStateFromResponse(response));
    // Closing/reopening keeps the exact result; no extra reads/clicks for diagnostics.
    const readCount = readThumbnail.mock.calls.length;
    await click('[data-testid="character-create-normal-picker-selected"]');
    await click('[data-testid="character-create-normal-picker-selected"]');
    expect(container.querySelector(`[data-asset-id="${asset.id}"] [data-thumbnail-error-code]`)?.getAttribute('data-thumbnail-error-code')).toBe(code);
    expect(readThumbnail).toHaveBeenCalledTimes(readCount);
  });

  it('keeps ready images visible and marks the actual Manager img error as renderer-decode', async () => {
    Object.defineProperty(window, 'pandaStage', { configurable: true, value: { assets: { readThumbnail: vi.fn().mockResolvedValue(ready) } } });
    await act(async () => root.render(createElement(CharacterManager, {
      snapshot: { projectRoot: 'D:/uat', project, revision: 0, dirty: false }, view: 'create',
    })));
    await click('[data-testid="character-create-normal-picker-selected"]');
    const selector = `[data-testid="character-create-normal-picker-candidates"] [data-asset-id="${asset.id}"]`;
    const image = container.querySelector<HTMLImageElement>(`${selector} img`)!;
    expect(image.src).toBe(ready.dataUrl);
    expect(image.parentElement!.dataset.thumbnailFailureLayer).toBeUndefined();
    await act(async () => image.dispatchEvent(new Event('error')));
    const failure = container.querySelector<HTMLElement>(`${selector} [data-thumbnail-status]`)!;
    expect(failure.dataset.thumbnailFailureLayer).toBe('renderer-decode');
    expect(failure.dataset.thumbnailErrorCode).toBe('RENDERER_THUMBNAIL_DECODE_FAILED');
    expect(failure.title).toContain('Main returned a ready thumbnail');
    expect(failure.title).toContain(asset.relativePath);
    expect(failure.title).not.toContain('ASSET_THUMBNAIL_READ_FAILED');
    expect(failure.textContent).toBe('缩略图加载失败');
  });

  it('keeps the shared Character thumbnail hook on the same decode failure contract', async () => {
    Object.defineProperty(window, 'pandaStage', { configurable: true, value: { assets: { readThumbnail: vi.fn().mockResolvedValue(ready) } } });
    await act(async () => root.render(createElement(ThumbnailHookPicker)));
    const image = container.querySelector<HTMLImageElement>('img')!;
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('[data-thumbnail-failure-layer="renderer-decode"]')).not.toBeNull();
    expect(container.textContent).toContain('缩略图加载失败');
  });

  it('does not invent an error for an ordinary cache miss or override a pending read', () => {
    expect(thumbnailStateFromResponse({ ok: true, status: 'missing', assetId: asset.id })).toEqual({ status: 'missing', reason: 'cache' });
    expect(thumbnailStateAfterDecodeError({ status: 'loading' })).toEqual({ status: 'loading' });
  });
});
