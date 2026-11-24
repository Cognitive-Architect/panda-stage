import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildVariableWidthStrokeOutline,
  evaluateVariableWidthProfile,
  type VariableWidthMarker,
} from '../../src/main/services/fla-variable-width-stroke';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

function signedArea(pts: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

function extractContours(commands: readonly { type: string; x?: number; y?: number }[]) {
  const contours: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> | null = null;
  for (const cmd of commands) {
    if (cmd.type === 'M') {
      current = [{ x: cmd.x!, y: cmd.y! }];
      contours.push(current);
    } else if (cmd.type === 'L' && current) {
      current.push({ x: cmd.x!, y: cmd.y! });
    }
  }
  return contours;
}

async function renderSingleShapeFla(shapeXml: string, targetKind: 'scene' | 'graphic-symbol' = 'scene') {
  const zip = new JSZip();
  if (targetKind === 'scene') {
    zip.file(
      'DOMDocument.xml',
      `<DOMDocument width="200" height="160" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`,
    );
  } else {
    zip.file(
      'DOMDocument.xml',
      '<DOMDocument width="200" height="160" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>',
    );
    zip.file(
      'LIBRARY/StrokeGfx.xml',
      `<DOMSymbolItem name="StrokeGfx" symbolType="graphic"><timeline><DOMTimeline name="StrokeGfx"><layers><DOMLayer><frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`,
    );
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
  if (!catalog.ok) throw new Error(catalog.message);
  const entry = catalog.entries.find((e) => e.target.kind === targetKind);
  if (!entry) throw new Error(`Missing ${targetKind} entry`);
  if (!entry.previewSupported) {
    return { ok: false as const, reason: entry.unsupportedReason ?? 'unsupported' };
  }
  const rendered = await buildSvgForRenderTarget(bytes, entry.target, undefined, prepared.source);
  if (!rendered.ok) {
    return { ok: false as const, code: rendered.code, reason: rendered.message };
  }
  return { ok: true as const, svg: rendered.svg };
}

describe('fla-variable-width-stroke geometry (#1260)', () => {
  it('interpolates smooth Hermite and corner width profiles along normalized arc length', () => {
    const smooth: VariableWidthMarker[] = [
      { position: 0, left: 0, right: 0, corner: false },
      { position: 0.5, left: 0.5, right: 1.5, corner: false },
      { position: 1, left: 0, right: 0, corner: false },
    ];
    expect(evaluateVariableWidthProfile(0, smooth, 10)).toEqual({ left: 0, right: 0 });
    expect(evaluateVariableWidthProfile(0.5, smooth, 10)).toEqual({ left: 5, right: 15 });
    expect(evaluateVariableWidthProfile(1, smooth, 10)).toEqual({ left: 0, right: 0 });

    const mid = evaluateVariableWidthProfile(0.25, smooth, 10);
    expect(mid.left).toBeCloseTo(2.5, 4);
    expect(mid.right).toBeCloseTo(7.5, 4);

    const cornerProfile: VariableWidthMarker[] = [
      { position: 0, left: 0, right: 0, corner: true },
      { position: 1, left: 1, right: 1, corner: true },
    ];
    expect(evaluateVariableWidthProfile(0.25, cornerProfile, 10)).toEqual({ left: 2.5, right: 2.5 });
  });

  it('produces tapered tips and asymmetric left/right offsets matching directed path orientation', () => {
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0, right: 0, corner: false },
      { position: 0.5, left: 0.2, right: 1.4, corner: false },
      { position: 1, left: 0, right: 0, corner: false },
    ];
    const result = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 50 }, to: { x: 100, y: 50 }, command: { type: 'L', x: 100, y: 50 } }],
      { weight: 10, markers, cap: 'round', join: 'round', miterLimit: 3, closed: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const contours = extractContours(result.commands);
    expect(contours).toHaveLength(1);
    const pts = contours[0]!;
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    // Traveling +x: left is -y (50 - 2 = 48), right is +y (50 + 14 = 64)
    expect(minY).toBeCloseTo(48, 2);
    expect(maxY).toBeCloseTo(64, 2);
    // Tips at x=0 and x=100 taper to y=50
    const startPts = pts.filter((p) => Math.abs(p.x) < 1e-3);
    expect(startPts.every((p) => Math.abs(p.y - 50) < 1e-3)).toBe(true);
  });

  it('emits opposite-winding inner and outer contours for closed rings so interior stays hollow under nonzero fill', () => {
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 0.8, right: 0.8, corner: false },
      { position: 1, left: 0.2, right: 0.2, corner: false },
    ];
    const result = buildVariableWidthStrokeOutline(
      [
        { from: { x: 20, y: 20 }, to: { x: 100, y: 20 }, command: { type: 'L', x: 100, y: 20 } },
        { from: { x: 100, y: 20 }, to: { x: 100, y: 100 }, command: { type: 'L', x: 100, y: 100 } },
        { from: { x: 100, y: 100 }, to: { x: 20, y: 100 }, command: { type: 'L', x: 20, y: 100 } },
        { from: { x: 20, y: 100 }, to: { x: 20, y: 20 }, command: { type: 'L', x: 20, y: 20 } },
      ],
      { weight: 10, markers, cap: 'round', join: 'round', miterLimit: 3, closed: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const contours = extractContours(result.commands);
    expect(contours).toHaveLength(2);
    const area0 = signedArea(contours[0]!);
    const area1 = signedArea(contours[1]!);
    expect(Math.sign(area0)).toBe(-Math.sign(area1));
    expect(Math.abs(area0)).toBeGreaterThan(1000);
    expect(Math.abs(area1)).toBeGreaterThan(1000);
  });

  it('enforces sample point budgets before excessive allocation', () => {
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0.5, right: 0.5, corner: false },
      { position: 1, left: 0.5, right: 0.5, corner: false },
    ];
    const result = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, command: { type: 'Q', cx: 100, cy: 100, x: 200, y: 0 } }],
      { weight: 8, markers, cap: 'round', join: 'round', miterLimit: 3, closed: false, maxSamplePoints: 4 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BUDGET_EXCEEDED');
  });
});

describe('FLA VariablePointWidth SVG integration (#1260)', () => {
  it('renders solid, curved, and co-existing fill+stroke variable-width strokes as filled outlines while keeping fixed-width strokes unchanged', async () => {
    const shapeXml = `
      <DOMShape>
        <fills>
          <FillStyle index="1"><SolidColor color="#fde68a"/></FillStyle>
        </fills>
        <strokes>
          <StrokeStyle index="1">
            <SolidStroke scaleMode="normal" weight="12" caps="round" joints="round">
              <fill><SolidColor color="#dc2626" alpha="0.8"/></fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0" right="0"/>
                <WidthMarker position="0.5" left="0.3" right="1.2"/>
                <WidthMarker position="1" left="0" right="0"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
          <StrokeStyle index="2">
            <SolidStroke scaleMode="normal" weight="4" caps="round" joints="round">
              <fill><SolidColor color="#1d4ed8"/></fill>
            </SolidStroke>
          </StrokeStyle>
        </strokes>
        <edges>
          <Edge fillStyle1="1" strokeStyle="1" edges="!400 400|1600 400|1600 1200|400 1200|400 400"/>
          <Edge strokeStyle="1" edges="!400 1600[1200 1200 2000 1600"/>
          <Edge strokeStyle="2" edges="!400 2000|2000 2000"/>
        </edges>
      </DOMShape>`;
    const result = await renderSingleShapeFla(shapeXml, 'scene');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Fill region preserved
    expect(result.svg).toContain('fill="#fde68a"');
    // Variable-width strokes emitted as filled outlines with alpha and nonzero fill-rule, no duplicate stroke-width
    expect(result.svg).toContain('fill="#dc2626" fill-opacity="0.8" stroke="none" fill-rule="nonzero"');
    expect(result.svg).not.toContain('stroke="#dc2626"');
    // Fixed-width stroke still emitted via normal centerline stroke path
    expect(result.svg).toContain('fill="none" stroke="#1d4ed8" stroke-opacity="1" stroke-width="4"');
  });

  it('supports radial and explicit-safe linear gradient paint on variable-width strokes and expands graphic content bounds', async () => {
    const shapeXml = `
      <DOMShape>
        <strokes>
          <StrokeStyle index="1">
            <SolidStroke scaleMode="normal" weight="20" caps="round" joints="round" pixelHinting="false">
              <fill>
                <LinearGradient spreadMethod="reflect" interpolationMethod="rgb">
                  <matrix><Matrix a="0.1" b="0" c="0" d="0.1" tx="100" ty="80"/></matrix>
                  <GradientEntry color="#ef4444" alpha="1" ratio="0"/>
                  <GradientEntry color="#3b82f6" alpha="1" ratio="1"/>
                </LinearGradient>
              </fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0" right="0"/>
                <WidthMarker position="0.5" left="0.2" right="2"/>
                <WidthMarker position="1" left="0" right="0"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
          <StrokeStyle index="2">
            <SolidStroke scaleMode="normal" weight="10" caps="round" joints="round">
              <fill>
                <RadialGradient spreadMethod="pad">
                  <matrix><Matrix a="0.1" b="0" c="0" d="0.1" tx="100" ty="120"/></matrix>
                  <GradientEntry color="#10b981" ratio="0"/>
                  <GradientEntry color="#047857" ratio="1"/>
                </RadialGradient>
              </fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0" right="0"/>
                <WidthMarker position="0.5" left="1" right="1"/>
                <WidthMarker position="1" left="0" right="0"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
        </strokes>
        <edges>
          <Edge strokeStyle="1" edges="!200 1000|2200 1000"/>
          <Edge strokeStyle="2" edges="!200 2000|2200 2000"/>
        </edges>
      </DOMShape>`;
    const result = await renderSingleShapeFla(shapeXml, 'graphic-symbol');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.svg).toContain('<linearGradient ');
    expect(result.svg).toContain('<radialGradient ');
    expect(result.svg).toMatch(/fill="url\(#[^"]+\)" fill-opacity="1" stroke="none" fill-rule="nonzero"/u);
    // Stroke 1 is at y=50 with right=2*20=40 -> extends down to y=90; Stroke 2 is at y=100 with right=10 -> extends down to y=110.
    // contentBounds height must cover from <= 46 to >= 110 (>= 64px), proving asymmetric wide side is not clipped.
    const boundsMatch = /contentBounds=([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/u.exec(result.svg);
    expect(boundsMatch).not.toBeNull();
    const minY = Number(boundsMatch![2]);
    const height = Number(boundsMatch![4]);
    expect(minY).toBeLessThanOrEqual(46.5);
    expect(minY + height).toBeGreaterThanOrEqual(109.5);
  });

  it('rejects malformed WidthMarker values and unsupported horizontal variable-width scaleMode locally', async () => {
    const badMarker = await renderSingleShapeFla(`
      <DOMShape>
        <strokes>
          <StrokeStyle index="1">
            <SolidStroke scaleMode="normal" weight="10">
              <fill><SolidColor color="#000000"/></fill>
              <VariablePointWidth>
                <WidthMarker position="1.5" left="0.5" right="0.5"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
        </strokes>
        <edges><Edge strokeStyle="1" edges="!0 0|1000 0"/></edges>
      </DOMShape>`);
    expect(badMarker.ok).toBe(false);

    const horizontalVar = await renderSingleShapeFla(`
      <DOMShape>
        <strokes>
          <StrokeStyle index="1">
            <SolidStroke scaleMode="horizontal" weight="10">
              <fill><SolidColor color="#000000"/></fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0" right="0"/>
                <WidthMarker position="1" left="1" right="1"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
        </strokes>
        <edges><Edge strokeStyle="1" edges="!0 0|1000 0"/></edges>
      </DOMShape>`);
    expect(horizontalVar.ok).toBe(false);
  });
});
