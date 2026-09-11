import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('Issue #490 Canvas empty-state artwork', () => {
  const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');

  it('keeps the maintainer PNG in the reference and renderer asset locations', () => {
    expect(existsSync('docs/design/huabu.png')).toBe(true);
    expect(
      existsSync('src/renderer/features/canvas/assets/canvas-empty-state.png'),
    ).toBe(true);
    expect(sha256('src/renderer/features/canvas/assets/canvas-empty-state.png')).toBe(
      sha256('docs/design/huabu.png'),
    );
    expect(
      readFileSync('src/renderer/features/canvas/assets/canvas-empty-state.png')
        .subarray(0, 8),
    ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it('uses a bundler-resolved, inert image and removes the old illustration', () => {
    expect(canvas).toContain(
      "import canvasEmptyStateArt from './assets/canvas-empty-state.png';",
    );
    expect(canvas).toContain('src={canvasEmptyStateArt}');
    expect(canvas).toContain('alt=""');
    expect(canvas).toContain('aria-hidden="true"');
    expect(canvas).toContain('draggable={false}');
    expect(canvas).not.toContain('src="/huabu.png"');
    expect(canvas).not.toContain('src="/canvas-empty-state.png"');
    expect(canvas).not.toContain('CanvasEmptyStateIllustration');
    expect(canvas).not.toContain('canvas-empty-state-frame');
    expect(canvas).not.toContain('canvas-empty-state-character');
    expect(canvas).not.toContain('canvas-empty-state-accent');
  });
});
