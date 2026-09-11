import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #488 Canvas empty-state visual pass', () => {
  const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');
  const styles = source('src/renderer/styles.css');

  it('adds a decorative scene illustration without restoring the old copy', () => {
    const start = canvas.indexOf('{empty ? (');
    const end = canvas.indexOf('{missingBackground ?');
    const emptyState = canvas.slice(start, end);

    expect(emptyState).toContain(
      'className="canvas-stage-message canvas-empty-state"',
    );
    expect(emptyState).toContain('<CanvasEmptyStateIllustration />');
    expect(canvas).toContain(
      'data-testid="canvas-empty-state-illustration"',
    );
    expect(canvas).toContain('aria-hidden="true"');
    expect(emptyState).toContain(
      '<span className="canvas-empty-state-copy">',
    );
    expect(emptyState).toContain('先往画布里放点东西吧。');
    expect(emptyState).not.toContain('画布还是空的');
    expect(emptyState).not.toContain(
      '从左边加个背景或角色，就能开始摆画面了。',
    );
  });

  it('flattens only the real empty-state message and keeps the scene compact', () => {
    const emptyStateRule = styles.match(
      /\.canvas-stage-message\.canvas-empty-state\s*\{[^}]*\}/u,
    )?.[0];

    expect(emptyStateRule).toEqual(expect.any(String));
    expect(emptyStateRule).toContain('top: 46%;');
    expect(emptyStateRule).toContain('border: 0;');
    expect(emptyStateRule).toContain('background: transparent;');
    expect(emptyStateRule).toContain('font-size: 20px;');
    expect(emptyStateRule).toContain('font-weight: 700;');
    expect(styles).toContain('.canvas-empty-state-illustration');
    expect(styles).toContain('width: 132px;');
    expect(styles).toContain('height: 88px;');
    expect(styles).toContain('.canvas-empty-state-frame');
    expect(styles).toContain('aspect-ratio: 16 / 9;');
    expect(styles).toContain('pointer-events: none;');
  });

  it('keeps the illustration scoped to a selected zero-layer Shot', () => {
    expect(canvas).toContain(
      'const empty = Boolean(stageModel && stageModel.layers.length === 0);',
    );
    expect(canvas).toContain('Boolean(shot) &&');
    expect(canvas).toContain('dropDisabled={!snapshot || !shot}');
  });
});
