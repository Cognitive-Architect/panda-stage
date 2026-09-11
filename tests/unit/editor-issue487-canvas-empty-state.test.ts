import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #487 Canvas empty-state copy', () => {
  const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');

  it('renders exactly one concise line for a valid empty Shot', () => {
    const start = canvas.indexOf('{empty ? (');
    const end = canvas.indexOf('{missingBackground ?');
    const emptyState = canvas.slice(start, end);

    expect(canvas).toContain(
      'const empty = Boolean(stageModel && stageModel.layers.length === 0);',
    );
    expect(emptyState).toContain(
      '<span className="canvas-empty-state-copy">',
    );
    expect(emptyState).toContain('先往画布里放点东西吧。');
    expect(emptyState).not.toContain('<strong>');
    expect(emptyState).not.toContain('画布还是空的');
    expect(emptyState).not.toContain(
      '从左边加个背景或角色，就能开始摆画面了。',
    );
  });

  it('keeps no-Shot neutral and does not show the background warning there', () => {
    expect(canvas).toContain('Boolean(shot) &&');
    expect(canvas).toContain('dropDisabled={!snapshot || !shot}');
  });
});
