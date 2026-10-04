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

function shapeWithEdges(fills: string, strokes: string, edgeAttributes: string, edgeData: string): string {
  const fillsXml = fills ? '<fills>' + fills + '</fills>' : '';
  const strokesXml = strokes ? '<strokes>' + strokes + '</strokes>' : '';
  return '<DOMShape>' + fillsXml + strokesXml + '<edges><Edge ' + edgeAttributes +
    ' edges="' + edgeData + '"/></edges></DOMShape>';
}

describe('P2-C01 style-aware Shape reconstruction', () => {
  it('retains and renders a basic solid stroke on a stroke-only Shape', async () => {
    const rendered = await renderScene(`<DOMShape>
      <strokes><StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#202020"/></fill></SolidStroke></StrokeStyle></strokes>
      <edges><Edge strokeStyle="1" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.composition.fillStyleCount).toBe(0);
    expect(rendered.composition.strokeStyleCount).toBe(1);
    expect(rendered.composition.styleRunCount).toBe(1);
    expect(rendered.hasRenderablePath).toBe(true);
    expect(rendered.svg).toContain('fill="none" stroke="#202020"');
    expect(rendered.svg).toContain('stroke-width="2"');
    expect(rendered.svg).toContain('fillStyles=0 strokeStyles=1 styleRuns=1');
  });

  it('treats edge reference zero as no style while retaining positive references', async () => {
    const rendered = await renderScene(`<DOMShape>
      <fills>${solidFill(1, '#112233')}</fills>
      <edges><Edge fillStyle0="0" fillStyle1="1" strokeStyle="0" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.composition.fillStyleCount).toBe(1);
    expect(rendered.composition.styleRunCount).toBe(1);
    expect(rendered.composition.edgeFillStyle0ReferenceCount).toBe(0);
    expect(rendered.composition.edgeFillStyle1ReferenceCount).toBe(1);
    expect(rendered.composition.edgeStrokeStyleReferenceCount).toBe(0);
    expect(rendered.composition.noFillStyle1RunCount).toBe(0);
  });

  it('treats an edge fillStyle1 zero as an empty-fill run without requiring table entry zero', async () => {
    const rendered = await renderScene(`<DOMShape>
      <fills>${solidFill(1, '#112233')}</fills>
      <edges><Edge fillStyle1="0" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.composition.edgeFillStyle1ReferenceCount).toBe(0);
    expect(rendered.composition.noFillStyle1RunCount).toBe(1);
  });

  it('keeps S5 neutral for authored fillStyle0 and strokeStyle ownership', async () => {
    const stroke = '<StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#202020"/></fill></SolidStroke></StrokeStyle>';
    const attributes = 'fillStyle0="1" strokeStyle="1"';
    const plain = await renderScene(shapeWithEdges(solidFill(1, '#112233'), stroke, attributes, RECT_CUBICS));
    const marked = await renderScene(shapeWithEdges(solidFill(1, '#112233'), stroke, attributes, 'S5' + RECT_CUBICS));

    expect(marked.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (!marked.ok || !plain.ok) return;
    expect(marked.svg).toBe(plain.svg);
    expect(marked.composition.edgeFillStyle0ReferenceCount).toBe(1);
    expect(marked.composition.edgeStrokeStyleReferenceCount).toBe(1);
    expect(marked.composition.styleRunCount).toBe(1);
    expect(marked.composition.midEdgeStyleChangeCount).toBe(0);
    expect(marked.composition.pathCommandCount).toBe(plain.composition.pathCommandCount);
  });

  it('keeps S6 neutral for authored fillStyle1 and strokeStyle ownership', async () => {
    const stroke = '<StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#202020"/></fill></SolidStroke></StrokeStyle>';
    const attributes = 'fillStyle1="1" strokeStyle="1"';
    const plain = await renderScene(shapeWithEdges(solidFill(1, '#112233'), stroke, attributes, RECT_CUBICS));
    const marked = await renderScene(shapeWithEdges(solidFill(1, '#112233'), stroke, attributes, 'S6' + RECT_CUBICS));

    expect(marked.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (!marked.ok || !plain.ok) return;
    expect(marked.svg).toBe(plain.svg);
    expect(marked.composition.edgeFillStyle1ReferenceCount).toBe(1);
    expect(marked.composition.edgeStrokeStyleReferenceCount).toBe(1);
    expect(marked.composition.styleRunCount).toBe(1);
    expect(marked.composition.midEdgeStyleChangeCount).toBe(0);
    expect(marked.composition.pathCommandCount).toBe(plain.composition.pathCommandCount);
  });

  it('keeps S4 stroke-only geometry free of invented fills', async () => {
    const stroke = '<StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#202020"/></fill></SolidStroke></StrokeStyle>';
    const attributes = 'strokeStyle="1"';
    const plain = await renderScene(shapeWithEdges('', stroke, attributes, RECT_CUBICS));
    const marked = await renderScene(shapeWithEdges('', stroke, attributes, 'S4' + RECT_CUBICS));

    expect(marked.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (!marked.ok || !plain.ok) return;
    expect(marked.svg).toBe(plain.svg);
    expect(marked.composition.fillStyleCount).toBe(0);
    expect(marked.composition.edgeFillStyle0ReferenceCount).toBe(0);
    expect(marked.composition.edgeFillStyle1ReferenceCount).toBe(0);
    expect(marked.composition.edgeStrokeStyleReferenceCount).toBe(1);
    expect(marked.composition.strokeStyleCount).toBe(1);
    expect(marked.composition.styleRunCount).toBe(1);
    expect(marked.hasRenderablePath).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('treats S%d as a rendering-neutral selection hint', async (mask) => {
    const edgeAttributes = 'fillStyle1="1"';
    const plain = await renderScene(shapeWithEdges(solidFill(1, '#112233'), '', edgeAttributes, RECT_CUBICS));
    const edgeData = '!0 0|100 0S' + mask + '|100 100|0 100|0 0';
    const marked = await renderScene(shapeWithEdges(solidFill(1, '#112233'), '', edgeAttributes, edgeData));

    expect(marked.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (!marked.ok || !plain.ok) return;
    expect(marked.svg).toBe(plain.svg);
    expect(marked.composition.styleRunCount).toBe(1);
    expect(marked.composition.midEdgeStyleChangeCount).toBe(0);
    expect(marked.composition.edgeFillStyle1ReferenceCount).toBe(1);
    expect(marked.composition.pathCommandCount).toBe(plain.composition.pathCommandCount);
  });

  it('rejects S0 deterministically without interpreting it as no fill', async () => {
    const shape = shapeWithEdges(solidFill(1, '#112233'), '', 'fillStyle1="1"', 'S0' + RECT_CUBICS);
    const first = await renderScene(shape);
    const second = await renderScene(shape);

    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.code).toBe('RENDER_FAILED');
      expect(first.message).toContain('Unsupported S0 edge marker');
      expect(first.message).not.toContain('missing fillStyle1 0');
    }
  });

  it.each(['Sx' + RECT_CUBICS, 'S8' + RECT_CUBICS, 'S'])('rejects unsupported or malformed selection marker %s', async (edgeData) => {
    const rendered = await renderScene(shapeWithEdges(solidFill(1, '#112233'), '', 'fillStyle1="1"', edgeData));

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.code).toBe('RENDER_FAILED');
      expect(rendered.message).toMatch(/(Malformed|Unsupported).*selection marker/iu);
    }
  });

  it('keeps negative translated geometry and the existing transform unchanged', async () => {
    const transformed = await renderScene(`<DOMShape>
      <matrix><Matrix a="1" b="0" c="0" d="1" tx="-40" ty="-30"/></matrix>
      <fills>${solidFill(1, '#112233')}</fills>
      <edges><Edge fillStyle1="1" cubics="${RECT_CUBICS}"/></edges>
    </DOMShape>`);
    const baseline = await renderScene(`<DOMShape>
      <matrix><Matrix a="1" b="0" c="0" d="1" tx="-40" ty="-30"/></matrix>
      <fills>${solidFill(1, '#112233')}</fills><edges><Edge fillStyle1="1" cubics="${RECT_CUBICS}"/></edges>
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
    {
      name: 'negative',
      edgeAttributes: 'fillStyle1="-1"',
      error: 'Malformed Edge fillStyle1 reference',
    },
    {
      name: 'unsafe',
      edgeAttributes: 'fillStyle1="9007199254740992"',
      error: 'Malformed Edge fillStyle1 reference',
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

  it('ignores repeated bounded selection markers without consuming style-run budget', async () => {
    const repeatedMarkers = 'S1'.repeat(16_385);
    const edgeAttributes = 'fillStyle1="1"';
    const baseline = await renderScene(shapeWithEdges(solidFill(1, '#112233'), '', edgeAttributes, RECT_CUBICS));
    const marked = await renderScene(shapeWithEdges(solidFill(1, '#112233'), '', edgeAttributes, repeatedMarkers + RECT_CUBICS));

    expect(marked.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!marked.ok || !baseline.ok) return;
    expect(marked.svg).toBe(baseline.svg);
    expect(marked.composition.styleRunCount).toBe(1);
    expect(marked.composition.midEdgeStyleChangeCount).toBe(0);
    expect(marked.composition.pathCommandCount).toBe(baseline.composition.pathCommandCount);
  });
});
