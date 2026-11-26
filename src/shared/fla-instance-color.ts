import { z } from 'zod';

const channelOffset = z.number().min(0).max(255);
const signedChannelBound = z.number().finite().min(-1024).max(1024);

export const FlaRgbaTransformSchema = z.object({
  multipliers: z.tuple([
    signedChannelBound,
    signedChannelBound,
    signedChannelBound,
    signedChannelBound,
  ]).readonly(),
  offsets: z.tuple([
    signedChannelBound,
    signedChannelBound,
    signedChannelBound,
    signedChannelBound,
  ]).readonly(),
}).strict();

export const FlaInstanceColorSchema = z.object({
  opacity: z.number().min(0).max(1).optional(),
  rgbTransform: z.object({
    multiplier: z.number().min(0).max(1),
    offset: channelOffset,
    channelOffsets: z.tuple([channelOffset, channelOffset, channelOffset]).readonly().optional(),
  }).strict().optional(),
  rgbaTransform: FlaRgbaTransformSchema.optional(),
}).strict().refine(
  (value) => !(value.rgbaTransform && (value.opacity !== undefined || value.rgbTransform !== undefined)),
  'rgbaTransform carries all four RGBA channels and must not be combined with opacity or rgbTransform.',
);

export type FlaInstanceColor = z.infer<typeof FlaInstanceColorSchema>;

type ChannelTuple = readonly [number, number, number, number];

/** Explicit XFL color channels in non-premultiplied RGBA, offsets in byte units. */
export interface FlaRgbaTransform {
  readonly multipliers: ChannelTuple;
  readonly offsets: ChannelTuple;
}

const channels = ['red', 'green', 'blue', 'alpha'] as const;

export const flaRgbaAttributeNames: ReadonlySet<string> = new Set(
  channels.flatMap((channel) => [`${channel}Multiplier`, `${channel}Offset`]),
);

export function isFlaRgbaTransform(value: FlaRgbaTransform): boolean {
  return value.multipliers.length === 4 && value.offsets.length === 4 &&
    [...value.multipliers, ...value.offsets].every((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1024);
}

export function isIdentityFlaRgbaTransform(value: FlaRgbaTransform): boolean {
  return value.multipliers[0] === 1 &&
    value.multipliers[1] === 1 &&
    value.multipliers[2] === 1 &&
    value.multipliers[3] === 1 &&
    value.offsets[0] === 0 &&
    value.offsets[1] === 0 &&
    value.offsets[2] === 0 &&
    value.offsets[3] === 0;
}

export function normalizeFlaInstanceColorToRgba(color: FlaInstanceColor): FlaRgbaTransform {
  if (color.rgbaTransform) return color.rgbaTransform;
  const opacity = color.opacity ?? 1;
  const rgb = color.rgbTransform;
  if (!rgb) {
    return { multipliers: [1, 1, 1, opacity], offsets: [0, 0, 0, 0] };
  }
  const [ro, go, bo] = rgb.channelOffsets ?? [rgb.offset, rgb.offset, rgb.offset];
  return {
    multipliers: [rgb.multiplier, rgb.multiplier, rgb.multiplier, opacity],
    offsets: [ro, go, bo, 0],
  };
}

export function isZeroAlphaFlaInstanceColor(color: FlaInstanceColor | undefined): boolean {
  if (!color) return false;
  const rgba = normalizeFlaInstanceColorToRgba(color);
  return rgba.multipliers[3] === 0 && rgba.offsets[3] <= 0;
}

/**
 * Merges parent(child(c)) into one non-premultiplied RGBA transform ONLY when
 * child cannot clamp any [0..255] input on any channel (exact linear equivalence).
 * Returns null whenever child can clamp, so callers keep separate clamp passes.
 */
export function composeLinearFlaRgbaTransforms(
  parent: FlaRgbaTransform,
  child: FlaRgbaTransform,
): FlaRgbaTransform | null {
  for (let i = 0; i < 4; i += 1) {
    const low = child.offsets[i]!;
    const high = 255 * child.multipliers[i]! + child.offsets[i]!;
    const min = Math.min(low, high);
    const max = Math.max(low, high);
    if (min < 0 || max > 255) return null;
  }
  const multipliers: [number, number, number, number] = [
    parent.multipliers[0] * child.multipliers[0],
    parent.multipliers[1] * child.multipliers[1],
    parent.multipliers[2] * child.multipliers[2],
    parent.multipliers[3] * child.multipliers[3],
  ];
  const offsets: [number, number, number, number] = [
    parent.multipliers[0] * child.offsets[0] + parent.offsets[0],
    parent.multipliers[1] * child.offsets[1] + parent.offsets[1],
    parent.multipliers[2] * child.offsets[2] + parent.offsets[2],
    parent.multipliers[3] * child.offsets[3] + parent.offsets[3],
  ];
  const composed: FlaRgbaTransform = { multipliers, offsets };
  return isFlaRgbaTransform(composed) ? composed : null;
}

export function readFlaRgbaTransform(attributes: Readonly<Record<string, string | undefined>>): FlaRgbaTransform | null {
  const read = (key: string, fallback: number) => {
    const raw = attributes[key];
    return raw === undefined ? fallback : raw.trim() === '' ? Number.NaN : Number(raw);
  };
  const transform = {
    multipliers: channels.map((channel) => read(`${channel}Multiplier`, 1)) as unknown as ChannelTuple,
    offsets: channels.map((channel) => read(`${channel}Offset`, 0)) as unknown as ChannelTuple,
  };
  return isFlaRgbaTransform(transform) ? transform : null;
}

export function applyFlaRgbaTransform(input: ChannelTuple, transform: FlaRgbaTransform): ChannelTuple {
  const channel = (index: 0 | 1 | 2 | 3) => Math.max(0, Math.min(255,
    input[index] * transform.multipliers[index] + transform.offsets[index],
  ));
  return [channel(0), channel(1), channel(2), channel(3)];
}
