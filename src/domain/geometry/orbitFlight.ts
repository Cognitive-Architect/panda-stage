import { normalizeAngleDeg360 } from './radialBurst';
import type { Point } from './viewportTransform';

export interface OrbitFlightInput {
  readonly referenceLayerIds: readonly string[];
  readonly center?: Point;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly count: number;
  readonly startAngleDeg: number;
  readonly direction: 'clockwise' | 'counterclockwise';
  readonly orientation: 'keep' | 'tangent';
  readonly startFrame: number;
  readonly durationFrames: number;
}

export function unwrapFlightAngle(angle: number, previous: number): number {
  return previous + normalizeAngleDeg360(angle - previous + 180) - 180;
}

export function sampleOrbitFlight(input: OrbitFlightInput, center: Point, index: number) {
  const direction = input.direction === 'clockwise' ? 1 : -1;
  const startAngle = normalizeAngleDeg360(input.startAngleDeg) / 360 + index / input.count;
  let previousAngle: number | undefined;
  return Array.from({ length: input.durationFrames + 1 }, (_, step) => {
    const theta = 2 * Math.PI * (startAngle + direction * step / input.durationFrames);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    // Make mathematically exact depth boundaries stable at all phases.
    const atOrAbove = (threshold: number): boolean => sin >= threshold - 1e-12;
    const band = input.referenceLayerIds.length === 1
      ? Number(atOrAbove(0))
      : Number(atOrAbove(-0.5)) + Number(atOrAbove(0.5));
    let rotationDeg: number | undefined;
    if (input.orientation === 'tangent') {
      const tangent = Math.atan2(direction * input.radiusY * cos, -direction * input.radiusX * sin) * 180 / Math.PI;
      rotationDeg = previousAngle === undefined ? tangent : unwrapFlightAngle(tangent, previousAngle);
      previousAngle = rotationDeg;
    }
    return {
      frame: input.startFrame + step,
      position: { x: center.x + input.radiusX * cos, y: center.y + input.radiusY * sin },
      rotationDeg,
      band,
    };
  });
}
