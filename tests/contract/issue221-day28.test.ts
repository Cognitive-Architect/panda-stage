import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(`src/${relativePath}`, 'utf8');
}

describe('Issue 221 Day28 architecture contracts', () => {
  it('keeps one timeline/playhead owner and isolates clip pointer input', () => {
    const timeline = source('renderer/features/timeline/TimelineDock.tsx');
    const clip = source('renderer/features/timeline/DialogueClip.tsx');
    expect(timeline).toContain('<DialogueClip');
    expect(timeline).toContain('timelineUiStore.seek');
    expect(clip).toContain('dialogueStore.move');
    expect(clip).toContain('dialogueStore.resize');
    expect(clip).not.toContain('timelineUiStore.seek');
    expect(clip).not.toContain('updateProject(');
    expect(clip).toContain('event.stopPropagation()');
  });

  it('keeps timing/style/audio writes behind DialogueService and EditorProjectStore', () => {
    const service = source('domain/services/DialogueService.ts');
    const store = source('renderer/stores/dialogueStore.ts');
    const editor = source('renderer/features/dialogue/DialogueEditor.tsx');
    expect(service).toContain('DIALOGUE_DEFAULT_DURATION_MS');
    expect(service).toContain('DIALOGUE_OVERLAP');
    expect(service).toContain('clipDurationMs');
    expect(store).toContain('this.editorStore.updateProject');
    expect(editor).toContain('dialogueStore.setTiming');
    expect(editor).toContain('dialogueStore.attachAudio');
    expect(editor).not.toContain('project.shots.map');
  });

  it('uses one subtitle renderer and deterministic preview audio/mouth inputs', () => {
    const stage = source('renderer/stage/StageRenderer.tsx');
    const subtitle = source('renderer/features/subtitles/SubtitleRenderer.tsx');
    const preview = source('renderer/shell/ProductPreviewOverlay.tsx');
    const audio = source('renderer/features/preview/AudioScheduler.ts');
    expect(stage).toContain('<SubtitleRenderer');
    expect(subtitle).toContain('listening={false}');
    expect(preview).toContain('includeMouthMotion: true');
    expect(preview).toContain('readAudio');
    expect(audio).toContain('this.source.playbackRate = 1');
    expect(audio).not.toContain('playbackRate = target');
  });
});
