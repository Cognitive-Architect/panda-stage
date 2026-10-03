import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

async function makeSceneFla(shapeXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="550" height="400" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function renderScene(shapeXml: string) {
  const bytes = await makeSceneFla(shapeXml);
  const catalog = await buildRenderableTargetCatalog(bytes);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene) throw new Error('Synthetic scene target was not cataloged');
  return buildSvgForRenderTarget(bytes, scene.target);
}

function pathData(svg: string): string | undefined {
  return svg.match(/<path\b[^>]*\bd="([^"]*)"/u)?.[1];
}

function solidFill(index: number, color: string): string {
  return `<FillStyle index="${index}"><SolidColor color="${color}"/></FillStyle>`;
}

describe('P2-C01 style-aware Shape reconstruction', () => {
  it('retains multiple solid fills and distinct edge style references without graduating fill rendering', async () => {
    const styledEdges = `<Edge fillStyle0="1" fillStyle1="2" cubics="${RECT_CUBICS}"/>`;
    const baselineEdges = `<Edge cubics="${RECT_CUBICS}"/>`;
    const styled = await renderScene(`<DOMShape><fills>${solidFill(1, '#112233')}${solidFill(2, '#aabbcc')}</fills><edges>${styledEdges}</edges></DOMShape>`);
    const baseline = await renderScene(`<DOMShape><fills>${solidFill(1, '#112233')}</fills><edges>${baselineEdges}</edges></DOMShape>`);

    expect(styled.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!styled.ok || !baseline.ok) return;
    expect(styled.composition.fillStyleCount).toBe(2);
    expect(styled.composition.strokeStyleCount).toBe(0);
    expect(styled.composition.styleRunCount).toBe(1);
    expect(styled.composition.pathCommandCount).toBe(baseline.composition.pathCommandCount);
    expect(pathData(styled.svg)).toBe(pathData(baseline.svg));
    expect(styled.svg.match(/<path\b/gu)).toHaveLength(1);
    expect(styled.svg).toContain('fill="#112233"');
    expect(styled.svg).toContain('fillStyles=2 strokeStyles=0 styleRuns=1');
  });

  it('retains a stroke-only Shape and its edge reference without drawing strokes in C01', async () => {
    const rendered = await renderScene(`<DOMShape>
      <strokes><StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#202020"/></fill></SolidStroke></StrokeStyle></strokes>
      <edges><Edge strokeStyle="1" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.composition.fillStyleCount).toBe(0);
    expect(rendered.composition.strokeStyleCount).toBe(1);
    expect(rendered.composition.styleRunCount).toBe(1);
    expect(rendered.svg).toContain('stroke="none"');
    expect(rendered.svg).toContain('fillStyles=0 strokeStyles=1 styleRuns=1');
  });

  it('records an authored S<n> change as a second style run while preserving the path commands', async () => {
    const changed = await renderScene(`<DOMShape>
      <fills>${solidFill(1, '#112233')}${solidFill(2, '#aabbcc')}</fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|100 0S2|100 100|0 100|0 0"/></edges>
    </DOMShape>`);
    const unchanged = await renderScene(`<DOMShape>
      <fills>${solidFill(1, '#112233')}${solidFill(2, '#aabbcc')}</fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|100 0|100 100|0 100|0 0"/></edges>
    </DOMShape>`);

    expect(changed.ok).toBe(true);
    expect(unchanged.ok).toBe(true);
    if (!changed.ok || !unchanged.ok) return;
    expect(changed.composition.midEdgeStyleChangeCount).toBe(1);
    expect(changed.composition.styleRunCount).toBe(2);
    expect(changed.composition.pathCommandCount).toBe(unchanged.composition.pathCommandCount);
    expect(pathData(changed.svg)).toBe(pathData(unchanged.svg));
    expect(changed.svg).toContain('styleRuns=2 styleChanges=1');
  });

  it('keeps negative translated geometry and the existing transform unchanged', async () => {
    const transformed = await renderScene(`<DOMShape>
      <matrix><Matrix a="1" b="0" c="0" d="1" tx="-40" ty="-30"/></matrix>
      <fills>${solidFill(1, '#112233')}${solidFill(2, '#aabbcc')}</fills>
      <edges><Edge fillStyle0="1" fillStyle1="2" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);
    const baseline = await renderScene(`<DOMShape>
      <matrix><Matrix a="1" b="0" c="0" d="1" tx="-40" ty="-30"/></matrix>
      <fills>${solidFill(1, '#112233')}</fills><edges><Edge cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);

    expect(transformed.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!transformed.ok || !baseline.ok) return;
    expect(pathData(transformed.svg)).toBe(pathData(baseline.svg));
    expect(transformed.svg).toContain('transform="matrix(1 0 0 1 -40 -30)"');
  });

  it.each([
    {
      name: 'malformed',
      edgeAttributes: 'fillStyle1="bad"',
      error: 'Malformed Edge fillStyle1 reference',
    },
    {
      name: 'out-of-range',
      edgeAttributes: 'fillStyle1="2"',
      error: 'references missing fillStyle1 2',
    },
  ])('rejects $name style references deterministically', async ({ edgeAttributes, error }) => {
    const shape = `<DOMShape><fills>${solidFill(1, '#112233')}</fills><edges><Edge ${edgeAttributes} cubics="${RECT_CUBICS}"/></edges></DOMShape>`;
    const first = await renderScene(shape);
    const second = await renderScene(shape);

    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.code).toBe('RENDER_FAILED');
      expect(first.message).toContain(error);
    }
  });

  it('fails closed when the bounded style-run budget is exhausted', async () => {
    const changes = 'S1'.repeat(16_385);
    const rendered = await renderScene(`<DOMShape>
      <fills>${solidFill(1, '#112233')}</fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|100 0${changes}"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('BUDGET_EXCEEDED');
      expect(rendered.message).toContain('style-run budget exceeded');
    }
  });
});
