import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { AssetCard } from '../../src/renderer/features/assets/AssetCard';
import exampleProject from '../../demo-project/project-v1.example.json';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #439 Phase 1 current-owner Audio UI', () => {
  it('renders the binding action in both current Properties presentations', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const properties = dialogue.slice(propertiesStart, landscapeStart);
    const landscape = dialogue.slice(landscapeStart);

    expect(dialogue).toContain('data-testid="dialogue-inspector-audio"');
    expect(dialogue).toContain('dialogueStore.bindAudio');
    expect(dialogue).toContain("asset.metadata?.status !== 'error'");
    expect(properties).toContain('{audioBindingControl}');
    expect(landscape).toContain('{audioBindingControl}');
    expect(dialogue).toContain('配音');
    expect(dialogue).toContain('安排到时间轴后即可添加配音');
    expect(dialogue).toContain('data-testid="dialogue-inspector-untimed-audio"');
    expect(dialogue).toContain("aria-label={audioClip ? '更换配音' : '选择配音'}");
    expect(dialogue).toContain('data-testid="dialogue-inspector-audio-unbind"');
    expect(dialogue).toContain('dialogueStore.unbindAudio');
    expect(dialogue).toContain('移除配音');
    expect(dialogue).toContain('{audioClip ? (');
  });

  it('keeps metadata state and retry inside the current asset card', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const markup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: {
          ...audio,
          durationMs: undefined,
          metadata: {
            status: 'error',
            code: 'ASSET_METADATA_INVALID_AUDIO',
            message: 'Cannot inspect audio',
          },
        },
        category: 'audio',
        contextLabel: '音频',
        dropPayload: {
          version: 2,
          type: 'audio',
          assetId: audio.id,
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
    expect(markup).toContain('data-audio-metadata-status="error"');
    expect(markup).toContain('Cannot inspect audio');
    expect(markup).toContain('重试');
  });

  it('retains the single current owners and does not wire Preview playback', () => {
    const library = source('src/renderer/features/assets/AssetLibrary.tsx');
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const rightInspector = source('src/renderer/shell/RightInspector.tsx');
    const preview = source('src/renderer/shell/ProductPreviewOverlay.tsx');

    expect(library).toContain('<FlaCompatibilityReviewSession');
    expect(library).toContain('refreshImportedAudioMetadata');
    expect(rightInspector.match(/<DialogueInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('dialogueStore.bindAudio');
    expect(inspector).not.toContain('new DialogueStore');
    expect(preview).not.toContain('readAudio');
    expect(preview).not.toContain('ProductPreviewAudioTransport');
  });
});
