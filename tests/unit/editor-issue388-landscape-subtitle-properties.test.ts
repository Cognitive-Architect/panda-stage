import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const LANDSCAPE_SCOPE =
  ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

function landscapeDialogueSource(dialogue: string): string {
  const start = dialogue.indexOf('if (landscapePresentation)');
  const end = dialogue.indexOf(
    '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dialogue.slice(start, end);
}

describe('Issue #388 Stage C.1 landscape subtitle Properties polish', () => {
  it('uses one minimal title row and one concise identity row', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const landscape = landscapeDialogueSource(dialogue);

    expect(inspector).toContain(
      '{(compact || landscapePresentation) &&\n      (!dialogueMode || landscapePresentation) ? (',
    );
    expect(inspector).toContain(
      '{!compact && !(landscapePresentation && dialogueMode) ? (',
    );
    expect(inspector).toContain('data-testid="inspector-inline-close"');
    expect(landscape).toContain('data-testid="dialogue-properties-header"');
    expect(landscape).toContain('data-header-row="identity"');
    expect(landscape).toContain('data-testid="dialogue-properties-identity"');
    expect(landscape).toContain('data-testid="dialogue-inspector-status"');
    expect(landscape).not.toContain('已安排字幕');
    expect(landscape).not.toContain('dialogue-inspector-context-copy');
    expect(landscape).not.toContain('title={dialogue.text}');
  });

  it('presents timing as timecodes while retaining the existing draft path', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const landscape = landscapeDialogueSource(dialogue);

    expect(landscape).toContain('formatTimecode(dialogue.startMs)');
    expect(landscape).toContain('formatTimecode(dialogue.endMs)');
    expect(landscape).toContain('aria-valuetext={draftStartTimecode}');
    expect(landscape).toContain('aria-valuetext={draftEndTimecode}');
    expect(landscape).toContain('data-persisted-timecode=');
    expect(landscape).toContain('onClick={commitTiming}');
    expect(landscape).not.toContain('aria-label="开始时间（毫秒）"');
    expect(landscape).not.toContain('aria-label="结束时间（毫秒）"');
    expect(landscape).not.toContain('>ms</span>');
    expect(landscape).not.toContain('毫秒');
  });

  it('removes duplicate metadata copy without changing owners', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const landscape = landscapeDialogueSource(dialogue);

    expect(landscape.match(/角色（说话人）/gu)).toHaveLength(1);
    expect(landscape.match(/dialogue-inspector-audio-summary/gu)).toHaveLength(
      1,
    );
    expect(landscape).not.toContain('dialogue-inspector-audio-note');
    expect(landscape).not.toContain('音频播放区间独立于字幕时间');
    expect(landscape).toContain('dialogueStore.update(dialogue.id');
    expect(landscape).toContain('dialogueStore.remove(dialogue.id)');
    expect(dialogue).toContain('dialogueStore.setTiming');
    expect(landscape).not.toContain('updateProject');
    expect(landscape).not.toContain('new DialogueSelectionStore');
    expect(landscape).not.toContain('new DialogueAuthoringDraft');
  });

  it('scopes density, touch, timecode and secondary-danger styling to Stage C.1', () => {
    const styles = source('src/renderer/styles.css');
    const stageC1 = styles.slice(styles.lastIndexOf('/* Issue #388:'));

    expect(stageC1).toContain(LANDSCAPE_SCOPE);
    expect(stageC1).toContain(
      '.right-inspector-drawer:has(> .dialogue-inspector-landscape-properties)',
    );
    expect(stageC1).toContain('resize: none;');
    expect(stageC1).toContain('color: transparent;');
    expect(stageC1).toContain('caret-color: var(--ui-color-accent);');
    expect(stageC1).toContain('min-height: var(--ui-touch-icon);');
    expect(stageC1).toContain('background: transparent;');
    expect(stageC1).not.toContain("data-editor-shell-layout='portrait'");
    expect(stageC1).not.toContain("data-editor-shell-layout='desktop'");
    expect(stageC1).not.toContain('rgb(124 46 37 / 28%)');
  });

  it('keeps the single inspector, selection, timing and drawer owners', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('dialogueSelectionStore.getSelectedDialogueId');
    expect(inspector).toContain('<DialogueInspector');
    expect(dialogue).toContain('shotStore.getCurrentShotId');
    expect(dialogue).toContain('dialogueStore.setTiming');
    expect(dialogue).not.toContain('editorProjectStore.update');
    expect(dialogue).not.toContain('HistoryStore');
    expect(dialogue).not.toContain('previewCurrentSubtitle');
  });
});
