import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #447 subtitle authoring and AudioClip UX correction', () => {
  it('keeps the empty Batch Paste surface quiet and reveals a compact live result list only after input', () => {
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );

    expect(batch).toContain('const hasContent = draftState.batchRaw.trim().length > 0');
    expect(batch).toContain('{hasContent ? (');
    expect(batch).toContain('每行一条，格式：角色：台词');
    expect(batch).toContain('className="dialogue-batch-preview"');
    expect(batch).not.toContain('<table');
    expect(batch).not.toContain('解析统计');
    expect(batch).not.toContain('dialogue-batch-stats');
    expect(batch).not.toContain('dialogue-authoring-cancel');
    expect(batch).toContain('`添加 ${resolution.readyCount} 条字幕`');
  });

  it('keeps deterministic parsing and resolves only problem rows inline with human copy', () => {
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );

    expect(batch).toContain('parseDialoguePaste(draftState.batchRaw, characters)');
    expect(batch).toContain('resolveDialoguePaste(parsed, draftState.batchMapping, characters)');
    expect(batch.match(/dialogueStore\.createMany\(/gu)).toHaveLength(1);
    expect(batch).toContain('没找到这个角色');
    expect(batch).toContain('对应为');
    expect(batch).toContain('这一行格式不对');
    expect(batch).toContain('请写成「角色：台词」');
    expect(batch).toContain('这行还没有台词内容');
    expect(batch).not.toContain('缺少“角色：台词”分隔符');
    expect(batch).not.toContain('角色重名需映射');
  });

  it('renders a compact selected-subtitle identity, three-cell time row, Role, and one bound audio card', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const propertiesStart = inspector.indexOf('if (propertiesPresentation)');
    const landscapeStart = inspector.indexOf('if (landscapePresentation)');
    const fallbackStart = inspector.indexOf(
      '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    );
    const properties = inspector.slice(propertiesStart, landscapeStart);
    const landscape = inspector.slice(landscapeStart, fallbackStart);

    for (const presentation of [properties, landscape]) {
      expect(presentation).toContain('dialogue-properties-identity-editor');
      expect(presentation).toContain('dialogue-properties-inline-text');
      expect(presentation).toContain('dialogue-compact-timing-grid');
      expect(presentation).toContain('<span>开始</span>');
      expect(presentation).toContain('<span>结束</span>');
      expect(presentation).toContain('<span>时长</span>');
      expect(presentation).toContain('>\n                应用\n');
      expect(presentation).toContain('<h3>角色</h3>');
      expect(presentation).not.toContain('角色（说话人）');
      expect(presentation).not.toContain("timed ? '已定时'");
      expect(presentation).toContain('{audioBindingControl}');
    }

    expect(inspector).toContain('className="dialogue-audio-source-card"');
    expect(inspector).toContain('片段{\' \'}');
    expect(inspector).toContain("audioClip ? '更换配音' : '选择配音'");
    expect(inspector).toContain('调整时长');
    expect(inspector).toContain('移除配音');
    expect(inspector).not.toContain('>配音来源<');
    expect(inspector).not.toContain("' · 已绑定'");
  });

  it('keeps Inspector and Timeline connected to the existing duration truth', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const clip = source('src/renderer/features/timeline/AudioClip.tsx');
    const gesture = source(
      'src/renderer/features/timeline/audioTrimGesture.ts',
    );

    expect(inspector).toContain('data-testid="dialogue-inspector-audio-trim"');
    expect(inspector).toContain('dialogueStore.resizeBoundAudioEnd');
    expect(inspector).toContain('dialogue-inspector-audio-duration-editor');
    expect(clip).toContain('className="timeline-audio-trim-grip"');
    expect(clip).toContain('title="拖动右端调整配音时长"');
    expect(clip).toContain('aria-label="调整配音结束时间"');
    expect(clip).toContain("data-trimming={String(Boolean(dragRef.current))}");
    expect(clip).toContain('dialogueStore.resizeBoundAudioEnd');
    expect(gesture).toContain("completion !== 'pointerup'");
    expect(clip).not.toContain('resizeBoundAudioStart');
  });

  it('ships a practical hit target, restrained grip, focus response, and one scrolling batch owner', () => {
    const styles = source('src/renderer/styles.css');
    const issue447 = styles.slice(styles.lastIndexOf('/* Issue #447:'));

    expect(issue447).toMatch(/\.timeline-audio-trim-handle\s*\{[\s\S]*?width:\s*24px;/u);
    expect(issue447).toContain('.timeline-audio-trim-grip');
    expect(issue447).toContain('.timeline-audio-trim-handle:focus-visible');
    expect(issue447).toMatch(/\.dialogue-batch-preview\s*\{[\s\S]*?overflow-y:\s*auto;/u);
    expect(issue447).toContain('rgb(8 18 12 / 88%)');
    expect(issue447).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });
});
