import { z } from 'zod';
import { ColorSchema, IdSchema, NameSchema } from './common';

export const SUBTITLE_STYLE_FONT_SIZE_MIN = 12;
export const SUBTITLE_STYLE_FONT_SIZE_MAX = 160;
export const SUBTITLE_STYLE_STROKE_WIDTH_MAX = 32;
export const DEFAULT_SUBTITLE_STROKE_COLOR = '#000000';
export const DEFAULT_SUBTITLE_STROKE_WIDTH = 6;

export const SubtitleStyleSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    fontFamily: z.string().trim().min(1).max(200),
    fontSize: z
      .number()
      .int()
      .min(SUBTITLE_STYLE_FONT_SIZE_MIN)
      .max(SUBTITLE_STYLE_FONT_SIZE_MAX),
    textColor: ColorSchema,
    backgroundColor: ColorSchema,
    // R5 V1 deliberately keeps these fields optional so older project files
    // remain valid and render exactly as before (stroke width defaults to 0).
    strokeColor: ColorSchema.optional(),
    strokeWidth: z
      .number()
      .finite()
      .min(0)
      .max(SUBTITLE_STYLE_STROKE_WIDTH_MAX)
      .optional(),
    position: z.enum(['top', 'center', 'bottom']),
    align: z.enum(['left', 'center', 'right']),
    maxWidth: z.number().int().positive().max(1920),
  })
  .strict();

export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;
