import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function landscapeSource(dialogue: string): string {
  const start = dialogue.indexOf('if (landscapePresentation)');
  const end = dialogue.indexOf(
    '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dialogue.slice(start, end);
}

describe('Issue #463 subtitle timing editor', () => {
  it('uses seconds for editable Start and Duration in both Properties layouts', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const propertiesStart = dialogue.indexOf('if (propertiesPresentation)');
    const landscapeStart = dialogue.indexOf('if (landscapePresentation)');
    const properties = dialogue.slice(propertiesStart, landscapeStart);
    const landscape = landscapeSource(dialogue);

    for (const presentation of [properties, landscape]) {
      expect(presentation).toContain('开始（秒）');
      expect(presentation).toContain('时长（秒）');
      expect(presentation).toContain('自动计算');
      expect(presentation).toContain(
        'data-testid="dialogue-inspector-duration"',
      );
      expect(presentation).toContain('data-read-only="true"');
      expect(presentation).toContain('aria-readonly="true"');
      expect(presentation).toContain('inputMode="decimal"');
      expect(presentation).toContain('type="text"');
      expect(presentation).not.toContain('type="number"');
      expect(presentation).toContain(
        'onClick={(event) => event.currentTarget.select()}',
      );
      expect(presentation).toContain(
        'onFocus={(event) => event.currentTarget.select()}',
      );
      expect(presentation).toContain('onClick={commitTiming}');

      const endStart = presentation.indexOf(
        'data-testid="dialogue-inspector-end"',
      );
      const endSection = presentation.slice(endStart);
      expect(endSection).not.toContain('<input');
    }
  });

  it('keeps the approved compact scope and one existing timing commit owner', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(dialogue).not.toContain('结束时间会自动计算：开始 + 时长');
    expect(dialogue).not.toContain('直接输入秒数即可，例如 3.17');
    expect(dialogue.match(/dialogueStore\.setTiming\(/gu)).toHaveLength(2);
    expect(styles).toContain('dialogue-timing-seconds-input');
    expect(styles).toContain('appearance: none;');
  });
});
