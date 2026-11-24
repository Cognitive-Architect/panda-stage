import type { FlaDisplayListMatrix, FlaDisplayListRgbTransform } from './fla-display-list-resolver';

interface MotionXmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | undefined>>;
  readonly xml: string;
}

type Children = (xml: string, parent: string) => readonly MotionXmlNode[];
type MotionResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };
interface Key {
  readonly time: number;
  readonly value: number;
  readonly previous: readonly [number, number];
  readonly next: readonly [number, number];
}
interface Curve {
  readonly keys: readonly Key[];
  readonly ease: (unitTime: number) => number;
}
interface AnimationCore {
  readonly timeScale: number;
  readonly curves: ReadonlyMap<string, Curve>;
}
export interface ObjectMotionPose {
  readonly matrix: FlaDisplayListMatrix;
  readonly alphaMultiplier?: number;
  readonly rgbTransform?: FlaDisplayListRgbTransform;
  readonly shadowDistances?: readonly (number | undefined)[];
}

const supportedProperties = new Set([
  'Motion_X', 'Motion_Y', 'Rotation_Z', 'Skew_X', 'Skew_Y', 'Scale_X', 'Scale_Y',
  'Alpha_Amount', 'Brightness_Amount', 'Tint_Amount', 'Tint_Color',
]);
const degrees = Math.PI / 180;
const powers = new Map([['Quadratic', 2], ['Cubic', 3], ['Quartic', 4], ['Quintic', 5]]);
const linear = (time: number): number => time;
const invalid = <T>(detail: string): MotionResult<T> =>
  ({ ok: false, message: '此帧的对象补间无法还原（' + detail + '）' });

function number(raw: string | undefined): number {
  return raw?.trim() ? Number(raw) : Number.NaN;
}

function pair(raw: string | undefined): [number, number] | undefined {
  const parts = raw?.split(',');
  if (parts?.length !== 2) return undefined;
  const x = number(parts[0]);
  const y = number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

// Standard Motion Editor power, bounce, and spring presets. Timing data and
// curve conventions are cross-checked against lifeart/fla-viewer
// src/motion-object.ts @ b14fa1d1 (PSM AnimationUtility public semantics).
function bounceArc(count: number, firstArc: number, ratio: number): { readonly arc: number; readonly local: number } {
  let arc = 0;
  let start = 0;
  let end = firstArc;
  while (end < ratio && arc < count - 1) {
    arc += 1;
    start = end;
    end += firstArc / (arc + 1);
  }
  return { arc, local: (ratio - start) / (firstArc / (arc + 1)) };
}

function createBounceEase(count: number, positive: boolean, bounceIn: boolean): Curve['ease'] {
  let harmonic = 0;
  for (let i = 1; i <= count; i += 1) harmonic += 1 / i;
  const firstArc = 1 / harmonic;
  const evaluate = (ratio: number): number => {
    const { arc, local } = bounceArc(count, firstArc, ratio);
    if (bounceIn) {
      return arc === 0 ? local * local : 1 - 4 * Math.exp(-arc) * local * (1 - local);
    }
    return 4 * Math.exp(-arc) * local * (1 - local);
  };
  if (positive) return evaluate;
  return bounceIn ? (ratio) => 1 - evaluate(1 - ratio) : (ratio) => evaluate(1 - ratio);
}

function createSpringEase(count: number): Curve['ease'] {
  const startup = 0.4 / count;
  const cycle = (1 - startup) / count;
  return (ratio) => {
    if (ratio < startup) return Math.sin((ratio * Math.PI) / (2 * startup));
    const elapsed = ratio - startup;
    return 0.7 + 0.3 * Math.exp(-elapsed / cycle) * Math.cos((2 * Math.PI * elapsed) / cycle);
  };
}

function readEase(map: MotionXmlNode): Curve['ease'] | undefined {
  const type = map.attributes.type ?? 'Linear';
  const rawStrength = number(map.attributes.strength ?? '0');
  if (!Number.isFinite(rawStrength) || Math.abs(rawStrength) > 100) return undefined;
  if (type === 'Linear') return linear;
  if (type === 'Bounce' || type === 'BounceIn') {
    const count = Math.abs(Math.trunc(rawStrength));
    if (count === 0) return linear;
    return createBounceEase(count, rawStrength > 0, type === 'BounceIn');
  }
  if (type === 'Spring') {
    const count = Math.trunc(rawStrength);
    if (count < 1) return linear;
    return createSpringEase(count);
  }
  const strength = rawStrength / 100;
  const dual = type.startsWith('Dual');
  const power = powers.get(dual ? type.slice(4) : type);
  if (!power) return undefined;
  if (strength === 0) return linear;
  return (time) => {
    const powerIn = (t: number) => t ** power;
    const powerOut = (t: number) => 1 - (1 - t) ** power;
    const eased = dual
      ? time < 0.5
        ? (strength < 0 ? powerIn(2 * time) : powerOut(2 * time)) / 2
        : 0.5 + (strength < 0 ? powerOut(2 * time - 1) : powerIn(2 * time - 1)) / 2
      : strength < 0 ? powerIn(time) : powerOut(time);
    return time + (eased - time) * Math.abs(strength);
  };
}

function readCurve(
  property: MotionXmlNode,
  nodes: readonly MotionXmlNode[],
  ease: Curve['ease'],
  duration: number,
  colorShift?: number,
): Curve | undefined {
  const keys: Key[] = [];
  if (nodes.length === 0 || nodes.length > 4096) return undefined;
  for (const node of nodes) {
    const { anchor, previous, next, timevalue, value, roving } = node.attributes;
    const time = number(timevalue ?? (node === property ? '0' : undefined));
    const point = pair(anchor);
    let ordinate = point?.[1] ?? number(value);
    if (colorShift !== undefined) {
      if (!value || !/^0x[\da-f]{8}$/iu.test(value)) return undefined;
      ordinate = (Number(value) >>> colorShift) & 255;
    }
    const before = previous === undefined ? [0, ordinate] as const : pair(previous);
    const after = next === undefined ? [0, ordinate] as const : pair(next);
    if (roving === '1' || !Number.isFinite(time) || time < 0 || time > duration ||
        !Number.isFinite(ordinate) || (anchor !== undefined && !point) || !before || !after) return undefined;
    keys.push({ time, value: ordinate, previous: before, next: after });
  }
  keys.sort((a, b) => a.time - b.time);
  for (let index = 1; index < keys.length; index += 1) {
    const left = keys[index - 1]!;
    const right = keys[index]!;
    const distance = right.time - left.time;
    if (distance <= 0 || left.next[0] < 0 || right.previous[0] > 0 ||
        left.next[0] > distance || -right.previous[0] > distance) return undefined;
  }
  return { keys, ease };
}

export function parseFlaObjectMotion(frame: MotionXmlNode, children: Children): MotionResult<AnimationCore> {
  const wrapper = children(frame.xml, frame.name).find((node) => node.name === 'motionObjectXML');
  const core = wrapper && children(wrapper.xml, wrapper.name).find((node) => node.name === 'AnimationCore');
  if (!core) return invalid('缺少 AnimationCore 数据');
  const timeScale = number(core.attributes.TimeScale);
  const duration = number(core.attributes.duration);
  if (timeScale <= 0 || !Number.isFinite(timeScale) || duration <= 0 || !Number.isFinite(duration)) {
    return invalid('曲线时间数据无效');
  }

  const root = children(core.xml, core.name);
  const metadata = root.find((node) => node.name === 'metadata');
  const settings = metadata && children(metadata.xml, metadata.name).find((node) => node.name === 'Settings');
  if (settings && ((settings.attributes.orientToPath ?? '0') !== '0' ||
      number(settings.attributes.xformPtZOffsetPixels ?? '0') !== 0)) {
    return invalid('沿路径旋转或三维转轴暂未支持');
  }
  const maps = root.filter((node) => node.name === 'TimeMap').map(readEase);
  const curves = new Map<string, Curve>();
  const pending = root.filter((node) => node.name === 'PropertyContainer');
  let shadowFilterCount = 0;
  let visited = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (++visited > 128) return invalid('属性数量超出支持范围');
    if (node.name === 'PropertyContainer') {
      const nested = children(node.xml, node.name);
      if (node.attributes.id === 'Filters') {
        if (nested.length > 8) return invalid('Too many instance filter curves');
        for (const filter of nested) {
          const properties = children(filter.xml, filter.name);
          if (filter.name !== 'PropertyContainer' || properties.length > 16 ||
              properties.some((property) => property.name !== 'Property' || !property.attributes.id?.startsWith('DropShadow_'))) {
            return invalid('Unsupported instance filter animation');
          }
          const key = `DropShadow_Distance:${shadowFilterCount++}`;
          for (const property of properties) {
            if (property.attributes.enabled === '0') continue;
            if (property.attributes.id !== 'DropShadow_Distance') {
              return invalid('Unsupported instance filter channel ' + property.attributes.id);
            }
            const frames = children(property.xml, property.name).filter((child) => child.name === 'Keyframe');
            if (frames.length === 0 && property.attributes.value !== undefined) frames.push(property);
            const mapIndex = number(property.attributes.TimeMapIndex ?? '0');
            const ease = property.attributes.ignoreTimeMap === '1' || (maps.length === 0 && mapIndex === 0)
              ? linear : maps[mapIndex];
            const curve = ease && readCurve(property, frames, ease, duration);
            if (!curve || curves.has(key)) return invalid('Invalid shadow distance curve');
            curves.set(key, curve);
          }
        }
        continue;
      }
      if (visited + pending.length + nested.length > 128) return invalid('属性数量超出支持范围');
      for (const child of nested) pending.push(child);
      continue;
    }
    if (node.name !== 'Property' || node.attributes.enabled === '0') continue;
    const id = node.attributes.id ?? '';
    const keyframes = children(node.xml, node.name).filter((child) => child.name === 'Keyframe');
    if (keyframes.length === 0 && node.attributes.value !== undefined) keyframes.push(node);
    const neutralDepth = id === 'Depth' && keyframes.length === 1 &&
      pair(keyframes[0]?.attributes.anchor)?.[1] === 0;
    if (neutralDepth) continue;
    if (!supportedProperties.has(id)) return invalid('暂未支持的属性 ' + id);
    const mapIndex = number(node.attributes.TimeMapIndex ?? '0');
    const ease = node.attributes.ignoreTimeMap === '1' || (maps.length === 0 && mapIndex === 0)
      ? linear : maps[mapIndex];
    if (!ease) return invalid('暂未支持的缓动或无效的缓动编号 ' + id);
    const channelNames = id === 'Tint_Color' ? ['Tint_R', 'Tint_G', 'Tint_B'] : [id];
    for (const [index, channel] of channelNames.entries()) {
      const curve = readCurve(node, keyframes, ease, duration, id === 'Tint_Color' ? 24 - index * 8 : undefined);
      if (!curve || curves.has(channel)) return invalid('曲线无效 ' + id);
      curves.set(channel, curve);
    }
  }
  return curves.size > 0 ? { ok: true, value: { timeScale, curves } } : invalid('没有可读取的对象曲线');
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s ** 3 * a + 3 * s ** 2 * t * b + 3 * s * t ** 2 * c + t ** 3 * d;
}

function sample(curve: Curve, at: number): number {
  const first = curve.keys[0]!;
  const last = curve.keys[curve.keys.length - 1]!;
  if (curve.keys.length === 1 || at <= first.time) return first.value;
  const span = last.time - first.time;
  if (span <= 0) return last.value;
  const ratio = curve.ease(Math.min((at - first.time) / span, 1));
  if (ratio <= 0) return first.value;
  if (ratio >= 1) return last.value;
  const time = first.time + span * ratio;
  let low = 0;
  let high = curve.keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (curve.keys[mid]!.time <= time) low = mid;
    else high = mid;
  }
  const left = curve.keys[low]!;
  const right = curve.keys[high]!;
  const duration = right.time - left.time;
  // Time handles are offsets from the key, value handles are absolute.
  const target = (time - left.time) / duration;
  const next = left.next[0] / duration;
  const previous = 1 + right.previous[0] / duration;
  let lower = 0;
  let upper = 1;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lower + upper) / 2;
    if (cubic(0, next, previous, 1, mid) < target) lower = mid;
    else upper = mid;
  }
  return cubic(left.value, left.next[1], right.previous[1], right.value, (lower + upper) / 2);
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function evaluateFlaObjectMotion(
  core: AnimationCore,
  frameOffset: number,
  sourceFps: number,
  base: FlaDisplayListMatrix,
  pivot: { readonly x: number; readonly y: number },
  authoredTint?: readonly [number, number, number],
): MotionResult<ObjectMotionPose> {
  const ticks = frameOffset / sourceFps * core.timeScale;
  if (!Number.isFinite(ticks) || ticks < 0) return invalid('无法确认源文件帧率');
  const value = (key: string, fallback: number) => {
    const curve = core.curves.get(key);
    return curve ? sample(curve, ticks) : fallback;
  };
  const baseAngle = Math.atan2(base.b, base.a);
  const baseSecondAngle = Math.atan2(-base.c, base.d);
  const rotation = value('Rotation_Z', baseAngle / degrees) * degrees;
  const angleX = rotation + value('Skew_Y', 0) * degrees;
  const angleY = rotation + value('Skew_X', (baseSecondAngle - baseAngle) / degrees) * degrees;
  const scaleX = value('Scale_X', Math.hypot(base.a, base.b) * 100) / 100;
  const scaleY = value('Scale_Y', Math.hypot(base.c, base.d) * 100) / 100;
  const a = scaleX * Math.cos(angleX);
  const b = scaleX * Math.sin(angleX);
  const c = -scaleY * Math.sin(angleY);
  const d = scaleY * Math.cos(angleY);
  const tx = base.tx + value('Motion_X', 0) + (base.a - a) * pivot.x + (base.c - c) * pivot.y;
  const ty = base.ty + value('Motion_Y', 0) + (base.b - b) * pivot.x + (base.d - d) * pivot.y;
  const matrix = { a, b, c, d, tx, ty };
  if (!Object.values(matrix).every(Number.isFinite)) return invalid('变换数值无效');

  const alphaMultiplier = core.curves.has('Alpha_Amount')
    ? clamp(value('Alpha_Amount', 100) / 100, 0, 1)
    : undefined;
  let rgbTransform: FlaDisplayListRgbTransform | undefined;
  if (core.curves.has('Brightness_Amount')) {
    const brightness = clamp(value('Brightness_Amount', 0) / 100, -1, 1);
    rgbTransform = { multiplier: 1 - Math.abs(brightness), offset: Math.max(0, brightness) * 255 };
  } else if (core.curves.has('Tint_Amount')) {
    const amount = clamp(value('Tint_Amount', 0) / 100, 0, 1);
    rgbTransform = {
      multiplier: 1 - amount,
      offset: 0,
      channelOffsets: [
        value('Tint_R', authoredTint?.[0] ?? 0) * amount,
        value('Tint_G', authoredTint?.[1] ?? 0) * amount,
        value('Tint_B', authoredTint?.[2] ?? 0) * amount,
      ],
    };
  }
  const shadowDistances: Array<number | undefined> = [];
  for (let ordinal = 0; ordinal < 8; ordinal += 1) {
    const curve = core.curves.get(`DropShadow_Distance:${ordinal}`);
    if (!curve) continue;
    const distance = sample(curve, ticks);
    if (!Number.isFinite(distance) || distance < 0 || distance > 255) return invalid('Shadow distance exceeds supported range');
    shadowDistances[ordinal] = distance;
  }
  return { ok: true, value: {
    matrix,
    ...(shadowDistances.length ? { shadowDistances } : {}),
    ...(alphaMultiplier !== undefined ? { alphaMultiplier } : {}),
    ...(rgbTransform ? { rgbTransform } : {}),
  } };
}
