import { z } from 'zod';

const channelOffset = z.number().min(0).max(255);

export const FlaInstanceColorSchema = z.object({
  opacity: z.number().min(0).max(1).optional(),
  rgbTransform: z.object({
    multiplier: z.number().min(0).max(1),
    offset: channelOffset,
    channelOffsets: z.tuple([channelOffset, channelOffset, channelOffset]).readonly().optional(),
  }).strict().optional(),
}).strict();

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
