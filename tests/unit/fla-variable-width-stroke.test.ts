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

async function renderSingleShapeFla(
  shapeXml: string,
  targetKind: 'scene' | 'graphic-symbol' = 'scene',
  budgetOverrides?: {
    readonly maxPathCommandsPerShape?: number;
    readonly maxPathCommandsPerComposition?: number;
  },
) {
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
  const rendered = await buildSvgForRenderTarget(
    bytes,
    entry.target,
    undefined,
    prepared.source,
    budgetOverrides,
  );
  if (!rendered.ok) {
    return { ok: false as const, code: rendered.code, reason: rendered.message };
  }
  return { ok: true as const, svg: rendered.svg, composition: rendered.composition };
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

    // Neighborhood-slope cubic Hermite (#1303): end marker at t=0 uses one-sided secant
    // slope (0.5/0.5 = 1 for left, 1.5/0.5 = 3 for right) while interior peak at t=0.5 has
    // zero Catmull-Rom chord slope, yielding 0.3125 * 10 = 3.125 and 0.9375 * 10 = 9.375 at t=0.25.
    const mid = evaluateVariableWidthProfile(0.25, smooth, 10);
    expect(mid.left).toBeCloseTo(3.125, 4);
    expect(mid.right).toBeCloseTo(9.375, 4);

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

  it('samples narrow local WidthMarker peaks on long straight lines instead of skipping them (#1263 P2-01)', () => {
    // 1,000px straight line: uniform 32-step sampling starts at t=0.03125, which would skip a peak at 0.01..0.03
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 0.2, corner: false },
      { position: 0.01, left: 0.2, right: 0.2, corner: false },
      { position: 0.02, left: 0.4, right: 2.0, corner: false },
      { position: 0.03, left: 0.2, right: 0.2, corner: false },
      { position: 1, left: 0.2, right: 0.2, corner: false },
    ];
    const result = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 50 }, to: { x: 1000, y: 50 }, command: { type: 'L', x: 1000, y: 50 } }],
      { weight: 10, markers, cap: 'butt', join: 'round', miterLimit: 3, closed: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pts = extractContours(result.commands)[0]!;
    // At x=20 (t=0.02): left = 4px (y=46), right = 20px (y=70)
    const atPeak = pts.filter((p) => Math.abs(p.x - 20) < 0.5);
    expect(atPeak.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...atPeak.map((p) => p.y))).toBeCloseTo(46, 1);
    expect(Math.max(...atPeak.map((p) => p.y))).toBeCloseTo(70, 1);
    // Flanking markers at x=10 (t=0.01) and x=30 (t=0.03) return to baseline (y=48..52)
    const atLeftFlank = pts.filter((p) => Math.abs(p.x - 10) < 0.5);
    const atRightFlank = pts.filter((p) => Math.abs(p.x - 30) < 0.5);
    expect(Math.max(...atLeftFlank.map((p) => p.y))).toBeCloseTo(52, 1);
    expect(Math.max(...atRightFlank.map((p) => p.y))).toBeCloseTo(52, 1);
  });

  it('inserts markers cleanly on closed-ring closing segments, handles duplicates, and charges marker samples to budget (#1263 P2-01)', () => {
    // 400px square perimeter: side 4 runs from (20, 120) -> (20, 20) over t in [0.75, 1.0].
    // Peak at t=0.975 lands at (20, 30) on the closing segment, traveling -y (left is -x, right is +x).
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 0.2, right: 0.2, corner: false }, // duplicate marker
      { position: 0.96, left: 0.2, right: 0.2, corner: false },
      { position: 0.975, left: 1.5, right: 0.3, corner: false },
      { position: 0.99, left: 0.2, right: 0.2, corner: false },
      { position: 1, left: 0.2, right: 0.2, corner: false },
    ];
    const segs = [
      { from: { x: 20, y: 20 }, to: { x: 120, y: 20 }, command: { type: 'L' as const, x: 120, y: 20 } },
      { from: { x: 120, y: 20 }, to: { x: 120, y: 120 }, command: { type: 'L' as const, x: 120, y: 120 } },
      { from: { x: 120, y: 120 }, to: { x: 20, y: 120 }, command: { type: 'L' as const, x: 20, y: 120 } },
      { from: { x: 20, y: 120 }, to: { x: 20, y: 20 }, command: { type: 'L' as const, x: 20, y: 20 } },
    ];
    const result = buildVariableWidthStrokeOutline(segs, {
      weight: 10,
      markers,
      cap: 'butt',
      join: 'round',
      miterLimit: 3,
      closed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const contours = extractContours(result.commands);
    expect(contours).toHaveLength(2);
    expect(Math.sign(signedArea(contours[0]!))).toBe(-Math.sign(signedArea(contours[1]!)));
    // At y=30 on closing segment: outer left (-x) reaches 20 - 15 = 5, inner right (+x) reaches 20 + 3 = 23
    const outerAtPeak = contours[0]!.filter((p) => Math.abs(p.y - 30) < 0.5);
    const innerAtPeak = contours[1]!.filter((p) => Math.abs(p.y - 30) < 0.5);
    expect(outerAtPeak.length).toBeGreaterThanOrEqual(1);
    expect(innerAtPeak.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...outerAtPeak.map((p) => p.x))).toBeCloseTo(5, 1);
    expect(Math.max(...innerAtPeak.map((p) => p.x))).toBeCloseTo(23, 1);

    // Marker insertion pushes sample count over a tight sample budget -> BUDGET_EXCEEDED
    const denseMarkers: VariableWidthMarker[] = Array.from({ length: 20 }, (_, i) => ({
      position: (i + 1) / 21,
      left: 0.5,
      right: 0.5,
      corner: false,
    }));
    const overBudget = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, command: { type: 'L', x: 10, y: 0 } }],
      { weight: 4, markers: denseMarkers, cap: 'butt', join: 'round', miterLimit: 3, closed: false, maxSamplePoints: 10 },
    );
    expect(overBudget.ok).toBe(false);
    if (!overBudget.ok) expect(overBudget.code).toBe('BUDGET_EXCEEDED');
  });

  it('maintains C1 slope continuity across multi-marker smooth profiles and scales by weight once (#1303)', () => {
    // Collinear multi-marker ramp: neighborhood-slope Hermite reproduces the exact linear ramp
    // without the flat-plateau staircase wobble produced by local smoothstep.
    const ramp: VariableWidthMarker[] = [
      { position: 0, left: 0.1, right: 0.2, corner: false },
      { position: 0.25, left: 0.35, right: 0.7, corner: false },
      { position: 0.75, left: 0.85, right: 1.7, corner: false },
      { position: 1, left: 1.1, right: 2.2, corner: false },
    ];
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      const p10 = evaluateVariableWidthProfile(t, ramp, 10);
      const p20 = evaluateVariableWidthProfile(t, ramp, 20);
      expect(p10.left).toBeCloseTo((0.1 + t) * 10, 4);
      expect(p10.right).toBeCloseTo((0.2 + 2 * t) * 10, 4);
      // Weight is multiplied once: doubling weight doubles output exactly.
      expect(p20.left).toBeCloseTo(p10.left * 2, 4);
      expect(p20.right).toBeCloseTo(p10.right * 2, 4);
    }

    // Interior smooth marker at t=0.4 has matching left and right numerical derivatives (C1).
    const multi: VariableWidthMarker[] = [
      { position: 0, left: 0.1, right: 0.1, corner: false },
      { position: 0.4, left: 0.6, right: 0.9, corner: false },
      { position: 0.8, left: 0.9, right: 0.3, corner: false },
      { position: 1, left: 0.2, right: 0.2, corner: false },
    ];
    const eps = 1e-5;
    const at = evaluateVariableWidthProfile(0.4, multi, 10);
    const before = evaluateVariableWidthProfile(0.4 - eps, multi, 10);
    const after = evaluateVariableWidthProfile(0.4 + eps, multi, 10);
    const dLeftIn = (at.left - before.left) / eps;
    const dLeftOut = (after.left - at.left) / eps;
    const dRightIn = (at.right - before.right) / eps;
    const dRightOut = (after.right - at.right) / eps;
    expect(dLeftIn).toBeCloseTo(dLeftOut, 2);
    expect(dRightIn).toBeCloseTo(dRightOut, 2);
  });

  it('uses one-sided secants at corner markers to preserve crisp width kinks (#1303)', () => {
    const cornerPeak: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 1.0, right: 1.0, corner: true },
      { position: 1, left: 0.2, right: 0.2, corner: false },
    ];
    const eps = 1e-5;
    const at = evaluateVariableWidthProfile(0.5, cornerPeak, 10);
    const before = evaluateVariableWidthProfile(0.5 - eps, cornerPeak, 10);
    const after = evaluateVariableWidthProfile(0.5 + eps, cornerPeak, 10);
    const dIn = (at.left - before.left) / eps;
    const dOut = (after.left - at.left) / eps;
    // Incoming slope = (1.0 - 0.2) / 0.5 * 10 = +16; outgoing slope = (0.2 - 1.0) / 0.5 * 10 = -16
    expect(dIn).toBeCloseTo(16, 1);
    expect(dOut).toBeCloseTo(-16, 1);
    // Linear on each half because both endpoints and the corner use the span secant
    expect(evaluateVariableWidthProfile(0.25, cornerPeak, 10).left).toBeCloseTo(6, 4);
    expect(evaluateVariableWidthProfile(0.75, cornerPeak, 10).left).toBeCloseTo(6, 4);
  });

  it('handles zero-width, non-negative clamping, coincident markers, and short strokes safely (#1303)', () => {
    // Zero weight -> zero profile everywhere
    const markers: VariableWidthMarker[] = [
      { position: 0, left: 0.5, right: 1.5, corner: false },
      { position: 1, left: 0.5, right: 1.5, corner: false },
    ];
    expect(evaluateVariableWidthProfile(0.5, markers, 0)).toEqual({ left: 0, right: 0 });

    // Non-negative clamp prevents negative widths when Catmull-Rom undershoots a low baseline
    const steepUndershoot: VariableWidthMarker[] = [
      { position: 0, left: 0.05, right: 0.05, corner: false },
      { position: 0.05, left: 2.0, right: 2.0, corner: false },
      { position: 0.1, left: 0.05, right: 0.05, corner: false },
      { position: 1, left: 0.05, right: 0.05, corner: false },
    ];
    for (let i = 0; i <= 50; i += 1) {
      const p = evaluateVariableWidthProfile(i / 50, steepUndershoot, 10);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.right).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.left)).toBe(true);
      expect(Number.isFinite(p.right)).toBe(true);
    }

    // Coincident markers (duplicate & step jump at position=0.5) never produce NaN/Infinity
    const coincident: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 0.2, right: 0.2, corner: false },
      { position: 0.5, left: 1.0, right: 0.4, corner: false },
      { position: 1, left: 1.0, right: 0.4, corner: false },
    ];
    for (const t of [0, 0.25, 0.499, 0.5, 0.501, 0.75, 1]) {
      const p = evaluateVariableWidthProfile(t, coincident, 10);
      expect(Number.isFinite(p.left)).toBe(true);
      expect(Number.isFinite(p.right)).toBe(true);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.right).toBeGreaterThanOrEqual(0);
    }
    expect(evaluateVariableWidthProfile(0.5, coincident, 10)).toEqual({ left: 10, right: 4 });

    // All-zero markers outline remains finite and valid
    const zeroWidthOutline = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 0 }, to: { x: 40, y: 0 }, command: { type: 'L', x: 40, y: 0 } }],
      {
        weight: 10,
        markers: [
          { position: 0, left: 0, right: 0, corner: false },
          { position: 1, left: 0, right: 0, corner: false },
        ],
        cap: 'round',
        join: 'round',
        miterLimit: 3,
        closed: false,
      },
    );
    expect(zeroWidthOutline.ok).toBe(true);

    // Short stroke (0.5px) and degenerate zero-length stroke
    const shortStroke = buildVariableWidthStrokeOutline(
      [{ from: { x: 10, y: 10 }, to: { x: 10.5, y: 10 }, command: { type: 'L', x: 10.5, y: 10 } }],
      { weight: 10, markers, cap: 'round', join: 'round', miterLimit: 3, closed: false },
    );
    expect(shortStroke.ok).toBe(true);
    if (shortStroke.ok) expect(shortStroke.commands.length).toBeGreaterThan(3);

    const zeroLenStroke = buildVariableWidthStrokeOutline(
      [{ from: { x: 10, y: 10 }, to: { x: 10, y: 10 }, command: { type: 'L', x: 10, y: 10 } }],
      { weight: 10, markers, cap: 'round', join: 'round', miterLimit: 3, closed: false },
    );
    expect(zeroLenStroke.ok).toBe(true);
    if (zeroLenStroke.ok) expect(zeroLenStroke.commands).toEqual([]);
  });

  it('anchors asymmetric round caps at original path endpoints with per-side quarter-ellipses (#1303)', () => {
    // Traveling +x from (0, 50) to (100, 50): left is -y (2px), right is +y (14px), avg forward = 8px.
    const asymMarkers: VariableWidthMarker[] = [
      { position: 0, left: 0.2, right: 1.4, corner: false },
      { position: 1, left: 0.2, right: 1.4, corner: false },
    ];
    const result = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 50 }, to: { x: 100, y: 50 }, command: { type: 'L', x: 100, y: 50 } }],
      { weight: 10, markers: asymMarkers, cap: 'round', join: 'round', miterLimit: 3, closed: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pts = extractContours(result.commands)[0]!;

    // End cap apex lies on the original centerline y=50 at x = 100 + (2 + 14) / 2 = 108
    // (old midpoint-semicircle shifted the apex off-centerline to y=56).
    const maxX = Math.max(...pts.map((p) => p.x));
    const endApex = pts.find((p) => Math.abs(p.x - maxX) < 1e-3)!;
    expect(endApex.x).toBeCloseTo(108, 3);
    expect(endApex.y).toBeCloseTo(50, 3);

    // Start cap apex lies on the original centerline y=50 at x = 0 - 8 = -8.
    const minX = Math.min(...pts.map((p) => p.x));
    const startApex = pts.find((p) => Math.abs(p.x - minX) < 1e-3)!;
    expect(startApex.x).toBeCloseTo(-8, 3);
    expect(startApex.y).toBeCloseTo(50, 3);

    // Quarter-ellipse on the narrow left side (-y) never bulges beyond y = 50 - 2 = 48,
    // and wide right side (+y) reaches y = 50 + 14 = 64.
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(48, 3);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(64, 3);

    // One-sided zero-width cap (left=0, right=16): no bulge past y=50 on the zero side, apex at (108, 50).
    const oneSided = buildVariableWidthStrokeOutline(
      [{ from: { x: 0, y: 50 }, to: { x: 100, y: 50 }, command: { type: 'L', x: 100, y: 50 } }],
      {
        weight: 10,
        markers: [
          { position: 0, left: 0, right: 1.6, corner: false },
          { position: 1, left: 0, right: 1.6, corner: false },
        ],
        cap: 'round',
        join: 'round',
        miterLimit: 3,
        closed: false,
      },
    );
    expect(oneSided.ok).toBe(true);
    if (!oneSided.ok) return;
    const oneSidedPts = extractContours(oneSided.commands)[0]!;
    expect(Math.min(...oneSidedPts.map((p) => p.y))).toBeCloseTo(50, 3);
    expect(Math.max(...oneSidedPts.map((p) => p.x))).toBeCloseTo(108, 3);
    const oneSidedEndApex = oneSidedPts.find((p) => Math.abs(p.x - 108) < 1e-3)!;
    expect(oneSidedEndApex.y).toBeCloseTo(50, 3);
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

  it('enforces cumulative shape and composition path-command budgets across subpaths, styles, and the final shape (#1263 P2-02)', async () => {
    const multiStrokeShape = (yOffsetTwips: number) => `
      <DOMShape>
        <strokes>
          <StrokeStyle index="1">
            <SolidStroke scaleMode="normal" weight="8" caps="butt" joints="round">
              <fill><SolidColor color="#dc2626"/></fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0" right="0"/>
                <WidthMarker position="0.5" left="0.8" right="0.8"/>
                <WidthMarker position="1" left="0" right="0"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
          <StrokeStyle index="2">
            <SolidStroke scaleMode="normal" weight="6" caps="butt" joints="round">
              <fill><SolidColor color="#2563eb"/></fill>
              <VariablePointWidth>
                <WidthMarker position="0" left="0.2" right="0.2"/>
                <WidthMarker position="0.5" left="1.0" right="1.0"/>
                <WidthMarker position="1" left="0.2" right="0.2"/>
              </VariablePointWidth>
            </SolidStroke>
          </StrokeStyle>
        </strokes>
        <edges>
          <Edge strokeStyle="1" edges="!200 ${yOffsetTwips}|2200 ${yOffsetTwips}"/>
          <Edge strokeStyle="1" edges="!200 ${yOffsetTwips + 200}|2200 ${yOffsetTwips + 200}"/>
          <Edge strokeStyle="2" edges="!200 ${yOffsetTwips + 400}|2200 ${yOffsetTwips + 400}"/>
        </edges>
      </DOMShape>`;

    // Single shape with 3 subpaths across 2 variable-width styles: exact budget passes, exact-1 fails with BUDGET_EXCEEDED
    const baselineSingle = await renderSingleShapeFla(multiStrokeShape(400), 'scene');
    expect(baselineSingle.ok).toBe(true);
    if (!baselineSingle.ok) return;
    const singleCommands = baselineSingle.composition.pathCommandCount;
    expect(singleCommands).toBeGreaterThan(20);

    const exactSingle = await renderSingleShapeFla(multiStrokeShape(400), 'scene', {
      maxPathCommandsPerShape: singleCommands,
    });
    expect(exactSingle.ok).toBe(true);

    const overSingle = await renderSingleShapeFla(multiStrokeShape(400), 'scene', {
      maxPathCommandsPerShape: singleCommands - 1,
    });
    expect(overSingle.ok).toBe(false);
    if (!overSingle.ok) expect(overSingle.code).toBe('BUDGET_EXCEEDED');

    // Two shapes in one composition: each fits maxPathCommandsPerShape, but the 2nd (final) shape overflows composition budget
    const twoShapes = multiStrokeShape(200) + multiStrokeShape(1200);
    const baselineTwo = await renderSingleShapeFla(twoShapes, 'scene');
    expect(baselineTwo.ok).toBe(true);
    if (!baselineTwo.ok) return;
    const totalCommands = baselineTwo.composition.pathCommandCount;
    expect(totalCommands).toBe(singleCommands * 2);

    const exactComposition = await renderSingleShapeFla(twoShapes, 'scene', {
      maxPathCommandsPerShape: singleCommands,
      maxPathCommandsPerComposition: totalCommands,
    });
    expect(exactComposition.ok).toBe(true);

    const overCompositionLastShape = await renderSingleShapeFla(twoShapes, 'scene', {
      maxPathCommandsPerShape: singleCommands,
      maxPathCommandsPerComposition: totalCommands - 1,
    });
    expect(overCompositionLastShape.ok).toBe(false);
    if (!overCompositionLastShape.ok) expect(overCompositionLastShape.code).toBe('BUDGET_EXCEEDED');
  });
});
