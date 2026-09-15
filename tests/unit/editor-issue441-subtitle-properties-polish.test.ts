import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssetCard } from '../../src/renderer/features/assets/AssetCard';
import { migrateProject } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function sectionAfter(haystack: string, marker: string): string {
  const start = haystack.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  return haystack.slice(start);
}

function sectionBetween(
  haystack: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = haystack.indexOf(startMarker);
  const end = haystack.indexOf(endMarker, start);
  if (start < 0) throw new Error(`start not found: ${startMarker}`);
  if (end < 0) throw new Error(`end not found: ${endMarker}`);
  return haystack.slice(start, end);
}

describe('Issue #441 day29 subtitle Properties UI polish', () => {
  it('keeps the single RightInspector owner and the existing mutation paths', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const library = source('src/renderer/features/assets/AssetLibrary.tsx');
    const card = source('src/renderer/features/assets/AssetCard.tsx');
    const details = source('src/renderer/features/assets/AssetDetails.tsx');
    const importPanel = source(
      'src/renderer/features/assets/AssetImportPanel.tsx',
    );
    const preview = source('src/renderer/shell/ProductPreviewOverlay.tsx');

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('<DialogueInspector');
    expect(dialogue).toContain('dialogueStore.update');
    expect(dialogue).toContain('dialogueStore.setTiming');
    expect(dialogue).toContain('dialogueStore.arrange');
    expect(dialogue).toContain('dialogueStore.remove');
    expect(dialogue).toContain('dialogueStore.bindAudio');
    expect(dialogue).not.toContain('new DialogueStore');
    expect(dialogue).not.toContain('ProductPreview');
    expect(dialogue).not.toContain('mouthPreview');
    expect(library).not.toContain('MouthPreview');
    expect(card).not.toContain('MouthPreview');
    expect(details).not.toContain('MouthPreview');
    expect(importPanel).not.toContain('MouthPreview');
    expect(preview).not.toContain('readAudio');
    expect(preview).not.toContain('ProductPreviewAudioTransport');
  });

  it('uses 编辑字幕 / 字幕内容 and removes the redundant Character identity stack', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const properties = dialogue.slice(propertiesStart, landscapeStart);

    // A08 keeps the existing text editor and owners while making the header
    // describe the editing task and removing repeated Character identity.
    expect(properties).toContain('aria-label="编辑字幕"');
    expect(properties).toContain('data-testid="dialogue-properties-header"');
    expect(properties).toContain('data-testid="dialogue-properties-identity"');
    expect(properties).toContain('dialogue-properties-inline-text');
    expect(properties).toContain('字幕内容');
    expect(properties).not.toContain('<CharacterAvatar');
    // The old 当前选择 eyebrow + 已定时字幕 redundant row remain gone.
    expect(properties).not.toContain('当前选择');
    expect(properties).not.toContain('已定时字幕');
    expect(properties).not.toContain('待安排字幕');
  });

  it('uses 配音 / 选择配音 / 安排到时间轴后即可添加配音 product copy in properties + landscape + timeline', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const timelineStart = dialogue.indexOf('if (timelinePresentation)');
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const fallbackStart = dialogue.indexOf(
      '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    );
    const timeline = dialogue.slice(
      timelineStart,
      propertiesStart > 0 ? propertiesStart : undefined,
    );
    const properties = dialogue.slice(propertiesStart, landscapeStart);
    const landscape = dialogue.slice(landscapeStart, fallbackStart);

    for (const slice of [timeline, properties, landscape]) {
      // The audio section is always titled 配音 now (not 音频).
      expect(slice).toContain('配音');
      expect(slice).not.toMatch(/<h3>\s*音频\s*<\/h3>/);
    }

    // The shared audioBindingControl and the Untimed progressive-disclosure
    // message live in the audioBindingControl definition, which is referenced
    // (not redeclared) by both the properties and landscape sections; assert
    // the new product copy against the full source.
    expect(dialogue).toContain("aria-label={audioClip ? '更换配音' : '选择配音'}");
    expect(dialogue).toContain("'选择配音'");
    expect(dialogue).toContain("'当前项目没有可用配音'");
    expect(dialogue).toContain('安排到时间轴后即可添加配音');
    expect(dialogue).toContain('data-testid="dialogue-inspector-untimed-audio"');
    expect(dialogue).not.toContain('选择 Ready 音频');
    expect(dialogue).not.toContain('先安排字幕时间');
    expect(dialogue).not.toContain('当前项目没有音频素材');
    expect(dialogue).not.toContain('对白音频绑定失败');
    expect(dialogue).not.toContain('未绑定音频');
    expect(dialogue).not.toContain('已绑定音频');
    expect(dialogue).not.toContain('音频播放区间独立于字幕时间');
    expect(dialogue).not.toContain('只可绑定已完成时长分析的素材');
    expect(dialogue).toContain('配音绑定失败。');

    // Timeline remains feedback-only while the normal bound Properties state
    // no longer repeats a persistent binding-state label.
    expect(dialogue).not.toContain('还没有配音');
    expect(dialogue).not.toContain('为这条字幕选择角色配音。');
    expect(dialogue).not.toContain("' · 已绑定'");
    expect(timeline).toContain('配音');
  });

  it('renames 一键安排 to 快速安排 across all three presentations and removes dev-ish notes', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const timelineStart = dialogue.indexOf('if (timelinePresentation)');
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const fallbackStart = dialogue.indexOf(
      '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    );
    const timeline = dialogue.slice(
      timelineStart,
      propertiesStart > 0 ? propertiesStart : undefined,
    );
    const properties = dialogue.slice(propertiesStart, landscapeStart);
    const landscape = dialogue.slice(landscapeStart, fallbackStart);

    for (const slice of [timeline, properties, landscape]) {
      // The previous "安排一帧" / "安排为一帧" wording was implementation-flavored
      // and the polish replaces it with the secondary 快速安排 helper copy.
      expect(slice).toContain('快速安排');
      expect(slice).not.toContain('安排一帧');
      expect(slice).not.toContain('安排为一帧');
      // The dev-ish "待安排字幕尚未产生显示时间窗" is replaced with a
      // product-language follow-up.
      expect(slice).not.toContain('待安排字幕尚未产生显示时间窗');
      expect(slice).toContain('安排后即会在时间轴产生显示窗口');
    }

    // The current-only 当前仅展示已有绑定状态 dev note in the timeline
    // audio section is removed; the audio summary line is enough.
    expect(timeline).not.toContain('当前仅展示已有绑定状态');
  });

  it('does not introduce Preview / Mouth code or new property owners', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const properties = sectionAfter(
      dialogue,
      'if (propertiesPresentation)',
    );

    expect(properties).not.toContain('Mouth');
    expect(properties).not.toContain('mouthPreview');
    expect(properties).not.toContain('PreviewPlayer');
    expect(properties).not.toContain('useAudioPlayback');
    expect(properties).not.toContain('setProject');
    expect(properties).not.toContain('new AudioClipStore');
  });

  it('productizes the Phase-1 audio metadata copy across AssetCard / AssetDetails / AssetLibrary / AssetImportPanel', () => {
    const card = source('src/renderer/features/assets/AssetCard.tsx');
    const details = source('src/renderer/features/assets/AssetDetails.tsx');
    const importPanel = source(
      'src/renderer/features/assets/AssetImportPanel.tsx',
    );
    const library = source('src/renderer/features/assets/AssetLibrary.tsx');

    for (const sourceText of [card, details, importPanel, library]) {
      // Old engineering jargon is removed from the user-facing audio metadata
      // presentation. The codes and test ids remain for downstream consumers.
      expect(sourceText).not.toContain('等待 / 正在分析');
      expect(sourceText).not.toContain('重试分析');
      expect(sourceText).not.toContain('重试音频分析');
      expect(sourceText).not.toContain('时长 Ready');
    }

    expect(card).toContain('正在准备…');
    expect(card).toContain('可用');
    expect(card).toContain('无法读取配音');

    expect(details).toContain('正在准备…');
    expect(details).toContain('可用');
    expect(details).toContain('无法读取配音');

    expect(importPanel).toContain('个配音时长分析失败');
    expect(importPanel).toContain('已导入');
    expect(importPanel).toContain('时长分析失败');
    expect(importPanel).not.toContain('段配音已准备好');
    expect(importPanel).not.toContain('个 Ready');
    expect(importPanel).not.toContain('音频分析完成');

    expect(library).toContain('正在准备配音…');
    expect(library).toContain('配音已准备好。');
    expect(library).toContain('无法读取配音。');
  });

  it('keeps the audio metadata status data-attribute and code-level error semantics intact', () => {
    const card = source('src/renderer/features/assets/AssetCard.tsx');
    const details = source('src/renderer/features/assets/AssetDetails.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(card).toContain('data-audio-metadata-status={audioState ?? undefined}');
    expect(details).toContain('data-audio-metadata-status={metadataState}');
    // The functional "only valid metadata-ready audio may be bound" rule is
    // preserved through the existing metadata gate.
    expect(dialogue).toContain("asset.metadata?.status !== 'error'");
    expect(dialogue).toContain('disabled={!ready}');
  });

  it('renders the new product copy on the audio AssetCard markup', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;

    const pending = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: { ...audio, durationMs: undefined },
        category: 'audio',
        contextLabel: 'audio',
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
    const ready = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: {
          ...audio,
          durationMs: 1_250,
          metadata: { status: 'ready', warnings: [] },
        },
        category: 'audio',
        contextLabel: 'audio',
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
    const failed = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: {
          ...audio,
          durationMs: undefined,
          metadata: {
            status: 'error',
            code: 'ASSET_METADATA_INVALID_AUDIO',
            message: 'Audio probe failed.',
          },
        },
        category: 'audio',
        contextLabel: 'audio',
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

    expect(pending).toContain('data-audio-metadata-status="pending"');
    expect(pending).toContain('正在准备…');
    expect(ready).toContain('data-audio-metadata-status="ready"');
    expect(ready).toContain('可用');
    expect(failed).toContain('data-audio-metadata-status="error"');
    expect(failed).toContain('Audio probe failed.');
    expect(failed).toContain('重试');
  });

  it('adds scoped local styles for the new dialogue-properties-untimed-audio / summary classes', () => {
    const styles = source('src/renderer/styles.css');
    const tail = sectionBetween(
      styles,
      '/* Issue #441:',
      '/* Issue #441:',
    ) || styles.slice(styles.indexOf('/* Issue #441:'));

    expect(tail).toContain('Issue #441:');
    expect(tail).toContain('.dialogue-properties-summary');
    expect(tail).toContain('.dialogue-properties-untimed-audio');
    expect(tail).toContain('.dialogue-properties-audio-summary-line');
    expect(tail).toContain('.dialogue-landscape-properties-audio-summary');
    expect(tail).toContain('.editor-shell[data-editor-device-mode=\'cloud-touch\']');
  });
});
