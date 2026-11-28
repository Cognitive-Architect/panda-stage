import { describe, expect, it } from 'vitest';
import { interpolateShapeMorphPair, prepareShapeMorphPair } from '../../../src/domain/geometry/shapeMorph';
import type {
  FlaVectorContour,
  FlaVectorPathCommand,
} from '../../../src/domain/fla-shape-vector';

interface Point {
  readonly x: number;
  readonly y: number;
}

function polygonContour(points: readonly Point[]): FlaVectorContour {
  const commands: FlaVectorPathCommand[] = [
    { type: 'M', x: points[0]!.x, y: points[0]!.y },
  ];
  for (const point of points.slice(1)) commands.push({ type: 'L', x: point.x, y: point.y });
  commands.push({ type: 'Z' });
  return { closed: true, commands };
}

/** Circle as four cubic arcs (kappa approximation). */
function circleContour(cx: number, cy: number, radius: number): FlaVectorContour {
  const k = 0.5522847498307936;
  const r = radius;
  return {
    closed: true,
    commands: [
      { type: 'M', x: cx + r, y: cy },
      {
        type: 'C',
        c1x: cx + r,
        c1y: cy + k * r,
        c2x: cx + k * r,
        c2y: cy + r,
        x: cx,
        y: cy + r,
      },
      {
        type: 'C',
        c1x: cx - k * r,
        c1y: cy + r,
        c2x: cx - r,
        c2y: cy + k * r,
        x: cx - r,
        y: cy,
      },
      {
        type: 'C',
        c1x: cx - r,
        c1y: cy - k * r,
        c2x: cx - k * r,
        c2y: cy - r,
        x: cx,
        y: cy - r,
      },
      {
        type: 'C',
        c1x: cx + k * r,
        c1y: cy - r,
        c2x: cx + r,
        c2y: cy - k * r,
        x: cx + r,
        y: cy,
      },
      { type: 'Z' },
    ],
  };
}

/** A wide, flat-mouthed almond: two quadratic arcs joined by two line corners. */
function flatMouthContour(): FlaVectorContour {
  return {
    closed: true,
    commands: [
      { type: 'M', x: 0, y: 50 },
      { type: 'Q', cx: 150, cy: -30, x: 300, y: 50 },
      { type: 'L', x: 250, y: 70 },
      { type: 'Q', cx: 150, cy: 20, x: 50, y: 70 },
      { type: 'Z' },
    ],
  };
}

/** Outer square + enclosed hole: first-ticket unsupported topology. */
function squareWithHole(): readonly FlaVectorContour[] {
  return [
    polygonContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]),
    polygonContour([
      { x: 25, y: 25 },
      { x: 25, y: 75 },
      { x: 75, y: 75 },
      { x: 75, y: 25 },
    ]),
  ];
}

function sampleCubic(
  from: Point,
  segment: { c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number },
  t: number,
): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * from.x +
      3 * u * u * t * segment.c1x +
      3 * u * t * t * segment.c2x +
      t * t * t * segment.x,
    y:
      u * u * u * from.y +
      3 * u * u * t * segment.c1y +
      3 * u * t * t * segment.c2y +
      t * t * t * segment.y,
  };
}

function flattenContour(contour: FlaVectorContour, steps = 48): Point[] {
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const command of contour.commands) {
    if (command.type === 'M' || command.type === 'L') {
      points.push({ x: command.x, y: command.y });
      cursor = { x: command.x, y: command.y };
    } else if (command.type === 'Q') {
      for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;
        points.push({
          x: u * u * cursor.x + 2 * u * t * command.cx + t * t * command.x,
          y: u * u * cursor.y + 2 * u * t * command.cy + t * t * command.y,
        });
      }
      cursor = { x: command.x, y: command.y };
    } else if (command.type === 'C') {
      for (let index = 1; index <= steps; index += 1) {
        points.push(sampleCubic(cursor, command, index / steps));
      }
      cursor = { x: command.x, y: command.y };
    }
  }
  return points;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function bounds(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

describe('shapeMorph geometry', () => {
  it('prepares a deterministic, segment-aligned pair and reproduces both authored endpoints', () => {
    const from = polygonContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const to = circleContour(200, 200, 60);
    const prepared = prepareShapeMorphPair({ contours: [from] }, { contours: [to] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.pair.contourCount).toBe(1);
    expect(prepared.pair.from[0]!.segments.length).toBe(prepared.pair.to[0]!.segments.length);
    expect(prepared.pair.segmentCount).toBeGreaterThanOrEqual(4);

    const atStart = interpolateShapeMorphPair(prepared.pair, 0);
    const atEnd = interpolateShapeMorphPair(prepared.pair, 1);
    expect(atStart).not.toBeNull();
    expect(atEnd).not.toBeNull();
    const startBounds = bounds(flattenContour(atStart!.contours[0]!));
    expect(startBounds.minX).toBeCloseTo(0, 6);
    expect(startBounds.maxX).toBeCloseTo(100, 6);
    expect(Math.abs(signedArea(flattenContour(atStart!.contours[0]!)))).toBeCloseTo(10_000, 0);
    const endPoints = flattenContour(atEnd!.contours[0]!);
    expect(Math.abs(signedArea(endPoints))).toBeCloseTo(Math.PI * 60 * 60, -1);
    // Cubic-only normalization, still a single closed contour in the repo representation.
    expect(atStart!.contours).toHaveLength(1);
    expect(atStart!.contours[0]!.closed).toBe(true);
    expect(atStart!.contours[0]!.commands[0]!.type).toBe('M');
    expect(atStart!.contours[0]!.commands.at(-1)!.type).toBe('Z');
  });

  it('keeps a circle to flat-mouth tween non-degenerate at t=0.5', () => {
    const from = circleContour(150, 100, 80);
    const to = flatMouthContour();
    const prepared = prepareShapeMorphPair({ contours: [from] }, { contours: [to] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const middle = interpolateShapeMorphPair(prepared.pair, 0.5);
    expect(middle).not.toBeNull();
    const points = flattenContour(middle!.contours[0]!);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(Math.abs(signedArea(points))).toBeGreaterThan(500);
    const middleBounds = bounds(points);
    expect(middleBounds.maxX - middleBounds.minX).toBeGreaterThan(100);
    expect(middleBounds.maxY - middleBounds.minY).toBeGreaterThan(20);
  });

  it('subdivides mismatched segment counts (line-only vs cubic) before interpolating', () => {
    const triangle = polygonContour([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 60, y: 100 },
    ]);
    const circle = circleContour(60, 50, 50);
    const prepared = prepareShapeMorphPair({ contours: [triangle] }, { contours: [circle] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.pair.segmentCount).toBeGreaterThanOrEqual(4);
    const middle = interpolateShapeMorphPair(prepared.pair, 0.5);
    expect(middle).not.toBeNull();
    const contour = middle!.contours[0]!;
    const cubicCommands = contour.commands.filter((command) => command.type === 'C');
    expect(cubicCommands).toHaveLength(prepared.pair.segmentCount);
    expect(contour.commands[0]!.type).toBe('M');
    expect(contour.commands.at(-1)!.type).toBe('Z');
    const points = flattenContour(contour);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(Math.abs(signedArea(points))).toBeGreaterThan(100);
  });

  it('reverses opposite winding and rotates a shifted start vertex without flipping', () => {
    const clockwise = polygonContour([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    // Same square, counter-clockwise, starting at the opposite corner.
    const counterClockwise = polygonContour([
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ]);
    const prepared = prepareShapeMorphPair(
      { contours: [clockwise] },
      { contours: [counterClockwise] },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const fromArea = signedArea(flattenContour(clockwise));
    const toArea = signedArea(flattenContour(counterClockwise));
    expect(Math.sign(fromArea)).not.toBe(Math.sign(toArea));
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const middle = interpolateShapeMorphPair(prepared.pair, progress);
      expect(middle).not.toBeNull();
      const points = flattenContour(middle!.contours[0]!);
      // Both windings are aligned before interpolation, so no progress frame twists to a bow tie.
      expect(Math.sign(signedArea(points))).toBe(Math.sign(fromArea));
      expect(Math.abs(signedArea(points))).toBeCloseTo(100, 0);
      const middleBounds = bounds(points);
      expect(middleBounds.minX).toBeCloseTo(0, 4);
      expect(middleBounds.maxX).toBeCloseTo(10, 4);
      expect(middleBounds.minY).toBeCloseTo(0, 4);
      expect(middleBounds.maxY).toBeCloseTo(10, 4);
    }
  });

  it('reports holes / multi-contour topology as a typed unsupported failure', () => {
    const [outer, hole] = squareWithHole();
    const target = polygonContour([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 80 },
    ]);
    const withHole = prepareShapeMorphPair(
      { contours: [outer!, hole!] },
      { contours: [target] },
    );
    expect(withHole.ok).toBe(false);
    if (withHole.ok) return;
    expect(withHole.code).toBe('unsupported-topology');

    const open = prepareShapeMorphPair(
      { contours: [{ closed: false, commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }] }] },
      { contours: [target] },
    );
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.code).toBe('open-contour');
  });

  it('is deterministic for the same input and supports future multi-contour pairing', () => {
    const from = circleContour(0, 0, 50);
    const to = flatMouthContour();
    const first = prepareShapeMorphPair({ contours: [from] }, { contours: [to] });
    const second = prepareShapeMorphPair({ contours: [from] }, { contours: [to] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(interpolateShapeMorphPair(first.pair, 0.5))).toBe(
      JSON.stringify(interpolateShapeMorphPair(second.pair, 0.5)),
    );

    const extraSquare = polygonContour([
      { x: 400, y: 0 },
      { x: 440, y: 0 },
      { x: 440, y: 40 },
      { x: 400, y: 40 },
    ]);
    const multi = prepareShapeMorphPair(
      { contours: [from] },
      { contours: [to, extraSquare] },
      { allowMultipleContours: true },
    );
    expect(multi.ok).toBe(true);
    if (!multi.ok) return;
    expect(multi.pair.contourCount).toBe(2);
    // The absent counterpart grows from a degenerate point: at t=0 it has (near) zero area.
    const start = interpolateShapeMorphPair(multi.pair, 0);
    expect(start!.contours).toHaveLength(2);
    expect(Math.abs(signedArea(flattenContour(start!.contours[1]!)))).toBeLessThan(1e-3);
  });
});
