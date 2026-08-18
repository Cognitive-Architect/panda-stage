import {
  createElement,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssetMetadataResponseSchema,
} from '../../src/shared/asset-metadata-api';
import { AssetImportResponseSchema } from '../../src/shared/asset-import-api';
import { migrateProject, ProjectSchema } from '../../src/domain';
import { AssetCard } from '../../src/renderer/features/assets/AssetCard';
import { AssetDetails } from '../../src/renderer/features/assets/AssetDetails';
import {
  selectImportedAudioAssetIds,
} from '../../src/renderer/features/assets/AssetImportPanel';
import { applyAssetMetadataResponse } from '../../src/renderer/features/assets/applyAssetMetadataResponse';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

const noop = () => undefined;

function audioCardMarkup(
  asset: ReturnType<typeof migrateProject>['assets'][number],
): string {
  return renderToStaticMarkup(
    createElement(AssetCard, {
      asset,
      category: 'audio',
      contextLabel: 'audio',
      dropPayload: {
        version: 2,
        type: 'asset-image',
        assetId: asset.id,
      },
      selected: false,
      dragging: false,
      thumbnail: { status: 'loading' },
      onSelect: noop,
      onDragStart: noop,
      onDragEnd: noop,
      onRebuildThumbnail: noop,
      onThumbnailError: noop,
    }),
  );
}

describe('audio metadata product path', () => {
  it('renders pending, ready, and retryable error states on audio cards', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const pending = audioCardMarkup({ ...audio, durationMs: undefined });
    const ready = audioCardMarkup({
      ...audio,
      durationMs: 1_250,
      metadata: { status: 'ready', warnings: [] },
    });
    const failed = audioCardMarkup({
      ...audio,
      durationMs: undefined,
      metadata: {
        status: 'error',
        code: 'ASSET_METADATA_INVALID_AUDIO',
        message: 'Audio probe failed.',
      },
    });

    expect(pending).toContain('data-audio-metadata-status="pending"');
    expect(pending).toContain('Audio metadata pending / analyzing');
    expect(ready).toContain('data-audio-metadata-status="ready"');
    expect(ready).toContain('1.25 s');
    expect(failed).toContain('data-audio-metadata-status="error"');
    expect(failed).toContain('Audio probe failed.');
    expect(failed).toContain('Retry analysis');
  });

  it('shows the same error and retry action in asset details', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: { ...audio, durationMs: undefined },
        busy: false,
        metadataError: 'The audio source is missing.',
        onDelete: noop,
        onRefreshMetadata: noop,
        references: [],
      }),
    );

    expect(markup).toContain('data-audio-metadata-status="error"');
    expect(markup).toContain('The audio source is missing.');
    expect(markup).toContain('Retry audio analysis');
  });

  it('selects only newly imported audio assets for automatic analysis', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const importedAudio = { ...audio, id: '16000000-0000-4000-8000-000000000001' };
    const importedImage = project.assets.find((asset) => asset.kind === 'image')!;
    const response = AssetImportResponseSchema.parse({
      ok: true,
      status: 'completed',
      project,
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      results: [
        {
          sourceName: 'voice.mp3',
          status: 'imported',
          sha256: 'a'.repeat(64),
          asset: importedAudio,
          duplicateOfAssetId: null,
          code: null,
          message: 'imported',
        },
        {
          sourceName: 'image.png',
          status: 'imported',
          sha256: 'b'.repeat(64),
          asset: importedImage,
          duplicateOfAssetId: null,
          code: null,
          message: 'imported',
        },
      ],
    });

    expect(selectImportedAudioAssetIds(response)).toEqual([
      importedAudio.id,
    ]);
  });

  it('applies a persisted metadata error so the renderer does not stay pending', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const errorAsset = {
      ...audio,
      metadata: {
        status: 'error' as const,
        code: 'ASSET_METADATA_INVALID_AUDIO' as const,
        message: 'Audio probe failed.',
      },
    };
    const savedProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === audio.id ? errorAsset : asset,
      ),
    });
    const response = AssetMetadataResponseSchema.parse({
      ok: true,
      project: savedProject,
      baseRevision: 0,
      savedRevision: 1,
      result: {
        status: 'error',
        asset: errorAsset,
        error: {
          code: 'ASSET_METADATA_INVALID_AUDIO',
          message: 'Audio probe failed.',
        },
      },
    });
    const store = new EditorProjectStore();
    store.open('D:\\audio.pandastage', project);

    const outcome = applyAssetMetadataResponse(response, store);

    expect(outcome).toEqual({
      applied: true,
      status: 'Audio probe failed.',
    });
    expect(store.getSnapshot()?.project.assets).toContainEqual(errorAsset);
  });
});
