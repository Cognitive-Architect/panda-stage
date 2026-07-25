import { randomUUID } from 'node:crypto';
import {
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { AssetGrid } from '../../src/renderer/features/assets/AssetGrid';
import {
  AssetCard,
  type ThumbnailState,
} from '../../src/renderer/features/assets/AssetCard';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';
import type { AssetLibraryEntry } from '../../src/renderer/stores/assetLibrarySelectors';
import exampleProject from '../../demo-project/project-v1.example.json';

const noop = () => undefined;

describe('asset library components', () => {
  it('renders all three categories, thumbnail placeholders, import entry, and details guidance', () => {
    const project = ProjectSchema.parse(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 3,
        },
      }),
    );
    expect(markup).toContain('项目素材库');
    expect(markup).toContain('角色图片');
    expect(markup).toContain('背景图片');
    expect(markup).toContain('音频');
    expect(markup).toContain('导入项目素材');
    expect(markup).toContain('素材详情');
    expect(markup).toContain('加载缩略图');
    expect(markup).not.toContain('src="assets/');

    const missingMarkup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: project.assets.find((asset) => asset.kind === 'image')!,
        category: 'background',
        selected: false,
        dragging: false,
        thumbnail: { status: 'missing' },
        onSelect: noop,
        onDragStart: noop,
        onDragEnd: noop,
        onRebuildThumbnail: noop,
        onThumbnailError: noop,
      }),
    );
    expect(missingMarkup).toContain('缩略图缺失');
    expect(missingMarkup).toContain('重建');
  });

  it('renders a clear empty state for a category with no assets', () => {
    const project = ProjectSchema.parse({
      ...exampleProject,
      assets: [],
      characters: [],
      voiceProfiles: [],
      shots: [],
    });
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        snapshot: {
          projectRoot: 'D:\\empty.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );
    expect(markup).toContain('这个分类还没有素材');
    expect(markup).toContain('PNG、JPG、MP3、WAV');
  });

  it('renders 100 lazy thumbnail cards without any original asset URL', () => {
    const entries: AssetLibraryEntry[] = Array.from(
      { length: 100 },
      (_, index) => ({
        category: 'background',
        asset: {
          id: randomUUID(),
          name: `Fixture ${index}`,
          relativePath: `assets/original-${index}.png`,
          mimeType: 'image/png',
          kind: 'image',
          width: 16,
          height: 12,
        },
      }),
    );
    const startedAt = performance.now();
    const markup = renderToStaticMarkup(
      createElement(AssetGrid, {
        entries,
        selectedAssetId: entries[50]!.asset.id,
        draggingAssetId: null,
        thumbnails: {},
        onSelect: noop,
        onDragStart: noop,
        onDragEnd: noop,
        onRebuildThumbnail: noop,
        onThumbnailError: noop,
      }),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(markup.match(/data-asset-id=/g)).toHaveLength(100);
    expect(markup).toContain('data-grid-count="100"');
    expect(markup).not.toContain('assets/original-');
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('falls back only the image whose browser decode reports an error', () => {
    const project = ProjectSchema.parse(exampleProject);
    const imageAssets = project.assets.filter(
      (asset) => asset.kind === 'image',
    );
    const failedAsset = imageAssets[0]!;
    const healthyAsset = imageAssets[1]!;
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const states: Record<string, ThumbnailState> = {
      [failedAsset.id]: { status: 'ready' as const, dataUrl },
      [healthyAsset.id]: { status: 'ready' as const, dataUrl },
    };
    const onThumbnailError = (assetId: string) => {
      states[assetId] = { status: 'missing' };
    };
    const readyCard = AssetCard({
      asset: failedAsset,
      category: 'background',
      selected: true,
      dragging: false,
      thumbnail: states[failedAsset.id]!,
      onSelect: noop,
      onDragStart: noop,
      onDragEnd: noop,
      onRebuildThumbnail: noop,
      onThumbnailError,
    });
    const articleChildren = (
      readyCard.props as { children: ReactNode[] }
    ).children;
    const preview = articleChildren[0] as ReactElement<{
      children: ReactElement<{ onError: () => void }>;
    }>;

    preview.props.children.props.onError();

    const markup = renderToStaticMarkup(
      createElement(AssetGrid, {
        entries: [
          { asset: failedAsset, category: 'background' },
          { asset: healthyAsset, category: 'background' },
        ],
        selectedAssetId: failedAsset.id,
        draggingAssetId: null,
        thumbnails: states,
        onSelect: noop,
        onDragStart: noop,
        onDragEnd: noop,
        onRebuildThumbnail: noop,
        onThumbnailError,
      }),
    );
    expect(states[failedAsset.id]).toEqual({ status: 'missing' });
    expect(states[healthyAsset.id]).toEqual({
      status: 'ready',
      dataUrl,
    });
    expect(markup).toContain('缩略图缺失');
    expect(markup).toContain('重建');
    expect(markup.match(/<img/g)).toHaveLength(1);
    expect(markup).toContain('asset-card-selected');
  });
});
