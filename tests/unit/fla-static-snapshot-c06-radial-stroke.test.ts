import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

// Source-derived from Issue #748's frozen Shape fla-shape-ce9f3623690b031bcc05dea3
// in 修仙男.fla (SHA-256 565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5).
// The fixture keeps StrokeStyle 3, its complete radial gradient matrix/stops,
// the source Shape matrix, and the exact Edge geometry. Fill references and
// sibling stroke styles are omitted to isolate this paint contract.
const SOURCE_RADIAL_STROKE = `<StrokeStyle index="3">
  <SolidStroke scaleMode="normal">
    <fill>
      <RadialGradient spreadMethod="reflect">
        <matrix><Matrix a="0.0035400390625" b="0.0022125244140625" c="-0.0178985595703125" d="0.0283050537109375" tx="808.95" ty="622.2"/></matrix>
        <GradientEntry color="#594F45" ratio="0.152941176470588"/>
        <GradientEntry color="#D7DFD5" ratio="0.447058823529412"/>
        <GradientEntry color="#A4A79E" ratio="0.72156862745098"/>
        <GradientEntry color="#FCFDFA" ratio="1"/>
      </RadialGradient>
    </fill>
  </SolidStroke>
</StrokeStyle>`;

const SOURCE_SHAPE_MATRIX = `<matrix><Matrix a="1.5164794921875" c="0.0515289306640625" d="1.5164794921875" tx="-1320.75" ty="-1081.5"/></matrix>`;

const SOURCE_EDGE = `
!16376 12429[16191 12699 16168 12709!16168 12709|16117 12653!16117 12653|16080 12712!16080 12712[16034 12667 15984 12611!15984 12611[15884 12501 15848 12449`;

const ROOT_MATRIX = '<matrix><Matrix a="1.042236328125" d="1.042236328125" tx="728.2" ty="36.75"/></matrix>';
const NESTED_MATRIX = '<matrix><Matrix tx="205.35" ty="602.45"/></matrix>';

function sourceStrokeShape(strokeStyle = SOURCE_RADIAL_STROKE): string {
  return `<DOMShape>${SOURCE_SHAPE_MATRIX}<fills/><strokes>${strokeStyle}</strokes><edges><Edge strokeStyle="3" edges="${SOURCE_EDGE}"/></edges></DOMShape>`;
}

async function makeSourceDerivedFla(strokeStyle = SOURCE_RADIAL_STROKE): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <DOMDocument width="1920" height="1080" frameRate="24"><timelines>
      <DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1"><frames>
        <DOMFrame index="0"><elements>
          <DOMSymbolInstance libraryItemName="issue748-male-root" symbolType="graphic">${ROOT_MATRIX}</DOMSymbolInstance>
        </elements></DOMFrame>
      </frames></DOMLayer></layers></DOMTimeline>
    </timelines></DOMDocument>`);
  zip.file('LIBRARY/issue748-male-root.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <DOMSymbolItem name="issue748-male-root" symbolType="graphic"><timeline>
      <DOMTimeline name="Root"><layers><DOMLayer name="Layer 1"><frames>
        <DOMFrame index="0" duration="30"><elements>
          <DOMSymbolInstance libraryItemName="issue748-stroke" symbolType="graphic">${NESTED_MATRIX}</DOMSymbolInstance>
        </elements></DOMFrame>
      </frames></DOMLayer></layers></DOMTimeline>
    </timeline></DOMSymbolItem>`);
  zip.file('LIBRARY/issue748-stroke.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <DOMSymbolItem name="issue748-stroke" symbolType="graphic"><timeline>
      <DOMTimeline name="Stroke"><layers><DOMLayer name="Layer 1"><frames>
        <DOMFrame index="0"><elements>${sourceStrokeShape(strokeStyle)}</elements></DOMFrame>
      </frames></DOMLayer></layers></DOMTimeline>
    </timeline></DOMSymbolItem>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function renderTargets(strokeStyle = SOURCE_RADIAL_STROKE) {
  const bytes = await makeSourceDerivedFla(strokeStyle);
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene')?.target;
  const root = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol' &&
    entry.target.userLabel === 'issue748-male-root')?.target;
  if (!scene || !root) throw new Error('Source-derived scene/root targets were not catalogued');
  const [sceneResult, rootResult] = await Promise.all([
    buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 }),
    buildSvgForRenderTarget(bytes, { ...root, selectedFrameIndex: 0 }),
  ]);
  return { bytes, sceneResult, rootResult, scene, root };
}

function radialIds(svg: string): string[] {
  return [...svg.matchAll(/<radialGradient\b id="([^"]+)"/gu)].map((match) => match[1] as string);
}

function strokedPaths(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*>/gu)]
    .map((match) => match[0])
    .filter((path) => path.includes('stroke="url(#fla-radial-'));
}

describe('P2-C06 source-derived radial-gradient stroke paint', () => {
  it('renders the authored radial paint on the source stroke through nested transforms and stroke bounds', async () => {
    const { sceneResult, rootResult } = await renderTargets();
    expect(sceneResult.ok).toBe(true);
    expect(rootResult.ok).toBe(true);
    if (!sceneResult.ok || !rootResult.ok) return;

    const sceneIds = radialIds(sceneResult.svg);
    const rootIds = radialIds(rootResult.svg);
    expect(sceneIds).toHaveLength(1);
    expect(rootIds).toHaveLength(1);
    expect(sceneIds[0]).toMatch(/^fla-radial-[a-f0-9]{64}$/u);
    expect(rootIds[0]).toMatch(/^fla-radial-[a-f0-9]{64}$/u);
    expect(sceneIds[0]).not.toBe(rootIds[0]);

    const scenePaths = strokedPaths(sceneResult.svg);
    const rootPaths = strokedPaths(rootResult.svg);
    expect(scenePaths).toHaveLength(1);
    expect(rootPaths).toHaveLength(1);
    expect(scenePaths[0]).toContain('fill="none"');
    expect(scenePaths[0]).toContain('stroke-width="1"');
    expect(scenePaths[0]).toContain('stroke-linecap="round"');
    expect(scenePaths[0]).toContain('stroke-linejoin="round"');
    expect(scenePaths[0]).toContain('transform="matrix(');
    expect(rootPaths[0]).toContain('d="M ');
    expect(rootPaths[0]?.match(/\bQ /gu)).toHaveLength(3);
    expect(rootPaths[0]?.match(/\bL /gu)).toHaveLength(2);
    expect(scenePaths[0]).not.toEqual(rootPaths[0]);

    expect(sceneResult.svg).toContain('spreadMethod="reflect" color-interpolation="sRGB"');
    expect(sceneResult.svg).toContain('gradientTransform="matrix(0.0035400390625 0.0022125244140625 -0.0178985595703125 0.0283050537109375 808.95 622.2)"');
    expect(sceneResult.svg).toContain('<stop offset="0.152941176470588" stop-color="#594F45" stop-opacity="1"/>');
    expect(sceneResult.svg).toContain('<stop offset="0.447058823529412" stop-color="#D7DFD5" stop-opacity="1"/>');
    expect(sceneResult.svg).toContain('<stop offset="0.72156862745098" stop-color="#A4A79E" stop-opacity="1"/>');
    expect(sceneResult.svg).toContain('<stop offset="1" stop-color="#FCFDFA" stop-opacity="1"/>');

    const bounds = rootResult.composition.framing.contentBounds;
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(Number.isFinite(bounds.x)).toBe(true);
    expect(Number.isFinite(bounds.y)).toBe(true);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(rootResult.composition.radialGradientCount).toBe(1);
    expect(rootResult.composition.radialGradientStopCount).toBe(4);
    expect(rootResult.composition.strokeSegmentCount).toBe(5);
  });

  it('uses deterministic target-scoped radial ids for stroke paint', async () => {
    const { bytes, scene } = await renderTargets();
    const [first, repeated] = await Promise.all([
      buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 }),
      buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 }),
    ]);
    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!first.ok || !repeated.ok) return;
    expect(first.svg).toBe(repeated.svg);
    expect(radialIds(first.svg)).toEqual(radialIds(repeated.svg));
  });

  it('keeps the linear-gradient stroke family fail-closed', async () => {
    const linearStroke = SOURCE_RADIAL_STROKE
      .replace('<RadialGradient spreadMethod="reflect">', '<LinearGradient spreadMethod="reflect">')
      .replace('</RadialGradient>', '</LinearGradient>');
    const { sceneResult } = await renderTargets(linearStroke);
    expect(sceneResult).toMatchObject({ ok: false, code: 'TARGET_UNSUPPORTED' });
    if (!sceneResult.ok) expect(sceneResult.message).toContain('StrokeStyle 3');
  });

  it.each([
    ['malformed matrix', SOURCE_RADIAL_STROKE.replace(/<matrix>[\s\S]*?<\/matrix>/u, ''), 'RENDER_FAILED'],
    ['out-of-order stops', SOURCE_RADIAL_STROKE.replace('ratio="0.447058823529412"', 'ratio="0.1"'), 'RENDER_FAILED'],
    ['unknown spread', SOURCE_RADIAL_STROKE.replace('spreadMethod="reflect"', 'spreadMethod="unsupported"'), 'TARGET_UNSUPPORTED'],
    ['horizontal scale mode', SOURCE_RADIAL_STROKE.replace('scaleMode="normal"', 'scaleMode="horizontal"'), 'TARGET_UNSUPPORTED'],
    ['pixel hinting', SOURCE_RADIAL_STROKE.replace('scaleMode="normal"', 'scaleMode="normal" pixelHinting="true"'), 'TARGET_UNSUPPORTED'],
  ] as const)('fails closed for %s in a radial stroke', async (_name, strokeStyle, code) => {
    const { sceneResult } = await renderTargets(strokeStyle);
    expect(sceneResult).toMatchObject({ ok: false, code });
    if (!sceneResult.ok) expect(sceneResult.message).toContain('StrokeStyle 3');
  });

  it('enforces the existing per-style gradient-stop budget for stroke paint', async () => {
    const matrixEnd = SOURCE_RADIAL_STROKE.indexOf('</matrix>') + '</matrix>'.length;
    const radialEnd = SOURCE_RADIAL_STROKE.indexOf('</RadialGradient>');
    const stops = Array.from({ length: 257 }, (_, index) =>
      `<GradientEntry color="#594F45" ratio="${String(index / 256)}"/>`,
    ).join('');
    const overBudget = SOURCE_RADIAL_STROKE.slice(0, matrixEnd) + stops + SOURCE_RADIAL_STROKE.slice(radialEnd);
    const { sceneResult } = await renderTargets(overBudget);
    expect(sceneResult).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    if (!sceneResult.ok) expect(sceneResult.message).toContain('StrokeStyle 3');
  });
});
