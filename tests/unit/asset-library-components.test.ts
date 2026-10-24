import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject } from '../../src/domain';
import { AssetGrid } from '../../src/renderer/features/assets/AssetGrid';
import {
  AssetCard,
  type ThumbnailState,
} from '../../src/renderer/features/assets/AssetCard';
import { AssetDetails } from '../../src/renderer/features/assets/AssetDetails';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';
import { IMAGE_ASSET_USAGE_OPTIONS } from '../../src/renderer/features/assets/assetUsage';
import { ResourceActivityDock } from '../../src/renderer/shell/ResourceActivityDock';
import type { AssetLibraryEntry } from '../../src/renderer/stores/assetLibrarySelectors';
import exampleProject from '../../demo-project/project-v1.example.json';

const assetLibrarySource = readFileSync(
  new URL('../../src/renderer/features/assets/AssetLibrary.tsx', import.meta.url),
  'utf8',
);
const assetCategoryTabsStyle = readFileSync(
  new URL(
    '../../src/renderer/styles/features/assets/asset-library-category-tabs.css',
    import.meta.url,
  ),
  'utf8',
);

const noop = () => undefined;
const directPayload = (assetId: string) => ({
  version: 2 as const,
  type: 'asset-image' as const,
  assetId,
});

describe('asset library components', () => {
  it('does not reserve an empty status row after a quiet FLA review close', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 3,
        },
        hideHeading: true,
      }),
    );
    const closeStart = assetLibrarySource.indexOf(
      'const closeFlaReview = useCallback',
    );
    const closeEnd = assetLibrarySource.indexOf('}, []);', closeStart);
    const closeHandler = assetLibrarySource.slice(closeStart, closeEnd);

    expect(markup).not.toContain('class="asset-library-status"');
    expect(assetLibrarySource).not.toContain(
      'FLA review closed; Project and Asset state are unchanged.',
    );
    expect(closeHandler).not.toContain('setStatus(');
    expect(closeHandler).toContain('flaInspectionLifecycle.current?.cancel()');
    expect(assetLibrarySource).toContain(
      '{status ? <output className="asset-library-status">{status}</output> : null}',
    );
    expect(assetLibrarySource).toContain('setStatus(outcome.status);');
    expect(assetLibrarySource).toContain('setStatus(message);');
  });

  it('sizes category tabs from their content and scrolls when the row is narrow', () => {
    expect(assetCategoryTabsStyle).toMatch(
      /\.asset-library\s+\.asset-category-tabs\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/u,
    );
    expect(assetCategoryTabsStyle).toMatch(
      /\.asset-library\s+\.asset-category-tabs\s+button\s*\{[^}]*min-width:\s*max-content;[^}]*flex:\s*1\s+0\s+max-content;[^}]*justify-content:\s*space-between;/u,
    );
    expect(assetCategoryTabsStyle).toContain('min-height: 48px;');
    expect(assetCategoryTabsStyle).toContain('min-height: 44px;');
    expect(assetCategoryTabsStyle).not.toMatch(
      /grid-template-columns:\s*repeat\((?:2|4|5),/u,
    );
  });

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
    expect(markup).toContain('asset-library-heading-visually-hidden');
    expect(markup).toContain('全部');
    expect(markup).toContain('角色图片');
    expect(markup).toContain('未绑定角色');
    expect(markup).toContain('音频');
    expect(markup).toContain('data-testid="asset-library-usage-filter"');
    expect(markup).toContain('aria-label="按用途筛选"');
    expect(markup).toContain('导入项目素材');
    expect(markup).toContain('data-testid="asset-browser-view"');
    expect(markup).toContain('导入 FLA');
    expect(markup).toContain(
      '打开 FLA 后可先预览并选择需要的素材，确认导入前不会修改项目。',
    );
    expect(markup).not.toContain('Import FLA...');
    expect(markup).toContain('data-testid="asset-import-fla"');
    expect(markup).not.toContain(
      '打开项目后，可把 PNG、JPG、MP3 或 WAV 安全复制到项目中。',
    );
    expect(markup).not.toContain('也可直接拖入');
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

  it('includes animations in the All count and the same paginated asset grid', () => {
    const base = migrateProject(exampleProject);
    const image = base.assets.find((asset) => asset.kind === 'image');
    if (!image || image.kind !== 'image') throw new Error('Expected an image fixture.');
    const frameDurationMs = 1_000 / 25;
    const project = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === image.id ? { ...asset, sha256: 'a'.repeat(64) } : asset,
      ),
      animations: [{
        id: randomUUID(),
        name: 'Walk cycle',
        source: {
          basename: 'walk.fla',
          sha256: 'b'.repeat(64),
          renderTargetId: 'fla-render-target-test-walk',
          targetKind: 'graphic-symbol',
          targetName: 'Walk',
          startFrameIndex: 0,
          endFrameIndex: 0,
          sourceFps: 25,
          canvas: { width: 1920, height: 1080 },
          documentCanvas: { width: 1920, height: 1080 },
          anchor: { x: 0, y: 0 },
        },
        durationMs: frameDurationMs,
        frames: [{
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: image.id,
          sha256: 'a'.repeat(64),
          sourceViewport: { x: 960, y: 540, width: 960, height: 540 },
          offset: { x: 960, y: 540 },
          startMs: 0,
          durationMs: frameDurationMs,
          createdBySequenceImport: false,
        }],
      }],
    });
    const markup = renderToStaticMarkup(createElement(AssetLibrary, {
      snapshot: {
        projectRoot: 'D:\\project.pandastage',
        project,
        dirty: false,
        revision: 3,
      },
      hideHeading: true,
    }));

    expect(markup).toContain('<span>全部</span><strong>5</strong>');
    expect(markup).toContain('data-grid-count="5"');
    expect(markup).toContain('data-testid="animation-library-card"');
  });

  it('removes the Asset Browser title while keeping the workspace accessible', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(ResourceActivityDock, {
        activeActivity: 'assets',
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 3,
        },
      }),
    );

    expect(markup).toContain('<section aria-label=');
    expect(markup).not.toContain('id="resource-activity-heading"');
    expect(markup).toContain('data-testid="resource-primary-action"');
    expect(markup).toContain('asset-library-heading-visually-hidden');
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
      expect(markup).toContain('aria-haspopup="menu"');
      expect(assetLibrarySource).toContain('role="menu"');
      expect(assetLibrarySource).toContain('role="menuitemradio"');
      expect(assetLibrarySource).toContain(
        'data-usage-filter-value={option.value}',
      );
      expect(assetLibrarySource).toContain('...IMAGE_ASSET_USAGE_OPTIONS');
      expect(IMAGE_ASSET_USAGE_OPTIONS.map(({ value }) => value)).toEqual([
        'uncategorized',
        'background',
        'character',
        'prop',
        'effect',
      ]);
    }
  });

  it('keeps FLA origin metadata out of the compact asset detail surface', () => {
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
    expect(markup).not.toContain('asset-fla-snapshot-origin');
    expect(markup).not.toContain('蓝发修仙女.fla');
    expect(markup).not.toContain('神女-cilisucai.com/神女-cilisucai.com809');
    expect(markup).not.toContain('详细信息');
    expect(markup).not.toContain('项目内路径');
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

  it('keeps references collapsed and shows only human labels in compact details', () => {
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
    expect(markup).toContain('<span>图片</span>');
    expect(markup).toContain('被 1 处使用');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('镜头 1 · 图层 2');
    expect(markup).not.toContain('shots/shot-1/layer-2');
    expect(markup).not.toContain('详细信息');
    expect(markup).not.toContain('doors.fla');
    expect(markup).not.toContain('data-testid="asset-fla-snapshot-origin"');
    expect(markup).toContain('asset-details-delete-action');
    expect(markup).not.toContain('asset-reference-warning');
    expect(markup).not.toContain('asset-delete-button');
  });

  it('shows a count and labels for multiple references, with no row for none', () => {
    const image = migrateProject(exampleProject).assets.find(
      (asset) => asset.kind === 'image',
    );
    if (!image || image.kind !== 'image') throw new Error('Expected an image fixture.');

    const multiple = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: image,
        busy: false,
        onDelete: noop,
        references: [
          { label: '角色“新角色”的张嘴图片', path: 'characters[0].mouthOpenAssetId' },
          { label: '镜头“Opening”的背景图层“Background”', path: 'shots[0].layers[0].source.assetId' },
        ],
      }),
    );
    const unreferenced = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: image,
        busy: false,
        onDelete: noop,
        references: [],
      }),
    );

    expect(multiple).toContain('被 2 处使用');
    expect(multiple).toContain('角色“新角色”的张嘴图片');
    expect(multiple).toContain('镜头“Opening”的背景图层“Background”');
    expect(multiple).not.toContain('characters[0].mouthOpenAssetId');
    expect(multiple).not.toContain('shots[0].layers[0].source.assetId');
    expect(unreferenced).not.toContain('asset-details-disclosure');
    expect(unreferenced).not.toContain('当前未被项目使用');
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
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(AssetGrid, {
        items: entries.map((entry) => ({ kind: 'asset' as const, id: entry.id, entry })),
        project,
        projectRoot: 'D:\\project.pandastage',
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
        items: [
          {
            kind: 'asset' as const,
            id: `asset:${failedAsset.id}`,
            entry: {
              id: `asset:${failedAsset.id}`,
              asset: failedAsset,
              category: 'background' as const,
              contextLabel: '图片',
              dropPayload: directPayload(failedAsset.id),
            },
          },
          {
            kind: 'asset' as const,
            id: `asset:${healthyAsset.id}`,
            entry: {
              id: `asset:${healthyAsset.id}`,
              asset: healthyAsset,
              category: 'background' as const,
              contextLabel: '图片',
              dropPayload: directPayload(healthyAsset.id),
            },
          },
        ],
        project,
        projectRoot: 'D:\\project.pandastage',
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
