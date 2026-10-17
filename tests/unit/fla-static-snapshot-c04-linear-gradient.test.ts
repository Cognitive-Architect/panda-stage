import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const IDENTITY_MATRIX = '<matrix><Matrix/></matrix>';

function linearFill(
  index: number,
  entries: string,
  options: { readonly matrix?: string; readonly spread?: string; readonly interpolation?: string } = {},
): string {
  const attributes = [
    options.spread === undefined ? '' : ` spreadMethod="${options.spread}"`,
    options.interpolation === undefined ? '' : ` interpolationMethod="${options.interpolation}"`,
  ].join('');
  const matrix = options.matrix ?? '';
  return `<FillStyle index="${index}"><LinearGradient${attributes}>${matrix}${entries}</LinearGradient></FillStyle>`;
}

function twoGradientRegions(options: { readonly first?: string; readonly second?: string } = {}): string {
  const first = options.first ?? linearFill(1,
    '<GradientEntry color="#ff0000" alpha="0.25" ratio="0"/><GradientEntry color="#0000ff" alpha="1" ratio="1"/>',
    { matrix: '<matrix><Matrix a="0.001220703125" b="0" c="0" d="0.001220703125" tx="1" ty="1"/></matrix>' },
  );
  const second = options.second ?? linearFill(2,
    '<GradientEntry color="#00ff00" alpha="1" ratio="0"/><GradientEntry color="#ffff00" alpha="0.5" ratio="1"/>',
    {
      matrix: '<matrix><Matrix a="0" b="0.001220703125" c="-0.001220703125" d="0" tx="3" ty="1"/></matrix>',
      spread: 'reflect',
      interpolation: 'linearRGB',
    },
  );
  return `<DOMShape><fills>${first}${second}</fills><edges>
    <Edge fillStyle1="1" cubics="!0 0|40 0"/>
    <Edge fillStyle0="1" fillStyle1="2" cubics="!40 40|40 0"/>
    <Edge fillStyle1="1" cubics="!40 40|0 40"/>
    <Edge fillStyle1="1" cubics="!0 40|0 0"/>
    <Edge fillStyle1="2" cubics="!40 0|80 0"/>
    <Edge fillStyle1="2" cubics="!80 0|80 40"/>
    <Edge fillStyle1="2" cubics="!80 40|40 40"/>
  </edges></DOMShape>`;
}

async function makeFla(shapeXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="4" height="2" frameRate="24"><timelines>
  <DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline>
</timelines></DOMDocument>`);
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

async function buildSceneTwice(shapeXml: string) {
  const bytes = await makeFla(shapeXml);
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const target = catalog.entries.find((entry) => entry.target.kind === 'scene')?.target;
  if (!target) throw new Error('Synthetic scene target was not cataloged');
  return Promise.all([
    buildSvgForRenderTarget(bytes, target),
    buildSvgForRenderTarget(bytes, target),
  ]);
}

function gradientIds(svg: string): string[] {
  return [...svg.matchAll(/<linearGradient\b id="([^"]+)"/gu)].map((match) => match[1] as string);
}

describe('P2-C04 linear-gradient fill reconstruction', () => {
  it('preserves ordered stop colors, ratios, alpha, matrix, spread, and interpolation in one composed target', async () => {
    const [scene] = await buildScenes(twoGradientRegions());
    expect(scene?.composed.ok).toBe(true);
    if (!scene || !scene.composed.ok) return;

    const { svg, composition } = scene.composed;
    expect(gradientIds(svg)).toHaveLength(2);
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000" stop-opacity="0.25"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff" stop-opacity="1"/>');
    expect(svg).toContain('<stop offset="0" stop-color="#00ff00" stop-opacity="1"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#ffff00" stop-opacity="0.5"/>');
    expect(svg).toContain('gradientUnits="userSpaceOnUse" x1="-819.2" y1="0" x2="819.2" y2="0"');
    expect(svg).toContain('gradientTransform="matrix(0.001220703125 0 0 0.001220703125 1 1)"');
    expect(svg).toContain('gradientTransform="matrix(0 0.001220703125 -0.001220703125 0 3 1)"');
    expect(svg).toContain('spreadMethod="pad" color-interpolation="sRGB"');
    expect(svg).toContain('spreadMethod="reflect" color-interpolation="linearRGB"');
    expect(svg.match(/fill="url\(#fla-linear-[a-f0-9]+\)"/gu)).toHaveLength(2);
    expect(composition.linearGradientCount).toBe(2);
    expect(composition.linearGradientStopCount).toBe(4);
    expect(svg).toContain('linearGradients=2 linearGradientStops=4');
  });

  it('uses deterministic ids for repeat builds and keeps ids disjoint across render targets', async () => {
    const bytes = await makeFla(twoGradientRegions());
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const target = catalog.entries.find((entry) => entry.target.kind === 'scene')?.target;
    expect(target).toBeDefined();
    if (!target) return;
    const first = await buildSvgForRenderTarget(bytes, target);
    const repeated = await buildSvgForRenderTarget(bytes, target);
    const alternate = await buildSvgForRenderTarget(bytes, {
      ...target,
      renderTargetId: `${target.renderTargetId}-alternate`,
    });
    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    expect(alternate.ok).toBe(true);
    if (!first.ok || !repeated.ok || !alternate.ok) return;
    expect(gradientIds(first.svg)).toEqual(gradientIds(repeated.svg));
    expect(gradientIds(first.svg).filter((id) => gradientIds(alternate.svg).includes(id))).toEqual([]);
  });

  it('supports repeat spread and the sRGB default without changing authored stop data', async () => {
    const shape = twoGradientRegions({
      first: linearFill(1,
        '<GradientEntry color="#123456" alpha="0.75" ratio="0.125"/><GradientEntry color="#abcdef" alpha="0.5" ratio="0.875"/>',
        { matrix: IDENTITY_MATRIX, spread: 'repeat' },
      ),
      second: `<FillStyle index="2"><SolidColor color="#eeeeee"/></FillStyle>`,
    });
    const [scene] = await buildScenes(shape);
    expect(scene?.composed.ok).toBe(true);
    if (!scene || !scene.composed.ok) return;
    expect(scene.composed.svg).toContain('spreadMethod="repeat" color-interpolation="sRGB"');
    expect(scene.composed.svg).toContain('<stop offset="0.125" stop-color="#123456" stop-opacity="0.75"/>');
    expect(scene.composed.svg).toContain('<stop offset="0.875" stop-color="#abcdef" stop-opacity="0.5"/>');
    expect(scene.composed.composition.linearGradientCount).toBe(1);
    expect(scene.composed.composition.linearGradientStopCount).toBe(2);
  });

  it('fails closed for invalid stop order, alpha, ratio, matrix, spread, and interpolation', async () => {
    const validStops = '<GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>';
    const invalidStyles = [
      linearFill(1,
        '<GradientEntry color="#ff0000" ratio="0.8"/><GradientEntry color="#0000ff" ratio="0.2"/>',
        { matrix: IDENTITY_MATRIX },
      ),
      linearFill(1, '<GradientEntry color="#ff0000" alpha="1.2" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>', {
        matrix: IDENTITY_MATRIX,
      }),
      linearFill(1, '<GradientEntry color="#ff0000" ratio="1.01"/><GradientEntry color="#0000ff" ratio="1.01"/>', {
        matrix: IDENTITY_MATRIX,
      }),
      linearFill(1, validStops, {
        matrix: '<matrix><Matrix a="NaN"/></matrix>',
      }),
      linearFill(1, validStops, { matrix: IDENTITY_MATRIX, spread: 'unknown' }),
      linearFill(1, validStops, { matrix: IDENTITY_MATRIX, interpolation: 'unknown' }),
    ];
    const expectedCodes = ['RENDER_FAILED', 'RENDER_FAILED', 'RENDER_FAILED', 'RENDER_FAILED', 'TARGET_UNSUPPORTED', 'TARGET_UNSUPPORTED'];
    for (let index = 0; index < invalidStyles.length; index += 1) {
      const rendered = await buildScenes(twoGradientRegions({ first: invalidStyles[index] }));
      const composed = rendered[0]?.composed;
      expect(composed).toMatchObject({ ok: false, code: expectedCodes[index] });
    }
  });

  it('rejects per-style gradient-stop budget exhaustion', async () => {
    const stops = Array.from({ length: 257 }, () => '<GradientEntry color="#ff0000" ratio="0"/>').join('');
    const rendered = await buildScenes(twoGradientRegions({ first: linearFill(1, stops) }));
    expect(rendered[0]?.composed).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
  });

  it('rejects composition-wide gradient-stop budget exhaustion', async () => {
    const stops = Array.from({ length: 256 }, () => '<GradientEntry color="#ff0000" ratio="0"/>').join('');
    const styles = Array.from({ length: 65 }, (_, index) =>
      linearFill(index + 1, stops, { matrix: IDENTITY_MATRIX }),
    ).join('');
    const edges = Array.from({ length: 65 }, (_, index) =>
      `<Edge fillStyle1="${index + 1}" cubics="!0 0|20 0|20 20|0 20|0 0"/>`,
    ).join('');
    const rendered = await buildScenes(`<DOMShape><fills>${styles}</fills><edges>${edges}</edges></DOMShape>`);
    expect(rendered[0]?.composed).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    if (rendered[0]?.composed && !rendered[0].composed.ok) {
      expect(rendered[0].composed.message).toContain('gradient-stop budget');
    }
  });

  it('fails deterministically for zero/one stop, a missing matrix, and duplicate matrices', async () => {
    const validStops = '<GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>';
    const malformedStyles = [
      {
        style: linearFill(1, '', { matrix: '<matrix><Matrix/></matrix>' }),
        message: 'insufficient GradientEntry stops',
      },
      {
        style: linearFill(1, '<GradientEntry color="#ff0000" ratio="0"/>', {
          matrix: '<matrix><Matrix/></matrix>',
        }),
        message: 'insufficient GradientEntry stops',
      },
      {
        style: linearFill(1, validStops),
        message: 'malformed or missing gradient matrix',
      },
      {
        style: linearFill(1, validStops, {
          matrix: '<matrix><Matrix/></matrix><matrix><Matrix/></matrix>',
        }),
        message: 'malformed or missing gradient matrix',
      },
      {
        style: linearFill(1, validStops, {
          matrix: '<matrix><Matrix/><Matrix/></matrix>',
        }),
        message: 'malformed or missing gradient matrix',
      },
    ];

    for (const malformed of malformedStyles) {
      const [first, repeated] = await buildSceneTwice(twoGradientRegions({ first: malformed.style }));
      expect(first).toEqual(repeated);
      expect(first).toMatchObject({ ok: false, code: 'RENDER_FAILED' });
      expect(first).not.toHaveProperty('svg');
      if (!first.ok) expect(first.message).toContain(malformed.message);
    }
  });
});
