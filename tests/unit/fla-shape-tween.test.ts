import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';

function solidShape(x: number, color: string, controlX = 384): string {
  return '<DOMShape><matrix><Matrix tx="5" ty="3"/></matrix>' +
    '<fills><FillStyle index="1"><SolidColor color="' + color + '"/></FillStyle></fills>' +
    '<edges><Edge fillStyle0="1" edges="!' + x + ' 0|256 0[' + controlX +
    ' 128 256 256|' + x + ' 0"/></edges></DOMShape>';
}

async function buildFixture(unsupportedPair: boolean) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="50" height="50"/>');
  const controlB = unsupportedPair ? 'invalid' : '#2, #0.8';
  const morph = '<MorphShape><morphSegments><MorphSegment ' +
    'startPointA="#FFFFFF.8, 0" startPointB="#0.8, 0" ' +
    'fillIndex1="0" fillIndex2="0" strokeIndex1="0" strokeIndex2="0">' +
    '<MorphCurves anchorPointA="1, 0" anchorPointB="1, 0" isLine="true"/>' +
    '<MorphCurves anchorPointA="1, 1" anchorPointB="1, 1" ' +
    'controlPointA="#1.8, #0.8" controlPointB="' + controlB + '"/>' +
    '<MorphCurves anchorPointA="#FFFFFF.8, 0" anchorPointB="#0.8, 0" isLine="true"/>' +
    '</MorphSegment></morphSegments></MorphShape>';
  zip.file('LIBRARY/shape-tween.xml',
    '<DOMSymbolItem name="shape-tween" symbolType="graphic"><timeline><DOMTimeline><layers>' +
    '<DOMLayer name="mouth"><frames><DOMFrame index="0" duration="4" tweenType="shape">' +
    morph + '<elements>' + solidShape(-128, '#ff0000') + '</elements></DOMFrame>' +
    '<DOMFrame index="4"><elements>' + solidShape(128, '#0000ff', 512) + '</elements></DOMFrame></frames></DOMLayer>' +
    '<DOMLayer name="other"><frames><DOMFrame index="0" duration="2"><elements>' +
    solidShape(0, '#00ff00') + '</elements></DOMFrame><DOMFrame index="2" duration="3"><elements>' +
    solidShape(0, '#ffff00') + '</elements></DOMFrame></frames></DOMLayer>' +
    '</layers></DOMTimeline></timeline></DOMSymbolItem>');
  return renderShapeTween(zip);
}

async function renderShapeTween(zip: JSZip) {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const target: FlaRenderTarget = {
    renderTargetId: 'fla-render-target-shape-tween',
    kind: 'graphic-symbol',
    userLabel: 'Shape Tween',
    sourceLibraryItemName: 'shape-tween',
    frameCount: 5,
    compatibility: [],
  };
  return async (frameIndex: number) => {
    const frame = await buildSvgForRenderTarget(
      bytes, { ...target, selectedFrameIndex: frameIndex }, undefined, prepared.source,
    );
    if (!frame.ok) throw new Error(frame.message);
    return frame.svg;
  };
}

async function renderShapeTweenResult(zip: JSZip) {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const target: FlaRenderTarget = {
    renderTargetId: 'fla-render-target-shape-tween',
    kind: 'graphic-symbol',
    userLabel: 'Shape Tween',
    sourceLibraryItemName: 'shape-tween',
    frameCount: 5,
    compatibility: [],
  };
  return async (frameIndex: number) => {
    const frame = await buildSvgForRenderTarget(
      bytes, { ...target, selectedFrameIndex: frameIndex }, undefined, prepared.source,
    );
    if (!frame.ok) throw new Error(frame.message);
    return frame;
  };
}

const rectangle = (x: number, y: number, size: number, reverse = false) => {
  const points = [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
  return reverse ? points.reverse() : points;
};

async function buildCompoundFixture(variant: 'separate' | 'hole' | 'open' | 'missing-pair' | 'over-budget') {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="200" height="150"/>');
  const hole = variant === 'hole';
  const start = [rectangle(0, 0, 4), rectangle(hole ? 1 : 6, 1, 2, hole)];
  const end = [rectangle(2, 1, 6), rectangle(hole ? 4 : 12, 2, 3, hole)];
  const morph = start.map((contour, index) => {
    const target = end[index]!;
    const pair = (pointA: number[], pointB: number[]) => `anchorPointA="${pointA.join(', ')}" anchorPointB="${pointB.join(', ')}"`;
    const curves = contour.slice(1).map((point, ordinal) => {
      const targetPoint = index === 1 && ordinal === 3 && variant === 'open'
        ? target[1]! : target[ordinal + 1]!;
      const attributes = index === 1 && ordinal === 1 && variant === 'missing-pair'
        ? `anchorPointA="${point.join(', ')}"` : pair(point, targetPoint);
      return `<MorphCurves ${attributes} isLine="true"/>`;
    }).join('');
    const repeated = variant === 'over-budget' ? curves.repeat(1025) : curves;
    return `<MorphSegment startPointA="${contour[0]!.join(', ')}" startPointB="${target[0]!.join(', ')}" ` +
      `fillIndex1="0" fillIndex2="0" strokeIndex1="0" strokeIndex2="0">${repeated}</MorphSegment>`;
  }).join('');
  const shape = (contours: number[][][], color: string, alpha: number) => {
    const edges = contours.map((contour) => '!' + contour
      .map((point) => point.map((coordinate) => coordinate * 256).join(' ')).join('|')).join('');
    return `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}" alpha="${alpha}"/></FillStyle></fills>` +
      `<edges><Edge fillStyle0="1" edges="${edges}"/></edges></DOMShape>`;
  };
  zip.file('LIBRARY/shape-tween.xml',
    '<DOMSymbolItem name="shape-tween" symbolType="graphic"><timeline><DOMTimeline><layers>' +
    '<DOMLayer name="Compound"><frames><DOMFrame index="0" duration="4" tweenType="shape">' +
    '<MorphShape><morphSegments>' + morph + '</morphSegments></MorphShape><elements>' +
    shape(start, '#ff0000', 0.25) + '</elements></DOMFrame><DOMFrame index="4"><elements>' +
    shape(end, '#0000ff', 0.75) + '</elements></DOMFrame></frames></DOMLayer>' +
    '<DOMLayer name="Witness"><frames><DOMFrame index="0" duration="5"><elements>' + solidShape(-128, '#00ff00') +
    '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>');
  return renderShapeTween(zip);
}

describe('FLA Shape Tween display-list sampling', () => {
  it.each(['solid', 'LinearGradient', 'RadialGradient'] as const)('pairs %s endpoints on both sides of an adjacent edge and interpolates its stroke', async (paintKind) => {
    const zip = new JSZip();
    zip.file('DOMDocument.xml', '<DOMDocument width="200" height="150"/>');
    const vertices = [
      [0, 0, 4, 0, 'a'], [4, 0, 4, 4, 'shared'], [4, 4, 0, 4, 'a'], [0, 4, 0, 0, 'a'],
      [4, 0, 8, 0, 'b'], [8, 0, 8, 4, 'b'], [8, 4, 4, 4, 'b'],
    ] as const;
    const shape = (destination: boolean) => {
      const a = destination ? 11 : 2;
      const b = destination ? 17 : 7;
      const s = destination ? 5 : 3;
      const colorA = destination ? '#0000ff' : '#ff0000';
      const alphaA = destination ? 0.75 : 0.25;
      const paint = paintKind === 'solid' ? `<SolidColor color="${colorA}" alpha="${alphaA}"/>`
        : `<${paintKind} spreadMethod="reflect"${paintKind === 'RadialGradient' ? ` focalPointRatio="${destination ? 0.5 : 0}"` : ''}>
          <matrix><Matrix a="${destination ? 2 : 1}" tx="${destination ? 15 : 5}"/></matrix>
          <GradientEntry color="${colorA}" alpha="${alphaA}" ratio="${destination ? 0.5 : 0}"/>
          <GradientEntry color="#ffff00" ratio="1"/>
        </${paintKind}>`;
      const draw = (x: number, y: number) => `${(x + (destination ? 2 : 0)) * 256} ${y * 256}`;
      const edges = vertices.map(([x, y, endX, endY, side]) => {
        const styles = side === 'shared' ? `fillStyle0="${a}" fillStyle1="${b}" strokeStyle="${s}"`
          : `fillStyle0="${side === 'a' ? a : b}"`;
        return `<Edge ${styles} edges="!${draw(x, y)}|${draw(endX, endY)}"/>`;
      });
      return `<DOMShape><fills>
        <FillStyle index="${a}">${paint}</FillStyle>
        <FillStyle index="${b}"><SolidColor color="${destination ? '#00ffff' : '#00ff00'}"/></FillStyle>
        </fills><strokes><StrokeStyle index="${s}"><SolidStroke weight="${destination ? 4 : 2}" caps="round" joints="bevel"><fill>
        <SolidColor color="${destination ? '#ffffff' : '#000000'}"/></fill></SolidStroke></StrokeStyle></strokes>
        <edges>${edges.join('')}</edges></DOMShape>`;
    };
    const segments = vertices.map(([x, y, endX, endY]) => `
      <MorphSegment startPointA="${x}, ${y}" startPointB="${x + 2}, ${y}" fillIndex1="1" fillIndex2="2">
        <MorphCurves anchorPointA="${endX}, ${endY}" anchorPointB="${endX + 2}, ${endY}" isLine="true"/>
      </MorphSegment>`).join('');
    zip.file('LIBRARY/shape-tween.xml', `<DOMSymbolItem name="shape-tween" symbolType="graphic"><timeline><DOMTimeline><layers>
      <DOMLayer><frames><DOMFrame index="0" duration="4" tweenType="shape">
        <MorphShape><morphSegments>${segments}</morphSegments></MorphShape>
        <elements>${shape(false)}</elements></DOMFrame>
        <DOMFrame index="4"><elements>${shape(true)}</elements></DOMFrame></frames></DOMLayer>
      </layers></DOMTimeline></timeline></DOMSymbolItem>`);
    const render = await renderShapeTween(zip);
    const middle = await render(2);
    expect(await render(0)).toContain('stroke-width="2"');
    expect(await render(4)).toContain('stroke-width="4"');
    if (paintKind === 'solid') {
      expect(middle).toContain('fill="#800080" fill-opacity="0.5"');
    } else {
      expect(middle).toContain('spreadMethod="reflect"');
      expect(middle).toContain('offset="0.25" stop-color="#800080" stop-opacity="0.5"');
      expect(middle).toContain('gradientTransform="matrix(1.5 0 0 1 10 0)"');
    }
    expect(middle).toContain('fill="#00ff80"');
    expect(middle).toContain('stroke="#808080" stroke-opacity="1" stroke-width="3"');
    expect(middle).toContain('stroke-linejoin="bevel"');
    expect(middle).toContain('64.0000 51.2000');
  });

  it.each(['separate', 'hole'] as const)('samples both paired contours in one nonzero fill (%s)', async (variant) => {
    const render = await buildCompoundFixture(variant);
    const middle = await render(2);
    const paint = (svg: string, color: string) => svg.match(new RegExp(`<path d="([^"]+)"[^>]*fill="${color}"[^>]*>`, 'u'));
    const start = paint(await render(0), '#ff0000');
    const end = paint(await render(4), '#0000ff');
    const tween = paint(middle, '#800080');
    for (const match of [start, tween, end]) expect(match?.[1]?.match(/M /gu)).toHaveLength(2);
    expect(start?.[0]).toContain('fill-opacity="0.25"');
    expect(tween?.[0]).toContain('fill-opacity="0.5"');
    expect(end?.[0]).toContain('fill-opacity="0.75"');
    expect(tween?.[0]).toContain('fill-rule="nonzero"');
    expect(start?.[1]).toContain('M 51.2000 0.0000 L 0.0000 0.0000');
    expect(end?.[1]).toContain('M 102.4000 12.8000 L 25.6000 12.8000');
    expect(tween?.[1]).toContain('M 76.8000 6.4000 L 12.8000 6.4000');
    expect(tween?.[1]).toContain(variant === 'hole'
      ? 'M 32.0000 51.2000 L 32.0000 19.2000 L 64.0000 19.2000'
      : 'M 147.2000 19.2000 L 115.2000 19.2000 L 115.2000 51.2000');
    expect(await render(2)).toBe(middle);
  });

  it.each(['open', 'missing-pair', 'over-budget'] as const)(
    'holds all authored contours while keeping healthy layers for a %s morph', async (variant) => {
      const render = await buildCompoundFixture(variant);
      const frame = await render(2);
      expect(frame).toContain('fill="#ff0000" fill-opacity="0.25"');
      expect(frame).toContain('fill="#00ff00"');
      expect(await render(4)).toContain('fill="#0000ff" fill-opacity="0.75"');
    },
  );

  it('uses the paired line and quadratic points at the requested time and preserves authored end frames', async () => {
    const render = await buildFixture(false);
    const middle = await render(2);
    expect(await render(0)).toContain('fill="#ff0000"');
    expect(await render(4)).toContain('fill="#0000ff"');
    expect(middle).toContain('fill="#800080"');
    expect(middle).toContain('Q 22.4000 6.4000 12.8000 0.0000');
    expect(middle).toContain('matrix(1 0 0 1 5 3)');
    expect(middle).toContain('fill="#ffff00"');
    expect(await render(1)).toContain('fill="#bf0040"');
    expect(await render(2)).toBe(middle);
  });

  it('holds the authored drawing on an unsupported tween while the other layer advances', async () => {
    const render = await buildFixture(true);
    const middle = await render(2);
    expect(middle).toContain('fill="#ff0000"');
    expect(middle).toContain('fill="#ffff00"');
    expect(await render(4)).toContain('fill="#0000ff"');
  });

  it.each([
    {
      label: 'fill/gradient type mismatch',
      startFill: '<SolidColor color="#ff0000"/>',
      endFill: '<LinearGradient spreadMethod="pad"><matrix><Matrix a="1"/></matrix><GradientEntry color="#0000ff" ratio="0"/><GradientEntry color="#ffff00" ratio="1"/></LinearGradient>',
      startStroke: '',
      endStroke: '',
      expectedReason: 'SolidColor vs LinearGradient',
    },
    {
      label: 'gradient stop count mismatch',
      startFill: '<LinearGradient spreadMethod="pad"><matrix><Matrix a="1"/></matrix><GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#ffff00" ratio="1"/></LinearGradient>',
      endFill: '<LinearGradient spreadMethod="pad"><matrix><Matrix a="1"/></matrix><GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#00ff00" ratio="0.5"/><GradientEntry color="#0000ff" ratio="1"/></LinearGradient>',
      startStroke: '',
      endStroke: '',
      expectedReason: 'gradient stop/parameter mismatch',
    },
    {
      label: 'stroke pairing mismatch',
      startFill: '<SolidColor color="#ff0000"/>',
      endFill: '<SolidColor color="#0000ff"/>',
      startStroke: '<strokes><StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#000000"/></fill></SolidStroke></StrokeStyle></strokes>',
      endStroke: '',
      expectedReason: 'stroke pairing mismatch',
    },
  ])('records local semantic-group and frame-range diagnostics on $label while keeping healthy siblings (E-F05)', async ({
    startFill, endFill, startStroke, endStroke, expectedReason,
  }) => {
    const zip = new JSZip();
    zip.file('DOMDocument.xml', '<DOMDocument width="200" height="150"/>');
    const squareEdges = (dx: number, hasStroke: boolean) => {
      const pts = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] as const;
      return pts.slice(0, -1).map(([x, y], i) => {
        const [ex, ey] = pts[i + 1]!;
        const s = hasStroke ? ' strokeStyle="1"' : '';
        return `<Edge fillStyle0="1"${s} edges="!${(x + dx) * 256} ${y * 256}|${(ex + dx) * 256} ${ey * 256}"/>`;
      }).join('');
    };
    const segments = ([[0, 0, 4, 0], [4, 0, 4, 4], [4, 4, 0, 4], [0, 4, 0, 0]] as const).map(([x, y, ex, ey]) =>
      `<MorphSegment startPointA="${x}, ${y}" startPointB="${x + 2}, ${y}" fillIndex1="1" fillIndex2="0">` +
      `<MorphCurves anchorPointA="${ex}, ${ey}" anchorPointB="${ex + 2}, ${ey}" isLine="true"/></MorphSegment>`,
    ).join('');
    zip.file('LIBRARY/shape-tween.xml', `<DOMSymbolItem name="shape-tween" symbolType="graphic"><timeline><DOMTimeline><layers>
      <DOMLayer name="MismatchedFill"><frames>
        <DOMFrame index="0" duration="4" tweenType="shape">
          <MorphShape><morphSegments>${segments}</morphSegments></MorphShape>
          <elements><DOMShape><fills><FillStyle index="1">${startFill}</FillStyle></fills>${startStroke}<edges>${squareEdges(0, Boolean(startStroke))}</edges></DOMShape></elements>
        </DOMFrame>
        <DOMFrame index="4">
          <elements><DOMShape><fills><FillStyle index="1">${endFill}</FillStyle></fills>${endStroke}<edges>${squareEdges(2, Boolean(endStroke))}</edges></DOMShape></elements>
        </DOMFrame>
      </frames></DOMLayer>
      <DOMLayer name="HealthySibling"><frames>
        <DOMFrame index="0" duration="2"><elements>${solidShape(0, '#00ff00')}</elements></DOMFrame>
        <DOMFrame index="2" duration="3"><elements>${solidShape(0, '#ffff00')}</elements></DOMFrame>
      </frames></DOMLayer>
    </layers></DOMTimeline></timeline></DOMSymbolItem>`);
    const render = await renderShapeTweenResult(zip);
    const frame2 = await render(2);
    // Start-frame drawing retained locally, healthy sibling advanced to #ffff00, and local diagnostic recorded!
    expect(frame2.svg).toContain('#ff0000');
    expect(frame2.svg).toContain('fill="#ffff00"');
    expect(frame2.projectionWarning).toContain('MismatchedFill');
    expect(frame2.projectionWarning).toContain('第 1–4 帧');
    expect(frame2.projectionWarning).toContain(expectedReason);
    // Authored keyframes emit no fallback warning
    expect((await render(0)).projectionWarning).toBeUndefined();
    expect((await render(4)).projectionWarning).toBeUndefined();
  });
});
