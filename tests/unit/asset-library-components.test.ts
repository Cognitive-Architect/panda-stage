import { randomUUID } from 'node:crypto';
import {
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { AssetGrid } from '../../src/renderer/features/assets/AssetGrid';
import {
  AssetCard,
  type ThumbnailState,
} from '../../src/renderer/features/assets/AssetCard';
import { AssetDetails } from '../../src/renderer/features/assets/AssetDetails';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';
import type { AssetLibraryEntry } from '../../src/renderer/stores/assetLibrarySelectors';
import exampleProject from '../../demo-project/project-v1.example.json';

const noop = () => undefined;
const directPayload = (assetId: string) => ({
  version: 2 as const,
  type: 'asset-image' as const,
  assetId,
});

describe('asset library components', () => {
  it('renders asset categories, thumbnail placeholders, import entry, and details guidance', () => {
    const project = migrateProject(exampleProject);
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
    expect(markup).toContain('全部');
    expect(markup).toContain('角色图片');
    expect(markup).toContain('未绑定角色');
    expect(markup).toContain('音频');
    expect(markup).toContain('data-testid="asset-library-usage-filter"');
    expect(markup).toContain('全部用途');
    expect(markup).toContain('导入项目素材');
    expect(markup).toContain('data-testid="asset-browser-view"');
    expect(markup).toContain('导入 FLA');
    expect(markup).toContain(
      '打开 FLA 后可先预览并选择需要的素材，确认导入前不会修改项目。',
    );
    expect(markup).not.toContain('Import FLA...');
    expect(markup).toContain('data-testid="asset-import-fla"');
    const detailsMarkup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 3,
        },
        view: 'details',
      }),
    );
    expect(detailsMarkup).toContain('data-testid="asset-details-view"');
    expect(detailsMarkup).toContain('素材详情');
    expect(markup).toContain('加载缩略图');
    expect(markup).not.toContain('src="assets/');

    const propAsset = project.assets.find(
      (asset) => asset.kind === 'image',
    );
    if (!propAsset || propAsset.kind !== 'image') {
      throw new Error('Expected an image fixture.');
    }
    const propCardAsset = { ...propAsset, usage: 'prop' as const };
    const missingMarkup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: propCardAsset,
        category: 'background',
        contextLabel: '图片',
        dropPayload: directPayload(
          propCardAsset.id,
        ),
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
    expect(missingMarkup).toContain('未绑定角色');
    expect(missingMarkup).toContain('用途：道具');

    const sourceMissingMarkup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: propCardAsset,
        category: 'background',
        contextLabel: '图片',
        dropPayload: directPayload(
          propCardAsset.id,
        ),
        selected: false,
        dragging: false,
        thumbnail: {
          status: 'missing',
          reason: 'source',
          relativePath: 'assets/panda-happy.png',
        },
        onSelect: noop,
        onDragStart: noop,
        onDragEnd: noop,
        onRebuildThumbnail: noop,
        onThumbnailError: noop,
      }),
    );
    expect(sourceMissingMarkup).toContain('源文件缺失');
    expect(sourceMissingMarkup).toContain('assets/panda-happy.png');
    expect(sourceMissingMarkup).not.toContain('<button');
    expect(sourceMissingMarkup).toContain(
      'data-thumbnail-source-status="missing"',
    );
  });

  it('keeps combined text and purpose filters available in desktop and touch layouts', () => {
    const project = migrateProject(exampleProject);
    for (const props of [
      { presentation: 'default' as const, hideHeading: false },
      { presentation: 'portrait' as const, hideHeading: true },
    ]) {
      const markup = renderToStaticMarkup(
        createElement(AssetLibrary, {
          snapshot: {
            projectRoot: 'D:\\project.pandastage',
            project,
            dirty: false,
            revision: 3,
          },
          ...props,
        }),
      );

      expect(markup).toContain('aria-label="搜索素材"');
      expect(markup).toContain('data-testid="asset-library-usage-filter"');
      for (const usage of [
        'uncategorized',
        'background',
        'character',
        'prop',
        'effect',
      ]) {
        expect(markup).toContain(`value="${usage}"`);
      }
    }
  });

  it('shows the source FLA, library item, and selected frame for a committed snapshot asset', () => {
    const image = migrateProject(exampleProject).assets.find(
      (asset) => asset.kind === 'image',
    );
    if (!image || image.kind !== 'image') throw new Error('Expected an image fixture.');
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: {
          ...image,
          flaSnapshot: {
            sourceBasename: '蓝发修仙女.fla',
            sourceSha256: 'a'.repeat(64),
            targetName: '神女-cilisucai.com/神女-cilisucai.com809',
            sourceLibraryItemName: '神女-cilisucai.com/神女-cilisucai.com809',
            renderTargetId: 'fla-render-target-71289be86ab338b9c728b476f628b5708ec035560586326cc48e6af8eacfe8dd',
            selectedFrameIndex: 0,
            previewSha256: 'b'.repeat(64),
          },
        },
        references: [],
        busy: false,
        onDelete: noop,
        thumbnail: { status: 'ready', dataUrl: 'data:image/png;base64,AA==' },
      }),
    );
    expect(markup).toContain('data-testid="asset-fla-snapshot-origin"');
    expect(markup).toContain('蓝发修仙女.fla');
    expect(markup).toContain('神女-cilisucai.com/神女-cilisucai.com809');
    expect(markup).toContain('<dd>1</dd>');
    const originDescriptionList = markup.match(
      /<dl[^>]*data-testid="asset-fla-snapshot-origin"[^>]*>([\s\S]*?)<\/dl>/u,
    )?.[1];
    expect(originDescriptionList).toBeDefined();
    expect(originDescriptionList).toMatch(
      /<div><dt>来源 FLA<\/dt><dd>蓝发修仙女\.fla<\/dd><\/div>/u,
    );
    expect(originDescriptionList).toMatch(
      /<div><dt>源元件<\/dt><dd>神女-cilisucai\.com\/神女-cilisucai\.com809<\/dd><\/div>/u,
    );
    expect(originDescriptionList).toMatch(/<div><dt>源帧<\/dt><dd>1<\/dd><\/div>/u);
    expect(originDescriptionList).not.toMatch(/<div(?:\s[^>]*)?>\s*<div/u);
  });

  it('opens images directly in the compact authoring form without duplicate read-only metadata', () => {
    const image = migrateProject(exampleProject).assets.find(
      (asset) => asset.kind === 'image',
    );
    if (!image || image.kind !== 'image') throw new Error('Expected an image fixture.');
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: { ...image, name: '木门·关闭', usage: 'prop', keywords: ['门', '关闭'] },
        references: [],
        busy: false,
        onDelete: noop,
        onSaveImageMetadata: noop,
      }),
    );

    expect(markup).toContain('data-testid="asset-author-metadata-form"');
    expect(markup).toContain('data-testid="asset-author-name"');
    expect(markup).toContain('data-testid="asset-author-usage"');
    expect(markup).toMatch(/<option value="prop" selected="">道具<\/option>/u);
    expect(markup).toContain('data-testid="asset-author-keywords"');
    expect(markup).toContain('value="门, 关闭"');
    expect(markup).not.toContain('编辑名称、用途和关键词');
    expect(markup).not.toContain('已选素材');
    expect(markup).not.toContain('用逗号分隔，最多 8 个词');
  });

  it('keeps preview, references, technical details, and delete behind compact affordances', () => {
    const image = migrateProject(exampleProject).assets.find(
      (asset) => asset.kind === 'image',
    );
    if (!image || image.kind !== 'image') throw new Error('Expected an image fixture.');
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: {
          ...image,
          flaSnapshot: {
            sourceBasename: 'doors.fla',
            sourceSha256: 'a'.repeat(64),
            targetName: 'DoorClosed',
            sourceLibraryItemName: 'DoorClosed',
            renderTargetId: 'target-door-closed',
            selectedFrameIndex: 2,
            previewSha256: 'b'.repeat(64),
          },
        },
        busy: false,
        onDelete: noop,
        onSaveImageMetadata: noop,
        references: [{ label: '镜头 1 · 图层 2', path: 'shots/shot-1/layer-2' }],
        thumbnail: { status: 'ready', dataUrl: 'data:image/png;base64,AA==' },
      }),
    );

    expect(markup).toContain('data-testid="asset-details-thumbnail"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('被 1 处使用');
    expect(markup).toContain('shots/shot-1/layer-2');
    expect(markup).toContain('详细信息');
    expect(markup).toContain('doors.fla');
    expect(markup).toContain('asset-details-delete-action');
    expect(markup).not.toContain('asset-reference-warning');
    expect(markup).not.toContain('asset-delete-button');
  });

  it('renders a clear empty state for a category with no assets', () => {
    const project = migrateProject({
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
    expect(markup).toContain('素材库还是空的');
    expect(markup).toContain(
      '拖进图片或音频，或者点上面的「导入素材」。',
    );
  });

  it('does not call a merely empty category an empty library', () => {
    const project = migrateProject(exampleProject);
    const categoryOnlyProject = {
      ...project,
      assets: project.assets.filter((asset) => asset.kind === 'audio'),
      characters: [],
      shots: [],
    };
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        snapshot: {
          projectRoot: 'D:\\category-only.pandastage',
          project: categoryOnlyProject,
          dirty: false,
          revision: 0,
        },
      }),
    );

    expect(markup).toContain('这个分类还没有素材');
    expect(markup).not.toContain('素材库还是空的');
  });

  it('renders 100 lazy thumbnail cards without any original asset URL', () => {
    const entries: AssetLibraryEntry[] = Array.from(
      { length: 100 },
      (_, index) => {
        const asset = {
          id: randomUUID(),
          name: `Fixture ${index}`,
          relativePath: `assets/original-${index}.png`,
          mimeType: 'image/png',
          kind: 'image' as const,
          width: 16,
          height: 12,
          usage: 'uncategorized' as const,
          keywords: [],
        };
        return {
          id: `asset:${asset.id}`,
          category: 'background',
          asset,
          contextLabel: '图片',
          dropPayload: directPayload(asset.id),
        };
      },
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
    const project = migrateProject(exampleProject);
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
      contextLabel: '图片',
      dropPayload: directPayload(failedAsset.id),
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
          {
            id: `asset:${failedAsset.id}`,
            asset: failedAsset,
            category: 'background',
            contextLabel: '图片',
            dropPayload: directPayload(failedAsset.id),
          },
          {
            id: `asset:${healthyAsset.id}`,
            asset: healthyAsset,
            category: 'background',
            contextLabel: '图片',
            dropPayload: directPayload(healthyAsset.id),
          },
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
