export interface ArmPoint {
  x: number;
  y: number;
}

export interface ArmJointLimit {
  minDeg: number;
  maxDeg: number;
}

export interface RigidArmSolution {
  joints: ArmPoint[];
  /** Cumulative rotation relative to each segment's original direction. */
  rotationsDeg: number[];
  /** Relative angles can be reused as the seed on the next pointer event. */
  jointAnglesDeg: number[];
  distance: number;
}

const TO_RAD = Math.PI / 180;
const TO_DEG = 1 / TO_RAD;

/** Solve a two- or three-segment chain in its owner's local coordinates. */
export function solveRigidArm(rest: readonly ArmPoint[], target: ArmPoint, limits: readonly ArmJointLimit[],
  seed: readonly number[] = []): RigidArmSolution {
  const count = rest.length - 1;
  if (count < 2 || count > 3 || limits.length !== count ||
    ![...rest, target].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) ||
    limits.some(({ minDeg, maxDeg }) => !Number.isFinite(minDeg) || !Number.isFinite(maxDeg) || minDeg > maxDeg) ||
    seed.some(value => !Number.isFinite(value))) throw new Error('Invalid rigid arm configuration.');
  const segments = rest.slice(1).map(({ x, y }, index) => ({ x: x - rest[index]!.x, y: y - rest[index]!.y }));
  if (segments.some(({ x, y }) => Math.hypot(x, y) < 0.001)) throw new Error('Arm joints must be distinct.');
  const clamp = (angle: number, index: number) => Math.min(limits[index]!.maxDeg, Math.max(limits[index]!.minDeg, angle));

  function forward(angles: number[]): RigidArmSolution {
    const joints = [{ ...rest[0]! }];
    const rotationsDeg: number[] = [];
    let rotation = 0;
    segments.forEach((segment, index) => {
      rotation += angles[index]!;
      rotationsDeg.push(rotation);
      const radians = rotation * TO_RAD;
      const x = segment.x * Math.cos(radians) - segment.y * Math.sin(radians);
      const y = segment.x * Math.sin(radians) + segment.y * Math.cos(radians);
      joints.push({ x: joints[index]!.x + x, y: joints[index]!.y + y });
    });
    const end = joints[count]!;
    return { joints, rotationsDeg, jointAnglesDeg: [...angles], distance: Math.hypot(target.x - end.x, target.y - end.y) };
  }

  const initial = segments.map((_, index) => clamp(seed[index] ?? 0, index));
  const candidates = [initial];
  if (count === 2) {
    const start = rest[0]!;
    const [upper, lower] = segments as [ArmPoint, ArmPoint];
    const firstLength = Math.hypot(upper.x, upper.y);
    const lastLength = Math.hypot(lower.x, lower.y);
    const radius = Math.hypot(target.x - start.x, target.y - start.y);
    const direction = Math.atan2(target.y - start.y, target.x - start.x);
    const cosine = (radius ** 2 - firstLength ** 2 - lastLength ** 2) / (2 * firstLength * lastLength);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
    const restUpper = Math.atan2(upper.y, upper.x);
    const restLower = Math.atan2(lower.y, lower.x);
    function equivalentNearSeed(radians: number, index: number): number {
      const degrees = radians * TO_DEG;
      return clamp(degrees + 360 * Math.round((initial[index]! - degrees) / 360), index);
    }
    const analytic = [angle, -angle].map(elbow => {
      const shoulder = direction - Math.atan2(lastLength * Math.sin(elbow), firstLength + lastLength * Math.cos(elbow));
      return [equivalentNearSeed(shoulder - restUpper, 0), equivalentNearSeed(elbow - (restLower - restUpper), 1)];
    });
    const distanceFromSeed = (angles: number[]) => Math.hypot(angles[0]! - initial[0]!, angles[1]! - initial[1]!);
    candidates.push(...analytic.sort((left, right) => distanceFromSeed(left) - distanceFromSeed(right)));
  }
  let best = forward(initial);
  // Two alternate bends avoid a straight chain stalling when pulled along its axis.
  for (const bend of [24, -24]) {
    const bent = [...initial];
    bent[1] = clamp(bent[1]! + bend, 1);
    candidates.push(bent);
  }
  for (const candidate of candidates) {
    const angles = [...candidate];
    let state = forward(angles);
    for (let iteration = 0; iteration < 64 && state.distance > 0.025; iteration++) {
      let moved = false;
      for (let index = count - 1; index >= 0; index--) {
        const joint = state.joints[index]!;
        const end = state.joints[count]!;
        const fromX = end.x - joint.x;
        const fromY = end.y - joint.y;
        const toX = target.x - joint.x;
        const toY = target.y - joint.y;
        const correction = Math.atan2(fromX * toY - fromY * toX, fromX * toX + fromY * toY) * TO_DEG;
        const next = clamp(angles[index]! + correction, index);
        if (Math.abs(next - angles[index]!) < 0.00001) continue;
        angles[index] = next;
        moved = true;
        state = forward(angles);
      }
      if (!moved) break;
    }
    if (state.distance < best.distance - 0.025) best = state;
    if (best.distance <= 0.025) break;
  }
  return best;
}
