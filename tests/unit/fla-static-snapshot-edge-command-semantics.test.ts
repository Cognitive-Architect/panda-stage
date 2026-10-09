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

function solidFillEdge(
  commands: string,
  fillOwner: 'fillStyle0' | 'fillStyle1' = 'fillStyle1',
): string {
  return `<DOMShape>
    <fills><FillStyle index="1"><SolidColor color="#ff0000"/></FillStyle></fills>
    <edges><Edge ${fillOwner}="1" cubics="${commands}"/></edges>
  </DOMShape>`;
}

// These exact D-A Edge 0 commands are from the frozen #744 archive
// 5A501D1F787707A3965BECC31E2E5B8F5DDC519B25369E16EF68E72AF674EB5D.
// Its explicit-close comparison D-B is frozen as
// 2ADC8598EE0B4747E95E48F83BA8FE57617E2B189F922B90943EB72C5BAC50A0.
const ISSUE_744_D_A_EDGE_0 =
  '!19217 12872/19207 12777!19207 12777[19069 12813 18925 12864!18925 12864[18625 12968 18566 13039!18566 13039|18666 13131!18666 13131/18705 13183';

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
      `!${coordinate} 0|${coordinate} 40|40 40|40 0|${coordinate} 0`,
    ));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const path = fillPathTags(rendered.svg)[0];
    expect(pathData(path)).toContain(`M ${expectedX.toFixed(4)} 0.0000`);
  });

  it('decodes both frozen D-A coordinate-bearing slash records as lines and keeps adjacent ! and curves in one subpath', async () => {
    const rendered = await renderScene(solidFillEdge(`${ISSUE_744_D_A_EDGE_0}|19217 12872`, 'fillStyle0'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const data = pathData(fillPathTags(rendered.svg)[0]);
    expect(data).toContain('M 960.3500 638.8500 L 960.8500 643.6000');
    expect(data).toContain('L 935.2500 659.1500 L 933.3000 656.5500');
    expect(data.match(/\bM /gu)?.length).toBe(1);
    expect(data.match(/\bQ /gu)?.length).toBe(2);
    expect(data.match(/\bZ\b/gu)?.length).toBe(1);
    expect(data).toMatch(/ Z$/u);
    expect(rendered.composition.fillBoundarySegmentCount).toBe(6);
  });

  it.each(['fillStyle0', 'fillStyle1'] as const)(
    'uses the same slash line geometry and boundary ownership for %s',
    async (fillOwner) => {
      const rendered = await renderScene(solidFillEdge(
        '!0 0/40 0|40 40|0 40|0 0',
        fillOwner,
      ));

      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      const data = pathData(fillPathTags(rendered.svg)[0]);
      expect(data).toContain('2.0000 0.0000');
      expect(rendered.composition.fillBoundarySegmentCount).toBe(4);
    },
  );

  it('consumes a zero-length slash line without adding geometry or ending the current subpath', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0/0 0|40 0|40 40|0 40|0 0'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const data = pathData(fillPathTags(rendered.svg)[0]);
    expect(data).toMatch(/^M 0\.0000 0\.0000 L 2\.0000 0\.0000/u);
    expect(data.match(/\bL /gu)?.length).toBe(4);
    expect(data).toMatch(/L 0\.0000 0\.0000 Z$/u);
    expect(rendered.composition.fillBoundarySegmentCount).toBe(4);
  });

  it('decodes negative #738 fixed-point coordinates on a slash line', async () => {
    const rendered = await renderScene(solidFillEdge(
      '!#FFF086.FB 0/#FFF000 0|#FFF000 40|#FFF086.FB 40|#FFF086.FB 0',
    ));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const data = pathData(fillPathTags(rendered.svg)[0]);
    expect(data).toContain('M -198.0510 0.0000 L -204.8000 0.0000');
    expect(rendered.composition.fillBoundarySegmentCount).toBe(4);
  });

  it('applies the existing shape path-command budget to non-zero slash lines', async () => {
    const rendered = await renderScene(solidFillEdge(`!0 0${'/1 0/0 0'.repeat(500_000)}`));

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('BUDGET_EXCEEDED');
      expect(rendered.message).toContain('path-command budget exceeded');
    }
  }, 30_000);

  it.each([
    ['bare slash', '!0 0/|40 0|40 40|0 40|0 0', 'Unsupported bare slash command'],
    ['one operand', '!0 0/40|40 40|0 40|0 0', 'Malformed coordinate-bearing slash command'],
    ['three operands', '!0 0/40 0 80|40 40|0 40|0 0', 'Malformed coordinate-bearing slash command'],
    ['invalid coordinate', '!0 0/nope 0|40 40|0 40|0 0', 'Malformed coordinate-bearing slash command'],
    ['missing current point', '/40 0|40 40|0 40|0 0', 'Malformed coordinate-bearing slash command'],
    ['coordinate beyond the existing range', '!0 0/4000020 0|40 40|0 40|0 0', 'Malformed coordinate-bearing slash command'],
  ])('fails closed for a %s', async (_name, commands, message) => {
    const rendered = await renderScene(solidFillEdge(commands));

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('RENDER_FAILED');
      expect(rendered.message).toContain(message);
    }
  });

  it('preserves distinct Move commands even when their decoded points differ by less than 0.5 px', async () => {
    const rendered = await renderScene(solidFillEdge(
      '!0 0|80 0|80 80|0 80|0 0!1 1|81 1|81 81|1 81|1 1',
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
    const rendered = await renderScene(solidFillEdge('!0 0|1 0|40 0|40 40|0 40|0 0'));

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const paths = fillPathTags(rendered.svg);
    expect(pathData(paths[0])).toContain('L 0.0500 0.0000');
    expect(rendered.composition.fillBoundarySegmentCount).toBe(5);
  });

  it('keeps exact duplicate Moves and zero-length Lines deterministic and geometrically redundant', async () => {
    const withDuplicate = solidFillEdge('!0 0!0 0|0 0|40 0|40 40|0 40|0 0');
    const withoutDuplicate = solidFillEdge('!0 0|40 0|40 40|0 40|0 0');
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

  it('rejects a bare slash because no frozen FLA establishes it as close-path', async () => {
    const rendered = await renderScene(solidFillEdge('!0 0|40 0|40 40|0 40/'));

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('RENDER_FAILED');
      expect(rendered.message).toContain('Unsupported bare slash command');
    }
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
