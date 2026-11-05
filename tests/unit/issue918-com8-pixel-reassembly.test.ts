import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type PixelAlignedPngStackModule = {
  createPixelAlignedPngStackSvg: (
    framing: {
      outputWidth: number;
      outputHeight: number;
      viewBox: { x: number; y: number; width: number; height: number };
    },
    partPngs: Array<{ pngBytes: Buffer }>,
  ) => string;
  formatFiniteSvgNumber: (value: number) => string;
};

const require = createRequire(import.meta.url);
const { createPixelAlignedPngStackSvg, formatFiniteSvgNumber } = require(
  '../../scripts/research/issue918-com8-pixel-reassembly.cjs',
) as PixelAlignedPngStackModule;

const baseLayer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8DwnwEIAAz8Af9rOp6TAAAAAElFTkSuQmCC',
  'base64',
);
const translucentOverlay = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYPjfwPCf4T8ADH8DfiBaTXYAAAAASUVORK5CYII=',
  'base64',
);

describe('Issue #918 pixel-aligned part reassembly', () => {
  it('preserves full finite coordinate precision when formatting SVG viewBox numbers', () => {
    expect(formatFiniteSvgNumber(3.1124661015856976)).toBe('3.1124661015856976');
    expect(formatFiniteSvgNumber(-4.4500000000000455)).toBe('-4.4500000000000455');
  });

  it('rejects non-finite SVG viewBox coordinates', () => {
    expect(() => formatFiniteSvgNumber(Number.NaN)).toThrow('Non-finite Graphic viewBox coordinate');
    expect(() => formatFiniteSvgNumber(Number.POSITIVE_INFINITY)).toThrow(
      'Non-finite Graphic viewBox coordinate',
    );
  });

  it('keeps transparent source-over PNG layers on the integer output pixel grid and preserves draw order', () => {
    const svg = createPixelAlignedPngStackSvg(
      {
        viewBox: { x: -4.45, y: 179.11817328317284, width: 223.91683869977817, height: 237.08807671682712 },
        outputWidth: 2,
        outputHeight: 1,
      },
      [{ pngBytes: baseLayer }, { pngBytes: translucentOverlay }],
    );

    expect(svg).toContain('viewBox="0 0 2 1" width="2" height="1"');
    expect(svg.match(/<image /gu)).toHaveLength(2);
    expect(svg).toContain('<image x="0" y="0" width="2" height="1" preserveAspectRatio="none"');
    expect(svg.indexOf(baseLayer.toString('base64'))).toBeLessThan(
      svg.indexOf(translucentOverlay.toString('base64')),
    );
    expect(svg).not.toContain('223.916838');
    expect(svg).not.toContain('-4.45');
  });

  it('rejects a non-integer output grid rather than resampling full-viewport pixels', () => {
    expect(() =>
      createPixelAlignedPngStackSvg(
        { viewBox: { x: 0, y: 0, width: 1, height: 1 }, outputWidth: 2.5, outputHeight: 1 },
        [{ pngBytes: baseLayer }],
      ),
    ).toThrow('positive integer output dimensions');
  });
});
