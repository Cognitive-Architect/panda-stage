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
