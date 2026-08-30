import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function issue379Styles(styles: string): string {
  const start = styles.lastIndexOf('/* Issue #379:');
  if (start < 0) throw new Error('Issue #379 styles are missing');
  return styles.slice(start);
}

describe('Issue #379 Cloud Touch landscape Timeline shell', () => {
  const timeline = source(
    'src/renderer/features/timeline/TimelineDock.tsx',
  );
  const dialogueSheet = source(
    'src/renderer/features/dialogue/DialogueSheet.tsx',
  );
  const styles = source('src/renderer/styles.css');
  const issue379 = issue379Styles(styles);

  it('creates one ordered Toolbar, Ruler, Track Stack, and Task Tray', () => {
    const layers = [
      'data-timeline-layer="toolbar"',
      'data-timeline-layer="ruler"',
      'data-timeline-layer="track-stack"',
      'data-timeline-layer="task-tray"',
    ];
    const positions = layers.map((layer) => timeline.indexOf(layer));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(timeline.match(/data-timeline-layer=/gu)).toHaveLength(4);
    expect(timeline.match(/data-timeline-scroll-owner=/gu)).toHaveLength(1);
    expect(timeline.match(/onScroll=\{handleScroll\}/gu)).toHaveLength(1);
    expect(timeline).toContain('data-testid="timeline-toolbar"');
    expect(timeline).toContain('data-testid="timeline-ruler"');
    expect(timeline).toContain('data-testid="timeline-track-stack"');
    expect(timeline).toContain('data-testid="timeline-task-tray"');
    expect(timeline).toContain('<DialogueSheet />');
  });

  it('keeps exactly the V1 subtitle and audio tracks on the shared time surface', () => {
    expect(timeline.match(/data-track-kind="subtitle"/gu)).toHaveLength(1);
    expect(timeline.match(/data-track-kind="audio"/gu)).toHaveLength(1);
    expect(timeline).toContain('data-testid="timeline-subtitle-track"');
    expect(timeline).toContain('data-testid="timeline-audio-track"');
    expect(timeline).toContain('data-track-label="subtitle"');
    expect(timeline).toContain('data-track-label="audio"');
    expect(timeline).toContain('data-testid="timeline-ruler-scroll"');
    expect(timeline).toContain('timelineUiStore.setScrollPx');
    expect(timeline).toContain('data-testid="timeline-ruler-track"');
    expect(timeline).toContain('data-testid="timeline-playhead"');

    const trackStart = timeline.indexOf('data-timeline-layer="track-stack"');
    const taskTrayStart = timeline.indexOf('data-timeline-layer="task-tray"');
    expect(taskTrayStart).toBeGreaterThan(trackStart);
  });

  it('makes the track labels and Task Tray independent of horizontal Timeline scroll', () => {
    expect(issue379).toContain('.timeline-ruler-label-spacer');
    expect(issue379).toMatch(
      /\.timeline-ruler-label-spacer[\s\S]*?position: sticky;[\s\S]*?left: 0;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-lane-label[\s\S]*?position: sticky;[\s\S]*?left: 0;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-task-tray[\s\S]*?overflow: visible;/u,
    );
    expect(issue379).toContain('data-resizable=\'true\'');
    expect(issue379).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue379).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('keeps variable-height content readable without stretching the two lane rows', () => {
    expect(issue379).toMatch(
      /\.timeline-dock[\s\S]*?overflow-y: auto;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-ruler-scroll[\s\S]*?flex: 0 0 112px;[\s\S]*?height: 112px;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-track-stack[\s\S]*?height: 68px;[\s\S]*?min-height: 68px;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-lane[\s\S]*?height: 34px;[\s\S]*?min-height: 34px;/u,
    );
    expect(issue379).toMatch(
      /\.timeline-task-tray[\s\S]*?flex: 0 0 auto;/u,
    );
  });

  it('retains the existing Pending queue and authoring surface without Stage C/D behavior', () => {
    expect(dialogueSheet).toContain('data-testid="timeline-subtitle-queue"');
    expect(dialogueSheet).toContain('data-testid="dialogue-untimed-item"');
    expect(dialogueSheet).toContain('data-testid="dialogue-untimed-select"');
    expect(dialogueSheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(dialogueSheet).toContain('data-testid="dialogue-authoring-open"');
    expect(dialogueSheet).not.toMatch(/onPointer(?:Down|Move|Up|Cancel)/u);
    expect(dialogueSheet).not.toMatch(/dragGhost|dropTarget|draggable=/iu);
    expect(issue379).not.toMatch(/pending-(?:card|chip)|drag-to-place|drop target/iu);
  });

  it('preserves timed clip geometry and the existing presentation-only owners', () => {
    const clip = source('src/renderer/features/timeline/DialogueClip.tsx');
    const timelineUi = source(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );

    expect(clip).toContain('timeToPx(displayedStartMs, pixelsPerMs)');
    expect(clip).toContain('timeToPx(displayedEndMs - displayedStartMs, pixelsPerMs)');
    expect(clip).toContain('setPointerCapture');
    expect(clip).toContain('onPointerCancel={cancelDrag}');
    expect(timelineUi).not.toContain('updateProject');
    expect(timelineUi).not.toContain('editorProjectStore');
    expect(timelineUi).not.toContain('historyStore');
    expect(timelineUi).not.toContain('project.json');
  });
});
