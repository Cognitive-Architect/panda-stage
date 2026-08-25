import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #330 portrait Timeline first pass', () => {
  it('uses the approved Chinese top-level Timeline label', () => {
    const switcher = source(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );

    expect(switcher).toContain("{ value: 'timeline', label: '时间轴' }");
    expect(switcher).not.toContain("label: 'Timeline'");
    expect(switcher).toContain("label: '画布'");
    expect(switcher).toContain("label: '素材'");
    expect(switcher).toContain("label: '属性'");
  });

  it('reuses the single Canvas slot and keeps Timeline session-only', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
    expect(shell).toContain("portraitWorkspace === 'timeline'");
    expect(shell).toContain("portraitWorkspace !== 'timeline'");
    expect(shell).toContain('dialogueSelectionVisible=');
    expect(shell).not.toContain('timelineStore');
    expect(bottom).toContain('<TimelineDock presentation={presentation} />');
  });

  it('promotes the existing ruler and clip owners while exposing read-only audio data', () => {
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );

    expect(timeline).toContain('timelineUiStore.seek');
    expect(timeline).toContain('<DialogueClip');
    expect(timeline).toContain('shot?.audioClips');
    expect(timeline).toContain('data-testid="timeline-subtitle-track"');
    expect(timeline).toContain('data-testid="timeline-audio-track"');
    expect(timeline).toContain('data-testid="timeline-audio-clip"');
    expect(timeline).not.toContain('updateProject');
  });

  it('makes the current subtitle editor primary and keeps authoring tools secondary', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(sheet).toContain('<DialogueInspector');
    expect(sheet).toContain('presentation="timeline"');
    expect(sheet).toContain('timeline-subtitle-empty');
    expect(sheet).toContain('dialogue-secondary-tools');
    expect(sheet).toContain('dialogue-batch-open');
    expect(sheet).toContain('dialogue-add');
    expect(inspector).toContain("'inspector' | 'timeline'");
    expect(inspector).toContain('dialogueStore.update');
    expect(inspector).toContain('dialogueStore.setTiming');
  });

  it('gives portrait Timeline one intentional vertical flow and no fake transport owner', () => {
    const styles = source('src/renderer/styles.css');
    const preview = source('src/renderer/shell/ProductPreviewOverlay.tsx');

    expect(styles).toContain(
      ".editor-layout[data-active-workspace='timeline']",
    );
    expect(styles).toContain(
      ".editor-body[data-active-workspace='timeline']",
    );
    expect(styles).toContain('.dialogue-secondary-tools');
    expect(styles).toContain('.timeline-audio-clip');
    expect(preview).toContain('product-preview-play');
    expect(preview).toContain('product-preview-pause');
    expect(styles).not.toContain('.timeline-transport');
  });
});
