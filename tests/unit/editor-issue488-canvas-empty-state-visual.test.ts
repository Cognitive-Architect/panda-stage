import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #488 Canvas empty-state visual pass', () => {
  const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');
  const viewport = source(
    'src/renderer/features/canvas/CanvasViewport.tsx',
  );
  const styles = source('src/renderer/styles.css');

  it('adds a decorative scene illustration without restoring the old copy', () => {
    const start = canvas.indexOf('function CanvasEmptyState()');
    const end = canvas.indexOf('function useCanvasImages');
    const emptyState = canvas.slice(start, end);

    expect(emptyState).toContain(
      'className="canvas-empty-state-overlay"',
    );
    expect(emptyState).toContain(
      'data-testid="canvas-empty-guidance"',
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

  it('mounts the empty state outside the scaled logical stage', () => {
    const logicalChildrenStart = canvas.indexOf('{(transform) => (');
    const logicalChildrenEnd = canvas.indexOf(
      '</CanvasViewport>',
      logicalChildrenStart,
    );
    const logicalChildren = canvas.slice(
      logicalChildrenStart,
      logicalChildrenEnd,
    );

    expect(canvas).toContain(
      'viewportOverlay={empty ? <CanvasEmptyState /> : null}',
    );
    expect(viewport).toContain('viewportOverlay?: ReactNode');
    expect(viewport).toContain('viewportOverlay = null');
    expect(viewport).toContain('{viewportOverlay}');
    expect(logicalChildren).not.toContain(
      'canvas-empty-state-overlay',
    );
    expect(viewport).toMatch(
      /canvas-viewport-content[\s\S]*?\{viewportOverlay\}[\s\S]*?\{viewportChrome\}/u,
    );
    expect(viewport).toContain(
      'transform: `scale(${transform.scale})`,',
    );
  });

  it('keeps viewport-space sizing stable and pointer-safe', () => {
    const overlayRule = styles.match(
      /\.canvas-empty-state-overlay\s*\{[^}]*\}/u,
    )?.[0];
    const illustrationRule = styles.match(
      /\.canvas-empty-state-illustration\s*\{[^}]*\}/u,
    )?.[0];
    const copyRule = styles.match(
      /\.canvas-empty-state-copy\s*\{[^}]*\}/u,
    )?.[0];

    expect(overlayRule).toEqual(expect.any(String));
    expect(overlayRule).toContain('top: 46%;');
    expect(overlayRule).toContain('left: 50%;');
    expect(overlayRule).toContain('pointer-events: none;');
    expect(overlayRule).toContain('transform: translate(-50%, -50%);');
    expect(overlayRule).not.toContain('scale(');
    expect(illustrationRule).toContain('width: clamp(');
    expect(illustrationRule).toContain('height: clamp(');
    expect(illustrationRule).toContain('pointer-events: none;');
    expect(copyRule).toContain('font-size: clamp(');
    expect(copyRule).toContain('font-weight: 700;');
    expect(styles).toContain('.canvas-empty-state-frame');
    expect(styles).toContain('aspect-ratio: 16 / 9;');
    expect(styles).not.toContain(
      '.canvas-stage-message.canvas-empty-state',
    );
  });

  it('keeps the illustration scoped to a selected zero-layer Shot', () => {
    expect(canvas).toContain(
      'const empty = Boolean(stageModel && stageModel.layers.length === 0);',
    );
    expect(canvas).toContain('Boolean(shot) &&');
    expect(canvas).toContain('dropDisabled={!snapshot || !shot}');
  });
});
