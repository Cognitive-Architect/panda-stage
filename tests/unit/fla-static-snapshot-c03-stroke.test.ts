import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

function strokeStyle(attributes: string, color = '#202020', alpha = '1', fill = ''): string {
  return `<strokes><StrokeStyle index="1"><SolidStroke ${attributes}><fill>${fill || `<SolidColor color="${color}" alpha="${alpha}"/>`}</fill></SolidStroke></StrokeStyle></strokes>`;
}

async function renderScene(elements: string, width = 24, height = 24) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="${width}" height="${height}" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene) throw new Error('Synthetic scene target was not cataloged');
  return buildSvgForRenderTarget(bytes, scene.target);
}

async function renderGraphic(shapeXml: string) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="24" height="24" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements/></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  zip.file('LIBRARY/stroke-sample.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="stroke-sample" symbolType="graphic">
  <timeline><DOMTimeline name="stroke-sample"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const graphic = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol');
  if (!graphic) throw new Error('Synthetic Graphic target was not cataloged');
  return buildSvgForRenderTarget(bytes, graphic.target);
}

function strokePathTags(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\bstroke="[^>]*\/>/gu)].map((match) => match[0] ?? '');
}

describe('P2-C03 solid stroke reconstruction', () => {
  it('uses the XFL default black when a solid stroke omits its color attribute', async () => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle('weight="2"', '#abcdef', '1', '<SolidColor/>')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(strokePathTags(rendered.svg)[0]).toContain('stroke="#000000"');
  });

  it('keeps stroke-only art visible and preserves solid color, alpha, weight, cap, join, and miter limit', async () => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle('weight="4" caps="none" joints="miter" miterLimit="6"', '#123456', '0.5')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = strokePathTags(rendered.svg);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('fill="none"');
    expect(paths[0]).toContain('stroke="#123456"');
    expect(paths[0]).toContain('stroke-opacity="0.5"');
    expect(paths[0]).toContain('stroke-width="4"');
    expect(paths[0]).toContain('stroke-linecap="butt"');
    expect(paths[0]).toContain('stroke-linejoin="miter"');
    expect(paths[0]).toContain('stroke-miterlimit="6"');
    expect(rendered.hasRenderablePath).toBe(true);
    expect(rendered.composition.strokePathCount).toBe(1);
    expect(rendered.composition.strokeSegmentCount).toBe(1);
    expect(rendered.svg).toContain('strokePaths=1 strokeSegments=1');
  });

  it.each([
    ['none', 'butt'],
    ['butt', 'butt'],
    ['round', 'round'],
    ['square', 'square'],
  ])('maps caps=%s to deterministic SVG cap %s', async (caps, expected) => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle(`weight="4" caps="${caps}"`)}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(strokePathTags(rendered.svg)[0]).toContain(`stroke-linecap="${expected}"`);
  });

  it.each(['miter', 'bevel', 'round'] as const)('maps joints=%s to SVG and preserves its miter limit', async (joints) => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle(`weight="4" joints="${joints}" miterLimit="5.5"`)}
      <edges><Edge strokeStyle="1" cubics="!40 40|120 200|220 40"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = strokePathTags(rendered.svg)[0] ?? '';
    expect(path).toContain(`stroke-linejoin="${joints}"`);
    expect(path).toContain('stroke-miterlimit="5.5"');
  });

  it('joins connected Edge records into one stroke path so joins are not replaced by endpoint caps', async () => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle('weight="3" caps="round" joints="bevel"')}
      <edges>
        <Edge strokeStyle="1" cubics="!40 120|120 120"/>
        <Edge strokeStyle="1" cubics="!120 40|120 120"/>
      </edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = strokePathTags(rendered.svg);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.match(/\bM /gu)).toHaveLength(1);
    expect(paths[0]).toContain('d="M 2.0000 6.0000 L 6.0000 6.0000 L 6.0000 2.0000"');
    expect(paths[0]).toContain('stroke-linejoin="bevel"');
    expect(rendered.composition.strokeSegmentCount).toBe(2);
  });

  it('keeps a non-branched closed stroke loop output unchanged', async () => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle('weight="2" caps="round" joints="round"')}
      <edges><Edge strokeStyle="1" cubics="!100 100|200 100|200 200|100 200|100 100"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = strokePathTags(rendered.svg);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('d="M 5.0000 5.0000 L 10.0000 5.0000 L 10.0000 10.0000 L 5.0000 10.0000 L 5.0000 5.0000 Z"');
    expect(rendered.composition.strokeSegmentCount).toBe(4);
  });

  it('expands transformed Graphic content bounds by the stroke envelope before adding padding', async () => {
    const rendered = await renderGraphic(`<DOMShape>
      <matrix><Matrix a="2" b="0.5" c="0" d="1.5" tx="3" ty="4"/></matrix>
      ${strokeStyle('weight="4" caps="round" joints="bevel"')}
      <edges><Edge strokeStyle="1" cubics="!0 0|120 0"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const bounds = rendered.composition.framing.contentBounds;
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.x).toBeCloseTo(-1, 5);
    expect(bounds.y).toBeCloseTo(4 - Math.hypot(0.5, 1.5) * 2, 5);
    expect(bounds.width).toBeCloseTo(20, 5);
    expect(bounds.height).toBeCloseTo(3 + Math.hypot(0.5, 1.5) * 4, 5);
    expect(rendered.composition.framing.padding).toBe(4);
    expect(rendered.composition.framing.viewBox.x).toBeCloseTo(bounds.x - 4, 5);
    expect(rendered.composition.framing.viewBox.y).toBeCloseTo(bounds.y - 4, 5);
    expect(rendered.hasRenderablePath).toBe(true);
  });

  it('reconstructs source-default horizontal strokes with horizontal scaling and source-default style values', async () => {
    const rendered = await renderGraphic(`<DOMShape>
      <matrix><Matrix a="2" b="0" c="0" d="1" tx="3" ty="4"/></matrix>
      ${strokeStyle('scaleMode="horizontal"', '#abcdef', '1', '<SolidColor/>')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = strokePathTags(rendered.svg)[0] ?? '';
    expect(path).toContain('d="M 13.0000 8.0000 L 23.0000 8.0000"');
    expect(path).not.toContain('transform=');
    expect(path).toContain('stroke="#000000"');
    expect(path).toContain('stroke-width="2"');
    expect(path).toContain('stroke-linecap="round"');
    expect(path).toContain('stroke-linejoin="round"');

    const bounds = rendered.composition.framing.contentBounds;
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.x).toBeCloseTo(12, 5);
    expect(bounds.y).toBeCloseTo(7, 5);
    expect(bounds.width).toBeCloseTo(12, 5);
    expect(bounds.height).toBeCloseTo(2, 5);
  });

  it('keeps horizontal stroke weight unchanged under vertical-only scaling', async () => {
    const rendered = await renderGraphic(`<DOMShape>
      <matrix><Matrix a="1" b="0" c="0" d="2" tx="0" ty="0"/></matrix>
      ${strokeStyle('scaleMode="horizontal"', '#abcdef', '1', '<SolidColor/>')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = strokePathTags(rendered.svg)[0] ?? '';
    expect(path).toContain('d="M 5.0000 8.0000 L 10.0000 8.0000"');
    expect(path).not.toContain('transform=');
    expect(path).toContain('stroke-width="1"');
  });

  it.each([
    [
      'X2 parent transform',
      'a="1.56097412109375" b="-0.20831298828125" c="0.4166259765625" d="0.780487060546875"',
      Math.hypot(1.56097412109375, -0.20831298828125),
    ],
    [
      'Y2 parent transform',
      'a="0.780487060546875" b="-0.4166259765625" c="0.20831298828125" d="1.56097412109375"',
      Math.hypot(0.780487060546875, -0.4166259765625),
    ],
  ])('preserves the source-rotated horizontal stroke under a %s', async (_name, matrixAttributes, expectedWidth) => {
    const rendered = await renderGraphic(`<DOMShape>
      <matrix><Matrix ${matrixAttributes} tx="3" ty="4"/></matrix>
      ${strokeStyle('scaleMode="horizontal"', '#abcdef', '1', '<SolidColor/>')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = strokePathTags(rendered.svg)[0] ?? '';
    expect(path).not.toContain('transform=');
    const strokeWidth = Number(path.match(/\bstroke-width="([^"]+)"/u)?.[1]);
    expect(strokeWidth).toBeCloseTo(expectedWidth, 12);
  });

  it('preserves the normal-mode SVG transform as the normal-stroke control', async () => {
    const rendered = await renderGraphic(`<DOMShape>
      <matrix><Matrix a="2" b="0" c="0" d="1" tx="3" ty="4"/></matrix>
      ${strokeStyle('scaleMode="normal"', '#abcdef', '1', '<SolidColor/>')}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = strokePathTags(rendered.svg)[0] ?? '';
    expect(path).toContain('d="M 5.0000 4.0000 L 10.0000 4.0000"');
    expect(path).toContain('transform="matrix(2 0 0 1 3 4)"');
    expect(path).toContain('stroke-width="1"');
  });

  it.each([
    ['vertical scale mode', strokeStyle('weight="2" scaleMode="vertical"')],
    ['none scale mode', strokeStyle('weight="2" scaleMode="none"')],
    ['unknown scale mode', strokeStyle('weight="2" scaleMode="diagonal"')],
    ['pixel hinting', strokeStyle('weight="2" pixelHinting="true"')],
    ['gradient stroke', strokeStyle('weight="2"', '#000000', '1', '<LinearGradient><GradientEntry color="#000000" ratio="0"/></LinearGradient>')],
    ['bitmap stroke', strokeStyle('weight="2"', '#000000', '1', '<BitmapFill bitmapPath="LIBRARY/pattern.png"/>')],
  ])('fails explicitly for unsupported %s semantics', async (_name, styles) => {
    const rendered = await renderScene(`<DOMShape>
      ${styles}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('TARGET_UNSUPPORTED');
      expect(rendered.message).toContain('P2-C03 supports normal and horizontal SolidStroke semantics only');
    }
  });

  it.each([
    ['invalid weight', strokeStyle('weight="invalid"')],
    ['invalid color', strokeStyle('weight="2"', '#000000', '1', '<SolidColor color="invalid"/>')],
  ])('fails closed for %s', async (_name, styles) => {
    const rendered = await renderScene(`<DOMShape>
      ${styles}
      <edges><Edge strokeStyle="1" cubics="!100 80|200 80"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) expect(rendered.code).toBe('RENDER_FAILED');
  });

  it('preserves authored T-junction subpaths without adding connector geometry', async () => {
    const rendered = await renderGraphic(`<DOMShape>
      ${strokeStyle('weight="2"', '#abcdef', '0.75', '<SolidColor color="#abcdef" alpha="0.75"/>')}
      <edges>
        <Edge strokeStyle="1" cubics="!100 100|200 100"/>
        <Edge strokeStyle="1" cubics="!200 100|300 100"/>
        <Edge strokeStyle="1" cubics="!200 100|200 200"/>
      </edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = strokePathTags(rendered.svg);
    expect(paths).toHaveLength(3);
    expect(paths.map((path) => path.match(/\bd="([^"]*)"/u)?.[1])).toEqual([
      'M 5.0000 5.0000 L 10.0000 5.0000',
      'M 10.0000 5.0000 L 15.0000 5.0000',
      'M 10.0000 5.0000 L 10.0000 10.0000',
    ]);
    for (const path of paths) {
      expect(path).toContain('stroke="#abcdef"');
      expect(path).toContain('stroke-opacity="0.75"');
      expect(path).toContain('stroke-width="2"');
    }
    expect(rendered.composition.strokePathCount).toBe(3);
    expect(rendered.composition.strokeSegmentCount).toBe(3);
    const bounds = rendered.composition.framing.contentBounds;
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.x).toBeCloseTo(4, 5);
    expect(bounds.y).toBeCloseTo(4, 5);
    expect(bounds.width).toBeCloseTo(12, 5);
    expect(bounds.height).toBeCloseTo(7, 5);
  });

  it('preserves all four authored arms at a degree-four endpoint crossing', async () => {
    const rendered = await renderScene(`<DOMShape>
      ${strokeStyle('weight="2"', '#123456')}
      <edges>
        <Edge strokeStyle="1" cubics="!100 200|200 200"/>
        <Edge strokeStyle="1" cubics="!200 200|300 200"/>
        <Edge strokeStyle="1" cubics="!200 100|200 200"/>
        <Edge strokeStyle="1" cubics="!200 200|200 300"/>
      </edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = strokePathTags(rendered.svg);
    expect(paths).toHaveLength(4);
    expect(paths.map((path) => path.match(/\bd="([^"]*)"/u)?.[1])).toEqual([
      'M 5.0000 10.0000 L 10.0000 10.0000',
      'M 10.0000 10.0000 L 15.0000 10.0000',
      'M 10.0000 5.0000 L 10.0000 10.0000',
      'M 10.0000 10.0000 L 10.0000 15.0000',
    ]);
    expect(paths.every((path) => path.includes('stroke="#123456"'))).toBe(true);
    expect(rendered.composition.strokePathCount).toBe(4);
    expect(rendered.composition.strokeSegmentCount).toBe(4);
  });
});
