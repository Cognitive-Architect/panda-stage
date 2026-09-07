import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #448 timed Inspector comfort and audio duration editing', () => {
  it('keeps the simplified Inspector hierarchy while restoring comfortable spacing', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const compactPresentations = inspector.slice(
      inspector.indexOf('if (propertiesPresentation)'),
      inspector.indexOf(
        '\n  return (\n    <>\n      <div className="right-inspector-heading">',
      ),
    );
    const styles = source('src/renderer/styles.css');
    const issue448 = styles.slice(styles.lastIndexOf('/* Issue #448 A:'));

    expect(compactPresentations).toContain('dialogue-properties-identity-editor');
    expect(compactPresentations).toContain('dialogue-compact-timing-grid');
    expect(compactPresentations).not.toContain("timed ? '已定时'");
    expect(compactPresentations).not.toContain('>配音来源<');
    expect(compactPresentations).not.toContain("' · 已绑定'");
    expect(issue448).toContain('padding: 17px 0 19px;');
    expect(issue448).toContain('min-height: 44px;');
    expect(issue448).toContain('gap: 10px;');
    expect(issue448).toContain('.dialogue-audio-actions');
    expect(issue448).not.toContain('.dialogue-authoring-batch');
  });

  it('opens a local, directly editable duration draft with Cancel, restore, and one Apply owner', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(inspector).toContain('const [audioTrimEditorOpen');
    expect(inspector).toContain('const [audioTrimDurationMs');
    expect(inspector).toContain(
      'data-testid="dialogue-inspector-audio-duration-editor"',
    );
    expect(inspector).toContain('aria-label="配音片段时长"');
    expect(inspector).toContain('type="range"');
    expect(inspector).toContain('<dt>片段时长</dt>');
    expect(inspector).toContain('<dt>可用原音频</dt>');
    expect(inspector).toContain('恢复可用长度');
    expect(inspector).toContain('onClick={cancelAudioTrim}');
    expect(inspector).toContain('onClick={applyAudioTrim}');
    expect(inspector.match(/dialogueStore\.resizeBoundAudioEnd\(/gu)).toHaveLength(1);
    expect(inspector).not.toContain('editorProjectStore.updateProject');
  });

  it('uses the same domain legal range in service, Timeline, and Inspector paths', () => {
    const service = source('src/domain/services/DialogueService.ts');
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(service).toContain('export function getBoundAudioEndRange');
    expect(service).toContain('const range = getBoundAudioEndRange({');
    expect(timeline).toContain('getBoundAudioEndRange({');
    expect(inspector).toContain('getBoundAudioEndRange({');
    expect(inspector).toContain('max={audioTrimMaximumDurationMs}');
    expect(inspector).toContain(
      'audioClip.startMs + audioTrimDurationMs',
    );
  });

  it('raises the selected AudioClip end cap above the subtitle resize quality floor', () => {
    const styles = source('src/renderer/styles.css');
    const issue448 = styles.slice(styles.lastIndexOf('/* Issue #448 A:'));

    expect(issue448).toMatch(
      /\.timeline-audio-trim-handle\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*32px;/u,
    );
    expect(issue448).toContain('left: calc(100% - 24px);');
    expect(issue448).toMatch(
      /\.timeline-audio-clip\.selected\s*\{[\s\S]*?overflow:\s*visible;/u,
    );
    expect(issue448).toMatch(
      /\.timeline-audio-trim-grip\s*\{[\s\S]*?width:\s*16px;[\s\S]*?height:\s*100%;/u,
    );
    expect(issue448).toContain('cursor: ew-resize;');
  });
});
