import {
  buildCubicBezierArcLengthTable,
  evaluateCubicBezier2D,
  evaluateCubicBezierDerivative2D,
  MIN_CURVE_ARC_LENGTH,
  solveCubicBezierParameterAtArcFraction,
  type CubicBezier2D,
} from './cubicBezierPath';
import { unwrapFlightAngle } from './orbitFlight';
import type { Point } from './viewportTransform';

export interface ConvergingFlightInput {
  readonly count: number;
  readonly target?: Point;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly bend: number;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly staggerFrames: number;
  readonly seed: number;
  readonly orientation: 'keep' | 'tangent';
  readonly hideAfterArrival: boolean;
}

export function sampleConvergingFlight(input: ConvergingFlightInput, target: Point, origin: Point, randomBend: number, launchFrame: number) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(chord) || chord <= MIN_CURVE_ARC_LENGTH) throw new Error('飞行路径过短或无效，请调整分布半径。');
  const bend = input.bend * (2 * randomBend - 1);
  const normal = { x: -dy / chord * bend, y: dx / chord * bend };
  const curve: CubicBezier2D = {
    p0: origin,
    p1: { x: origin.x + dx / 3 + normal.x, y: origin.y + dy / 3 + normal.y },
    p2: { x: origin.x + dx * (2 / 3) + normal.x, y: origin.y + dy * (2 / 3) + normal.y },
    p3: target,
  };
  const table = buildCubicBezierArcLengthTable(curve);
  if (!Number.isFinite(table.totalLength) || table.totalLength <= MIN_CURVE_ARC_LENGTH) {
    throw new Error('无法计算曲线长度，请减小分布半径或弯曲幅度。');
  }
  let previousAngle: number | undefined;
  return Array.from({ length: input.durationFrames + 1 }, (_, step) => {
    const t = solveCubicBezierParameterAtArcFraction(table, step / input.durationFrames);
    let rotationDeg: number | undefined;
    if (input.orientation === 'tangent') {
      const tangent = evaluateCubicBezierDerivative2D(curve, t);
      if (!Number.isFinite(Math.hypot(tangent.x, tangent.y)) || Math.hypot(tangent.x, tangent.y) <= MIN_CURVE_ARC_LENGTH) {
        throw new Error('无法计算飞行朝向，请调整分布半径或弯曲幅度。');
      }
      const angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
      rotationDeg = previousAngle === undefined ? angle : unwrapFlightAngle(angle, previousAngle);
      previousAngle = rotationDeg;
    }
    return { frame: launchFrame + step, position: evaluateCubicBezier2D(curve, t), rotationDeg };
  });
}
