import { z } from 'zod';
import { FLA_STATIC_TEXT_LIMITS } from '../../shared/fla-static-text';

const limits = FLA_STATIC_TEXT_LIMITS;
const finite = z.number().finite();
export const FlaGraphicTextValueSchema = z.string().max(limits.maxCharsPerText);

export const FlaGraphicEditableTextSchema = z.object({
  left: finite,
  width: finite.min(0).max(limits.maxBoxDimension),
  height: finite.min(0).max(limits.maxBoxDimension),
  runs: z.tuple([z.object({
    characters: FlaGraphicTextValueSchema,
    alignment: z.enum(['left', 'center', 'right']),
    size: finite.min(limits.minFontSize).max(limits.maxFontSize),
    lineHeight: finite.min(0).max(limits.maxLineHeight),
    lineSpacing: finite.min(-limits.maxLineSpacing).max(limits.maxLineSpacing),
    letterSpacing: finite.min(-limits.maxLetterSpacing).max(limits.maxLetterSpacing),
    characterPosition: z.enum(['normal', 'subscript', 'superscript']).optional(),
    rotation: finite.min(-360).max(360).optional(),
    face: z.string().max(limits.maxFontFaceLength).optional(),
    fillColor: z.string().regex(/^#[\da-f]{6}$/iu),
    alpha: finite.min(0).max(1),
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean().optional(),
    leftMargin: finite.optional(),
    rightMargin: finite.optional(),
    indent: finite.optional(),
  }).strict()]),
}).strict();
export type FlaGraphicEditableText = z.infer<typeof FlaGraphicEditableTextSchema>;

export const FlaGraphicInstanceTextOverridesSchema = z.record(
  z.string().regex(/^(?:0|[1-9]\d{0,5})$/u),
  z.record(z.string().min(1).max(16_000), FlaGraphicTextValueSchema),
).superRefine((overrides, context) => {
  const authoredValues = Object.values(overrides).flatMap(Object.values);
  if (authoredValues.length > limits.maxTextNodesPerComposition ||
      authoredValues.reduce((total, text) => total + text.length, 0) > limits.maxCharsPerComposition) {
    context.addIssue({ code: 'custom', message: 'Instance text replacements exceed the supported limit.' });
  }
});
export type FlaGraphicInstanceTextOverrides = z.infer<typeof FlaGraphicInstanceTextOverridesSchema>;
