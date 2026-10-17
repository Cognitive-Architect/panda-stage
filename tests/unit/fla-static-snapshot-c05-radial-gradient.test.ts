import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const IDENTITY_MATRIX = '<matrix><Matrix/></matrix>';

function radialFill(
  index: number,
  entries: string,
  options: {
    readonly matrix?: string;
    readonly focalPointRatio?: string;
    readonly spread?: string;
    readonly interpolation?: string;
  } = {},
): string {
  const attributes = [
    options.focalPointRatio === undefined ? '' : ' focalPointRatio="' + options.focalPointRatio + '"',
    options.spread === undefined ? '' : ' spreadMethod="' + options.spread + '"',
    options.interpolation === undefined ? '' : ' interpolationMethod="' + options.interpolation + '"',
  ].join('');
  const matrix = options.matrix === undefined ? IDENTITY_MATRIX : options.matrix;
  return '<FillStyle index="' + index + '"><RadialGradient' + attributes + '>' +
    matrix + entries + '</RadialGradient></FillStyle>';
}

function twoRadialRegions(options: { readonly first?: string; readonly second?: string } = {}): string {
  const first = options.first ?? radialFill(
    1,
    '<GradientEntry color="#ff0000" alpha="0.25" ratio="0"/>' +
      '<GradientEntry color="#0000ff" alpha="1" ratio="1"/>',
    {
      matrix: '<matrix><Matrix a="0.001220703125" b="0" c="0" d="0.001220703125" tx="1" ty="1"/></matrix>',
    },
  );
  const second = options.second ?? radialFill(
    2,
    '<GradientEntry color="#00ff00" alpha="1" ratio="0"/>' +
      '<GradientEntry color="#ffff00" alpha="0.5" ratio="1"/>',
    {
      matrix: '<matrix><Matrix a="0" b="0.001220703125" c="-0.001220703125" d="0" tx="3" ty="1"/></matrix>',
      focalPointRatio: '-0.5',
      spread: 'reflect',
      interpolation: 'linearRGB',
    },
  );
  return '<DOMShape><fills>' + first + second + '</fills><edges>' +
    '<Edge fillStyle1="1" cubics="!0 0|40 0"/>' +
    '<Edge fillStyle0="1" fillStyle1="2" cubics="!40 40|40 0"/>' +
    '<Edge fillStyle1="1" cubics="!40 40|0 40"/>' +
    '<Edge fillStyle1="1" cubics="!0 40|0 0"/>' +
    '<Edge fillStyle1="2" cubics="!40 0|80 0"/>' +
    '<Edge fillStyle1="2" cubics="!80 0|80 40"/>' +
    '<Edge fillStyle1="2" cubics="!80 40|40 40"/>' +
    '</edges></DOMShape>';
}

async function makeFla(shapeXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<DOMDocument width="4" height="2" frameRate="24"><timelines>' +
    '<DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">' +
    '<frames><DOMFrame index="0"><elements>' + shapeXml + '</elements></DOMFrame></frames>' +
    '</DOMLayer></layers></DOMTimeline></timelines></DOMDocument>');
  zip.file('LIBRARY/radial-sample.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<DOMSymbolItem name="radial-sample" symbolType="graphic"><timeline>' +
    '<DOMTimeline name="radial-sample"><layers><DOMLayer name="Layer 1">' +
    '<frames><DOMFrame index="0"><elements>' + shapeXml + '</elements></DOMFrame></frames>' +
    '</DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildScenes(shapeXml: string) {
  const bytes = await makeFla(shapeXml);
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scenes = catalog.entries.filter((entry) => entry.target.kind === 'scene');
  const outputs = [];
  for (const scene of scenes) {
    const composed = await buildSvgForRenderTarget(bytes, scene.target);
    outputs.push({ target: scene.target, composed });
  }
  return outputs;
}

function radialIds(svg: string): string[] {
  return [...svg.matchAll(/<radialGradient\b id="([^"]+)"/gu)].map((match) => match[1] as string);
}

describe('P2-C05 radial-gradient fill reconstruction', () => {
  it('preserves radial stops, alpha, focal ratio, matrix, spread, and interpolation', async () => {
    const [scene] = await buildScenes(twoRadialRegions());
    expect(scene?.composed.ok).toBe(true);
    if (!scene || !scene.composed.ok) return;

    const { svg, composition } = scene.composed;
    const ids = radialIds(svg);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => /^fla-radial-[a-f0-9]{64}$/u.test(id))).toBe(true);
    expect(svg).toContain('cx="0" cy="0" r="819.2" fx="0" fy="0" spreadMethod="pad" color-interpolation="sRGB"');
    expect(svg).toContain('cx="0" cy="0" r="819.2" fx="-409.6" fy="0" spreadMethod="reflect" color-interpolation="linearRGB"');
    expect(svg).toContain('gradientTransform="matrix(0 0.001220703125 -0.001220703125 0 3 1)"');
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000" stop-opacity="0.25"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff" stop-opacity="1"/>');
    expect(svg).toContain('<stop offset="0" stop-color="#00ff00" stop-opacity="1"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#ffff00" stop-opacity="0.5"/>');
    expect(composition.radialGradientCount).toBe(2);
    expect(composition.radialGradientStopCount).toBe(4);
    expect(svg).toContain('radialGradients=2 radialGradientStops=4');
  });

  it('uses deterministic target-scoped radial ids', async () => {
    const bytes = await makeFla(twoRadialRegions());
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const sceneTarget = catalog.entries.find((entry) => entry.target.kind === 'scene')?.target;
    const graphicTarget = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol')?.target;
    expect(sceneTarget).toBeDefined();
    expect(graphicTarget).toBeDefined();
    if (!sceneTarget || !graphicTarget) return;

    const [first, repeated, graphic] = await Promise.all([
      buildSvgForRenderTarget(bytes, sceneTarget),
      buildSvgForRenderTarget(bytes, sceneTarget),
      buildSvgForRenderTarget(bytes, graphicTarget),
    ]);
    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    expect(graphic.ok).toBe(true);
    if (!first.ok || !repeated.ok || !graphic.ok) return;
    expect(first.svg).toBe(repeated.svg);
    expect(radialIds(first.svg)).toEqual(radialIds(repeated.svg));
    expect(radialIds(first.svg).filter((id) => radialIds(graphic.svg).includes(id))).toHaveLength(0);
  });

  it('fails closed for malformed stops, matrix, and focal ratio', async () => {
    const validStops =
      '<GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>';
    const malformed = [
      {
        style: radialFill(1, '', { matrix: IDENTITY_MATRIX }),
        message: 'insufficient GradientEntry stops',
      },
      {
        style: radialFill(1, '<GradientEntry color="#ff0000" ratio="0"/>', { matrix: IDENTITY_MATRIX }),
        message: 'insufficient GradientEntry stops',
      },
      {
        style: radialFill(1, validStops, { matrix: '' }),
        message: 'malformed or missing gradient matrix',
      },
      {
        style: radialFill(1, validStops, {
          matrix: '<matrix><Matrix/></matrix><matrix><Matrix/></matrix>',
        }),
        message: 'malformed or missing gradient matrix',
      },
      {
        style: radialFill(1, validStops, {
          matrix: '<matrix><Matrix/><Matrix/></matrix>',
        }),
        message: 'malformed or missing gradient matrix',
      },
      {
        style: radialFill(1, validStops, { matrix: IDENTITY_MATRIX, focalPointRatio: '1.1' }),
        message: 'invalid radial focalPointRatio',
      },
      {
        style: radialFill(1, '<GradientEntry color="#ff0000" ratio="0.8"/>' +
          '<GradientEntry color="#0000ff" ratio="0.2"/>', { matrix: IDENTITY_MATRIX }),
        message: 'invalid or out-of-order gradient stop ratio',
      },
    ];

    for (const entry of malformed) {
      const [first, repeated] = await (async () => {
        const bytes = await makeFla(twoRadialRegions({ first: entry.style }));
        const catalog = await buildRenderableTargetCatalog(bytes);
        if (!catalog.ok) throw new Error(catalog.message);
        const target = catalog.entries.find((candidate) => candidate.target.kind === 'scene')?.target;
        if (!target) throw new Error('Synthetic scene target was not cataloged');
        return Promise.all([
          buildSvgForRenderTarget(bytes, target),
          buildSvgForRenderTarget(bytes, target),
        ]);
      })();
      expect(first).toEqual(repeated);
      expect(first).toMatchObject({ ok: false, code: 'RENDER_FAILED' });
      expect(first).not.toHaveProperty('svg');
      if (!first.ok) expect(first.message).toContain(entry.message);
    }
  });

  it('rejects unsupported spread/interpolation and gradient-stop budget exhaustion', async () => {
    const validStops =
      '<GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>';
    const unsupported = [
      { style: radialFill(1, validStops, { matrix: IDENTITY_MATRIX, spread: 'unknown' }), code: 'TARGET_UNSUPPORTED' },
      { style: radialFill(1, validStops, { matrix: IDENTITY_MATRIX, interpolation: 'unknown' }), code: 'TARGET_UNSUPPORTED' },
      {
        style: radialFill(1, Array.from({ length: 257 }, () =>
          '<GradientEntry color="#ff0000" ratio="0"/>').join(''), { matrix: IDENTITY_MATRIX }),
        code: 'BUDGET_EXCEEDED',
      },
    ];
    for (const entry of unsupported) {
      const [scene] = await buildScenes(twoRadialRegions({ first: entry.style }));
      expect(scene?.composed).toMatchObject({ ok: false, code: entry.code });
    }
  });

  it('enforces the composition-wide radial stop budget', async () => {
    const stops = Array.from({ length: 256 }, () =>
      '<GradientEntry color="#ff0000" ratio="0"/>').join('');
    const styles = Array.from({ length: 65 }, (_, index) =>
      radialFill(index + 1, stops, { matrix: IDENTITY_MATRIX })).join('');
    const edges = Array.from({ length: 65 }, (_, index) =>
      '<Edge fillStyle1="' + (index + 1) + '" cubics="!0 0|20 0|20 20|0 20|0 0"/>').join('');
    const [scene] = await buildScenes('<DOMShape><fills>' + styles + '</fills><edges>' +
      edges + '</edges></DOMShape>');
    expect(scene?.composed).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    if (scene?.composed && !scene.composed.ok) {
      expect(scene.composed.message).toContain('gradient-stop budget');
    }
  }, 15_000);
});
