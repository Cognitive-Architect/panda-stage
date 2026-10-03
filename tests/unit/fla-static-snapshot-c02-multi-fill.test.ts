import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

async function renderScene(shapeXml: string) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="4" height="2" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene) throw new Error('Synthetic scene target was not cataloged');
  return buildSvgForRenderTarget(bytes, scene.target);
}

function fillPathAttributes(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\/>/gu)].map((match) => match[0] ?? '');
}

function twoAdjacentRegions(): string {
  return `<DOMShape>
    <fills>
      <FillStyle index="2"><SolidColor color="#0000ff" alpha="0.5"/></FillStyle>
      <FillStyle index="1"><SolidColor color="#ff0000" alpha="1"/></FillStyle>
    </fills>
    <edges>
      <Edge fillStyle1="1" cubics="!0 0|40 0"/>
      <Edge fillStyle0="1" fillStyle1="2" cubics="!40 40|40 0"/>
      <Edge fillStyle1="1" cubics="!40 40|0 40"/>
      <Edge fillStyle1="1" cubics="!0 40|0 0"/>
      <Edge fillStyle1="2" cubics="!40 0|80 0"/>
      <Edge fillStyle1="2" cubics="!80 0|80 40"/>
      <Edge fillStyle1="2" cubics="!80 40|40 40"/>
    </edges>
  </DOMShape>`;
}

describe('P2-C02 solid multi-fill reconstruction', () => {
  it('renders both adjacent regions from fillStyle0/fillStyle1 ownership in source fill order', async () => {
    const rendered = await renderScene(twoAdjacentRegions());

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = fillPathAttributes(rendered.svg);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('fill="#0000ff"');
    expect(paths[0]).toContain('fill-opacity="0.5"');
    expect(paths[0]).toContain('d="M 2.0000 2.0000 L 2.0000 0.0000 L 4.0000 0.0000 L 4.0000 2.0000 L 2.0000 2.0000 Z"');
    expect(paths[1]).toContain('fill="#ff0000"');
    expect(paths[1]).toContain('fill-opacity="1"');
    expect(paths[1]).toContain('d="M 0.0000 0.0000 L 2.0000 0.0000 L 2.0000 2.0000 L 0.0000 2.0000 L 0.0000 0.0000 Z"');
    expect(paths.every((path) => path.includes('fill-rule="nonzero"'))).toBe(true);
    expect(rendered.firstFillColor).toBe('#0000ff');
    expect(rendered.composition.fillRegionCount).toBe(2);
    expect(rendered.composition.fillContourCount).toBe(2);
    expect(rendered.composition.fillBoundarySegmentCount).toBe(8);
    expect(rendered.composition.pathCommandCount).toBe(14);
    expect(rendered.hasRenderablePath).toBe(true);
    expect(rendered.svg).toContain('fillRegions=2 fillContours=2 fillBoundarySegments=8');
  });

  it('keeps disconnected regions that share a FillStyle as separate contours in one path', async () => {
    const rendered = await renderScene(`<DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#33aa55"/></FillStyle></fills>
      <edges>
        <Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/>
        <Edge fillStyle1="1" cubics="!40 0|60 0|60 20|40 20|40 0"/>
      </edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = fillPathAttributes(rendered.svg);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.match(/\bM /gu)).toHaveLength(2);
    expect(rendered.composition.fillRegionCount).toBe(1);
    expect(rendered.composition.fillContourCount).toBe(2);
  });

  it('keeps radial fills explicitly unsupported after linear-gradient graduation', async () => {
    const rendered = await renderScene(`<DOMShape>
      <fills><FillStyle index="1" type="radial"><RadialGradient><GradientEntry color="#000000" ratio="0"/></RadialGradient></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('TARGET_UNSUPPORTED');
      expect(rendered.message).toContain('P2-C04 supports solid and linear fills only');
    }
  });

  it('keeps bitmap fills explicitly unsupported after linear-gradient graduation', async () => {
    const rendered = await renderScene(`<DOMShape>
      <fills><FillStyle index="1"><BitmapFill bitmapPath="bitmap.png"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('TARGET_UNSUPPORTED');
      expect(rendered.message).toContain('unsupported bitmap fill');
    }
  });

  it('does not close an open fill boundary by inventing geometry', async () => {
    const shape = `<DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#ff0000"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|40 0|40 40"/></edges>
    </DOMShape>`;
    const first = await renderScene(shape);
    const second = await renderScene(shape);

    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.code).toBe('TARGET_UNSUPPORTED');
      expect(first.message).toContain('has an open fill boundary');
    }
  });
});
