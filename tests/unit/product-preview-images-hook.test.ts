// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import type { AssetCanvasImageReadResponse } from '../../src/shared/asset-canvas-image-api';
import {
  useProductPreviewImages,
  type ProductPreviewAssetLoadState,
  type ProductPreviewImageScopeInput,
} from '../../src/renderer/shell/productPreviewImages';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/product-preview-image-hook.pandastage';
const HASH = 'a'.repeat(64);

function previewProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.kind === 'image' ? { ...asset, sha256: HASH } : asset,
    ),
  });
}

function readyImage(assetId: string): AssetCanvasImageReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId,
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: 4,
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
}

let container: HTMLDivElement;
let root: Root;
let state: ProductPreviewAssetLoadState | undefined;
let project: Project;
let readAsset: ReturnType<typeof vi.fn>;
let createdUrls: string[];
let revokedUrls: string[];
let priorPandaStageDescriptor: PropertyDescriptor | undefined;

function PreviewImageHookHarness({
  scope,
}: {
  scope: ProductPreviewImageScopeInput;
}) {
  state = useProductPreviewImages(PROJECT_ROOT, project, scope);
  return createElement('output', { 'data-status': state.status });
}

async function renderScope(scope: ProductPreviewImageScopeInput): Promise<void> {
  await act(async () => {
    root.render(createElement(PreviewImageHookHarness, { scope }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useProductPreviewImages retention scope updates', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    project = previewProject();
    state = undefined;
    createdUrls = [];
    revokedUrls = [];
    readAsset = vi.fn(async ({ assetId }: { assetId: string }) =>
      readyImage(assetId),
    );
    priorPandaStageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'pandaStage',
    );
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: { assets: { readCanvasImage: readAsset } },
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:preview-hook-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revokedUrls.push(url);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (priorPandaStageDescriptor) {
      Object.defineProperty(window, 'pandaStage', priorPandaStageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'pandaStage');
    }
    vi.restoreAllMocks();
  });

  it('commits a retention-only transition and revokes a no-longer-retained URL', async () => {
    await renderScope({ requiredAssetIds: [IDS.assetBg] });
    expect(state?.status).toBe('ready');
    expect(readAsset).toHaveBeenCalledTimes(1);

    const retainedUrl = createdUrls[0];
    expect(retainedUrl).toBeDefined();
    await renderScope({
      requiredAssetIds: [IDS.assetChar],
      retainedAnimationAssetIds: [IDS.assetBg],
    });
    expect(state?.status).toBe('ready');
    expect(revokedUrls).not.toContain(retainedUrl);

    await act(async () => {
      root.render(
        createElement(PreviewImageHookHarness, {
          scope: { requiredAssetIds: [IDS.assetChar] },
        }),
      );
    });

    expect(revokedUrls).toContain(retainedUrl);
    expect(readAsset).toHaveBeenCalledTimes(2);
  });
});
