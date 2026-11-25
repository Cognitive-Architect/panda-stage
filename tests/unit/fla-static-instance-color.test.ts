import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';

const shape = '<DOMShape><fills><FillStyle index="1"><SolidColor color="#406080"/></FillStyle></fills>' +
  '<edges><Edge fillStyle0="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>';
const layers = (elements: string) =>
  `<layers><DOMLayer><frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames></DOMLayer></layers>`;
const instance = (name: string, color: string, filter = '', type = 'graphic') =>
  `<DOMSymbolInstance libraryItemName="${name}" symbolType="${type}"><matrix><Matrix tx="12" ty="7"/></matrix>` +
    (color ? `<color><Color ${color}/></color>` : '') + filter + '</DOMSymbolInstance>';
const authoredSymbol = (name: string, elements: string, type = 'graphic') =>
  `<DOMSymbolItem name="${name}" symbolType="${type}"><timeline><DOMTimeline>${layers(elements)}</DOMTimeline></timeline></DOMSymbolItem>`;

async function render(color: string, options: { filter?: string; nested?: boolean; type?: string } = {}) {
  const { type = 'graphic', filter, nested } = options;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="80" height="60"/>');
  zip.file('LIBRARY/Tile.xml', authoredSymbol('Tile', shape, type));
  zip.file('LIBRARY/Root.xml', authoredSymbol('Root', nested
    ? instance('Wrapper', 'alphaMultiplier="0.5"')
    : instance('Tile', color, filter, type)));
  if (nested) zip.file('LIBRARY/Wrapper.xml', authoredSymbol('Wrapper', instance('Tile', color, filter, type)));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const target: FlaRenderTarget = {
    renderTargetId: 'static-color', kind: 'graphic-symbol', userLabel: 'Root', sourceLibraryItemName: 'Root',
    frameCount: 1, compatibility: [],
  };
  return buildSvgForRenderTarget(bytes, target, undefined, prepared.source);
}

function colorAtPaintedPoint(svg: string): number[] {
  const matrix = svg.match(/<feColorMatrix in="SourceGraphic" type="matrix" values="([^"]+)"/u)?.[1]?.split(' ').map(Number);
  const rgba = [64, 96, 128, 255];
  expect(svg).toContain('fill="#406080"');
  if (matrix) for (const channel of [0, 1, 2]) {
    const row = channel * 5;
    rgba[channel] = Math.round(rgba[channel]! * matrix[row + channel]! + 255 * matrix[row + 4]!);
  }
  for (const group of svg.matchAll(/<g opacity="([^"]+)"/gu)) rgba[3] = rgba[3]! * Number(group[1]);
  return rgba.map(Math.round);
}

describe('ordinary static Animate instance color', () => {
  it.each([
    ['alphaMultiplier="0"', [64, 96, 128, 0]],
    ['alphaMultiplier="0.5"', [64, 96, 128, 128]],
    ['alphaMultiplier="1"', [64, 96, 128, 255]],
    ['brightness="0.5"', [160, 176, 192, 255]],
    ['brightness="-0.5"', [32, 48, 64, 255]],
    ['brightness="0"', [64, 96, 128, 255]],
    ['tintMultiplier="0.5" tintColor="#C02040"', [128, 64, 96, 255]],
    ['tintMultiplier="0" tintColor="#C02040"', [64, 96, 128, 255]],
    ['', [64, 96, 128, 255]],
  ])('renders %s at the authored position', async (color, expected) => {
    const result = await render(color);
    if (!result.ok) throw new Error(result.message);
    expect(result.svg).toContain('matrix(1 0 0 1 12 7)');
    expect(colorAtPaintedPoint(result.svg)).toEqual(expected);
    expect(result.hasPerChannelColorTransform).toBe(color.includes('tintMultiplier="0.5"') ? true : undefined);
    if (expected.join(',') === '64,96,128,255') {
      expect(result.svg).not.toContain('fla-rgb-transform');
      expect(result.svg).not.toContain('<g opacity=');
    }
  });

  it.each(['alphaMultiplier="1.5"', 'tintMultiplier="" tintColor="#C02040"', 'redOffset="20"'])(
    'reports unverified Color data on the affected Graphic (%s)', async (color) => {
      const result = await render(color);
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining('unsupported Color') });
    },
  );

  it.each(['', '<DropShadowFilter isEnabled="false"/>', '<DropShadowFilter blurX="2" blurY="2" distance="2"/>'])(
    'preserves a nested MovieClip color with filter markup %s', async (filter) => {
      const color = 'alphaMultiplier="0.5" tintMultiplier="0.5" tintColor="#C02040"';
      const result = await render(color, { nested: true, type: 'movie clip', filter: filter ? `<filters>${filter}</filters>` : '' });
      if (!result.ok) throw new Error(result.message);
      expect(result.svg).toContain('matrix(1 0 0 1 24 14)');
      expect(colorAtPaintedPoint(result.svg)).toEqual([128, 64, 96, 64]);
      expect([...result.svg.matchAll(/<feColorMatrix in="SourceGraphic" type="matrix"/gu)]).toHaveLength(1);
      if (filter.includes('blurX')) {
        expect(result.svg).toMatch(/<g opacity="0\.5" filter="url\(#[^"]+\)"><g filter="url\(#fla-rgb-transform-/u);
      }
    },
  );
});
