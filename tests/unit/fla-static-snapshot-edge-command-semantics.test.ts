import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

async function renderScene(shapeXml: string) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="8" height="8" frameRate="24">
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

function solidFillEdge(commands: string): string {
  return `<DOMShape>
    <fills><FillStyle index="1"><SolidColor color="#ff0000"/></FillStyle></fills>
    <edges><Edge fillStyle1="1" cubics="${commands}"/></edges>
  </DOMShape>`;
}

function fillPathTags(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\bfill="[^"]*"[^>]*\/>/gu)].map((match) => match[0] ?? '');
}

function pathData(path: string | undefined): string {
  return path?.match(/\bd="([^"]*)"/u)?.[1] ?? '';
}

describe('FLA authored Edge command semantics', () => {
  it.each([
    ['#000001.F0', 1.9375 / 20],
    ['#FFF086.FB', -3961.01953125 / 20],
    ['#000000.F0', 0.9375 / 20],
    ['#000001', 1 / 20],
    ['#FFF086', -3962 / 20],
  ])('decodes XFL fixed-point coordinate %s in the Main static renderer', async (coordinate, expectedX) => {
    const rendered = await renderScene(solidFillEdge(
      `!${coordinate} 0|${coordinate} 40|40 40|40 0/`,
    ));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = fillPathTags(rendered.svg)[0];
    expect(pathData(path)).toContain(`M ${expectedX.toFixed(4)} 0.0000`);
  });

  it('preserves distinct Move commands even when their decoded points differ by less than 0.5 px', async () => {
    const rendered = await renderScene(solidFillEdge(
      '!0 0|80 0|80 80|0 80|0 0/!1 1|81 1|81 81|1 81|1 1/',
    ));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = fillPathTags(rendered.svg);
    expect(paths).toHaveLength(1);
    expect(rendered.composition.fillContourCount).toBe(2);
    expect(pathData(paths[0]).match(/\bM /gu)).toHaveLength(2);
    expect(pathData(paths[0])).toContain('M 0.0500 0.0500');
  });

  it('preserves a non-zero authored Line shorter than the old 0.5 px threshold without changing its endpoint', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0|1 0|40 0|40 40|0 40|0 0/'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = fillPathTags(rendered.svg);
    expect(pathData(paths[0])).toContain('L 0.0500 0.0000');
    expect(rendered.composition.fillBoundarySegmentCount).toBe(5);
  });

  it('keeps exact duplicate Moves and zero-length Lines deterministic and geometrically redundant', async () => {
    const withDuplicate = solidFillEdge('!0 0!0 0|0 0|40 0|40 40|0 40|0 0/');
    const withoutDuplicate = solidFillEdge('!0 0|40 0|40 40|0 40|0 0/');
    const first = await renderScene(withDuplicate);
    const second = await renderScene(withDuplicate);
    const baseline = await renderScene(withoutDuplicate);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!first.ok || !second.ok || !baseline.ok) return;
    expect(fillPathTags(first.svg)).toEqual(fillPathTags(second.svg));
    expect(pathData(fillPathTags(first.svg)[0])).toBe(pathData(fillPathTags(baseline.svg)[0]));
    expect(first.composition.fillBoundarySegmentCount).toBe(4);
    expect(first.composition.fillBoundarySegmentCount).toBe(baseline.composition.fillBoundarySegmentCount);
  });

  it('honors an explicit source close command and keeps its authored closure segment', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0|40 0|40 40|0 40/'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.composition.fillBoundarySegmentCount).toBe(4);
    expect(pathData(fillPathTags(rendered.svg)[0])).toMatch(/L 0\.0000 2\.0000 L 0\.0000 0\.0000 Z$/u);
  });

  it('does not infer closure for endpoints that are merely near the subpath start', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0|40 0|40 40|0 40|1 0'));

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('TARGET_UNSUPPORTED');
      expect(rendered.message).toContain('has an open fill boundary');
    }
  });

  it('normalizes an exact endpoint closure without adding another boundary segment', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0|40 0|40 40|0 40|0 0'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const data = pathData(fillPathTags(rendered.svg)[0]);
    expect(data.match(/\bL /gu)).toHaveLength(4);
    expect(data).toMatch(/L 0\.0000 0\.0000 Z$/u);
    expect(rendered.composition.fillBoundarySegmentCount).toBe(4);
  });
});
