import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

// Synthetic geometry only. Paint values and omitted fields mirror #944's
// proven Style 4 contract; no source character geometry is included.
const EVIDENCED_LINEAR_STROKE = `<StrokeStyle index="1">
  <SolidStroke scaleMode="normal"><fill>
    <LinearGradient spreadMethod="reflect">
      <matrix><Matrix a="0.009490966796875" d="0.01239013671875" tx="814.65" ty="625.65"/></matrix>
      <GradientEntry color="#594F45" ratio="0.152941176470588"/>
      <GradientEntry color="#D7DFD5" ratio="0.447058823529412"/>
      <GradientEntry color="#A4A79E" ratio="0.72156862745098"/>
      <GradientEntry color="#FCFDFA" ratio="1"/>
    </LinearGradient>
  </fill></SolidStroke>
</StrokeStyle>`;

const RADIAL_CONTROL_STROKE = `<StrokeStyle index="2">
  <SolidStroke scaleMode="normal"><fill>
    <RadialGradient spreadMethod="reflect">
      <matrix><Matrix a="1" b="0" c="0" d="1" tx="0" ty="0"/></matrix>
      <GradientEntry color="#594F45" ratio="0"/>
      <GradientEntry color="#FCFDFA" ratio="1"/>
    </RadialGradient>
  </fill></SolidStroke>
</StrokeStyle>`;

const EXPLICIT_SAFE_LINEAR_STROKE = `<StrokeStyle index="3">
  <SolidStroke weight="2" caps="round" joints="round" scaleMode="normal" pixelHinting="false"><fill>
    <LinearGradient spreadMethod="reflect" interpolationMethod="rgb">
      <matrix><Matrix a="0.01" b="0" c="0" d="0.02" tx="4" ty="5"/></matrix>
      <GradientEntry color="#123456" alpha="0.25" ratio="0"/>
      <GradientEntry color="#abcdef" alpha="0.75" ratio="1"/>
    </LinearGradient>
  </fill></SolidStroke>
</StrokeStyle>`;

const ROOT_MATRIX = '<matrix><Matrix a="2" d="2" tx="10" ty="20"/></matrix>';
const CHILD_MATRIX = '<matrix><Matrix a="3" d="3" tx="5" ty="7"/></matrix>';
const IDENTITY_MATRIX = '<matrix><Matrix/></matrix>';

async function renderScene(strokes: string, edges: string) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="1920" height="1080" frameRate="24"><timelines>
  <DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1"><frames>
    <DOMFrame index="0"><elements>
      <DOMSymbolInstance libraryItemName="issue946-root" symbolType="graphic">${ROOT_MATRIX}</DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline>
</timelines></DOMDocument>`);
  zip.file('LIBRARY/issue946-root.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="issue946-root" symbolType="graphic"><timeline>
  <DOMTimeline name="Root"><layers><DOMLayer name="Layer 1"><frames>
    <DOMFrame index="0"><elements>
      <DOMSymbolInstance libraryItemName="issue946-strokes" symbolType="graphic">${CHILD_MATRIX}</DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline>
</timeline></DOMSymbolItem>`);
  zip.file('LIBRARY/issue946-strokes.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="issue946-strokes" symbolType="graphic"><timeline>
  <DOMTimeline name="Strokes"><layers><DOMLayer name="Layer 1"><frames>
    <DOMFrame index="0"><elements>
      <DOMShape>${IDENTITY_MATRIX}<fills/><strokes>${strokes}</strokes><edges>${edges}</edges></DOMShape>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline>
</timeline></DOMSymbolItem>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene')?.target;
  if (!scene) throw new Error('Synthetic scene target was not cataloged');
  return buildSvgForRenderTarget(bytes, scene);
}

function strokePaths(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\bstroke="[^"]*"[^>]*\/>/gu)]
    .map((match) => match[0] ?? '');
}

describe('P2-C07 evidence-bounded linear-gradient stroke reconstruction', () => {
  it('renders the #944 proven fixed-width stroke with its source-order radial control', async () => {
    const rendered = await renderScene(
      EVIDENCED_LINEAR_STROKE + RADIAL_CONTROL_STROKE,
      '<Edge strokeStyle="1" cubics="!100 100|200 100"/><Edge strokeStyle="2" cubics="!100 120|200 120"/>',
    );

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    const linearId = [...rendered.svg.matchAll(/<linearGradient\b id="([^"]+)"/gu)]
      .map((match) => match[1] as string);
    expect(linearId).toHaveLength(1);
    expect(rendered.svg).toContain('gradientUnits="userSpaceOnUse" x1="-819.2" y1="0" x2="819.2" y2="0"');
    expect(rendered.svg).toContain('gradientTransform="matrix(0.009490966796875 0 0 0.01239013671875 814.65 625.65)"');
    expect(rendered.svg).toContain('spreadMethod="reflect" color-interpolation="sRGB"');
    expect(rendered.svg).toContain('<stop offset="0.152941176470588" stop-color="#594F45" stop-opacity="1"/>');
    expect(rendered.svg).toContain('<stop offset="0.447058823529412" stop-color="#D7DFD5" stop-opacity="1"/>');
    expect(rendered.svg).toContain('<stop offset="0.72156862745098" stop-color="#A4A79E" stop-opacity="1"/>');
    expect(rendered.svg).toContain('<stop offset="1" stop-color="#FCFDFA" stop-opacity="1"/>');

    const paths = strokePaths(rendered.svg);
    const linearPath = paths.find((path) => path.includes('stroke="url(#fla-linear-'));
    const radialPath = paths.find((path) => path.includes('stroke="url(#fla-radial-'));
    expect(linearPath).toBeDefined();
    expect(radialPath).toBeDefined();
    expect(paths.indexOf(linearPath ?? '')).toBeLessThan(paths.indexOf(radialPath ?? ''));
    expect(linearPath).toContain('stroke-width="1"');
    expect(linearPath).toContain('stroke-linecap="round"');
    expect(linearPath).toContain('stroke-linejoin="round"');
    expect(linearPath).toContain('transform="matrix(6 0 0 6 20 34)"');
    expect(rendered.composition.linearGradientCount).toBe(1);
    expect(rendered.composition.linearGradientStopCount).toBe(4);
    expect(rendered.composition.radialGradientCount).toBe(1);
    expect(rendered.hasRenderablePath).toBe(true);
  });

  it('continues to render the same-symbol radial-gradient control by itself', async () => {
    const rendered = await renderScene(
      RADIAL_CONTROL_STROKE,
      '<Edge strokeStyle="2" cubics="!100 120|200 120"/>',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.svg).toContain('stroke="url(#fla-radial-');
    expect(rendered.composition.radialGradientCount).toBe(1);
    expect(rendered.composition.linearGradientCount).toBe(0);
  });

  it('accepts the explicit round-cap subset without relying on omitted defaults', async () => {
    const rendered = await renderScene(
      EXPLICIT_SAFE_LINEAR_STROKE,
      '<Edge strokeStyle="3" cubics="!100 100|200 100"/>',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.svg).toContain('stroke-width="2"');
    expect(rendered.svg).toContain('<stop offset="0" stop-color="#123456" stop-opacity="0.25"/>');
    expect(rendered.svg).toContain('<stop offset="1" stop-color="#abcdef" stop-opacity="0.75"/>');
    expect(rendered.svg).toContain('spreadMethod="reflect" color-interpolation="sRGB"');
  });

  it.each([
    ['hairline', EVIDENCED_LINEAR_STROKE.replace('scaleMode="normal"', 'scaleMode="normal" weight="0"'), 'TARGET_UNSUPPORTED'],
    ['unsupported spread', EVIDENCED_LINEAR_STROKE.replace('spreadMethod="reflect"', 'spreadMethod="pad"'), 'TARGET_UNSUPPORTED'],
    ['unsupported interpolation', EVIDENCED_LINEAR_STROKE.replace('spreadMethod="reflect"', 'spreadMethod="reflect" interpolationMethod="linearRGB"'), 'TARGET_UNSUPPORTED'],
    ['non-finite matrix', EVIDENCED_LINEAR_STROKE.replace('a="0.009490966796875"', 'a="NaN"'), 'RENDER_FAILED'],
    ['malformed alpha', EVIDENCED_LINEAR_STROKE.replace('color="#594F45" ratio=', 'color="#594F45" alpha="1.5" ratio='), 'RENDER_FAILED'],
    ['unproven omitted-field variant', EVIDENCED_LINEAR_STROKE.replace('color="#FCFDFA" ratio="1"', 'color="#EEEEEE" ratio="1"'), 'TARGET_UNSUPPORTED'],
    ['variable point width', EVIDENCED_LINEAR_STROKE.replace('</SolidStroke>', '<VariablePointWidth/></SolidStroke>'), 'TARGET_UNSUPPORTED'],
  ] as const)('fails closed for %s', async (_name, stroke, code) => {
    const rendered = await renderScene(stroke, '<Edge strokeStyle="1" cubics="!100 100|200 100"/>');
    expect(rendered).toMatchObject({ ok: false, code });
  });

  it('enforces the existing per-style gradient-stop budget for linear stroke paint', async () => {
    const matrixEnd = EVIDENCED_LINEAR_STROKE.indexOf('</matrix>') + '</matrix>'.length;
    const gradientEnd = EVIDENCED_LINEAR_STROKE.indexOf('</LinearGradient>');
    const stops = Array.from({ length: 257 }, (_, index) =>
      `<GradientEntry color="#594F45" ratio="${String(index / 256)}"/>`,
    ).join('');
    const overBudget = EVIDENCED_LINEAR_STROKE.slice(0, matrixEnd) + stops +
      EVIDENCED_LINEAR_STROKE.slice(gradientEnd);
    const rendered = await renderScene(overBudget, '<Edge strokeStyle="1" cubics="!100 100|200 100"/>');
    expect(rendered).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
  });
});
