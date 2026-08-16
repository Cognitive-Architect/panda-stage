import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(`src/${relativePath}`, 'utf8');
}

describe('Issue 221/223 Day28 architecture contracts', () => {
  it('restores Untimed creation and keeps timing explicit', () => {
    const service = source('domain/services/DialogueService.ts');
    const inspector = source(
      'renderer/features/dialogue/DialogueInspector.tsx',
    );
    expect(service).toContain('startMs: timeMs');
    expect(service).toContain('endMs: timeMs');
    expect(service).not.toContain('DIALOGUE_DEFAULT_DURATION_MS');
    expect(service).not.toContain('index *');
    expect(service).toContain('arrange(project: Project');
    expect(inspector).toContain('integerFrameSpanMs()');
    expect(inspector).toContain('dialogueStore.arrange');
  });

  it('keeps Untimed entries visible/selectable in the existing Timeline', () => {
    const timeline = source('renderer/features/timeline/TimelineDock.tsx');
    const clip = source('renderer/features/timeline/DialogueClip.tsx');
    expect(timeline).toContain('shot?.dialogues.map');
    expect(timeline).not.toContain(
      '.filter((dialogue) => dialogue.endMs > dialogue.startMs)',
    );
    expect(clip).toContain("timed ? 'timed' : 'untimed'");
    expect(clip).toContain('dialogueSelectionStore.select(dialogue.id)');
    expect(clip).toContain('data-timed={String(timed)}');
  });

  it('binds pointer commit to project/shot/dialogue identity and isolates ruler seek', () => {
    const clip = source('renderer/features/timeline/DialogueClip.tsx');
    const guard = source(
      'renderer/features/timeline/dialogueGesture.ts',
    );
    expect(clip).toContain(
      'identity: { projectRoot, shotId, dialogueId: dialogue.id }',
    );
    expect(clip).toContain('shouldCommitDialogueGesture');
    expect(clip).toContain('onPointerCancel={cancelDrag}');
    expect(clip).toContain("event.key === 'Escape'");
    expect(guard).toContain('context.projectRoot === identity.projectRoot');
    expect(guard).toContain('context.shotId === identity.shotId');
    expect(guard).toContain(
      'context.selectedDialogueId === identity.dialogueId',
    );
    expect(guard).toContain(
      'context.dialogueIds.includes(identity.dialogueId)',
    );
    expect(guard).toContain('event.stopPropagation()');
    expect(clip).not.toContain('timelineUiStore.seek');
  });

  it('uses one shared subtitle projection/evaluator and presentation owner', () => {
    const canvas = source('renderer/features/canvas/CanvasStage.tsx');
    const preview = source('renderer/shell/ProductPreviewOverlay.tsx');
    const model = source('renderer/shell/productPreviewModel.ts');
    const subtitle = source(
      'renderer/features/subtitles/SubtitleRenderer.tsx',
    );
    expect(canvas).toContain('buildDialogueSubtitleCues');
    expect(canvas).toContain('evaluateSubtitleAtTime');
    expect(model).toContain('buildDialogueSubtitleCues');
    expect(preview).toContain('evaluateSubtitleAtTime');
    expect(subtitle).toContain('listening={false}');
    expect(canvas).not.toContain('evaluateDialogueAtTime');
  });

  it('contains no Day28 audio/mouth scope or persisted subtitle stroke expansion', () => {
    const service = source('domain/services/DialogueService.ts');
    const preview = source('renderer/shell/ProductPreviewOverlay.tsx');
    const subtitleModel = source('domain/models/subtitle.ts');
    expect(service).not.toContain('attachAudio');
    expect(service).not.toContain('detachAudio');
    expect(preview).not.toContain('AudioScheduler');
    expect(preview).not.toContain('includeMouthMotion');
    expect(preview).not.toContain('readAudio');
    expect(subtitleModel).not.toContain('strokeColor');
    expect(subtitleModel).not.toContain('strokeWidth');
  });
});
