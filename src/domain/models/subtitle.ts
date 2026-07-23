import { z } from 'zod';
import { ColorSchema, IdSchema, NameSchema } from './common';

export const SubtitleStyleSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    fontFamily: z.string().trim().min(1).max(200),
    fontSize: z.number().int().min(12).max(160),
    textColor: ColorSchema,
    backgroundColor: ColorSchema,
    position: z.enum(['top', 'center', 'bottom']),
    align: z.enum(['left', 'center', 'right']),
    maxWidth: z.number().int().positive().max(1920),
  })
  .strict();

export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;
