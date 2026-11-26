import { z } from 'zod';

const RadiusSchema = z.number().int().min(0).max(32);
const HexColorSchema = z.string().regex(/^#[\da-f]{6}$/iu);

export const LayerVisualEffectsSchema = z.object({
  blend: z.enum(['normal', 'multiply', 'screen', 'add']),
  blur: RadiusSchema,
  glow: z.object({ radius: RadiusSchema, color: HexColorSchema }).strict(),
  outline: z.object({ radius: RadiusSchema, color: HexColorSchema }).strict(),
  silhouette: HexColorSchema.optional(),
  feather: RadiusSchema,
}).strict();

export type LayerVisualEffects = z.infer<typeof LayerVisualEffectsSchema>;

export const defaultLayerVisualEffects: LayerVisualEffects = {
  blend: 'normal', blur: 0, glow: { radius: 0, color: '#fff4ad' },
  outline: { radius: 0, color: '#000000' }, feather: 0,
};

export function hasLayerVisualEffects(effects: LayerVisualEffects): boolean {
  return effects.blend !== 'normal' || effects.blur > 0 || effects.glow.radius > 0 ||
    effects.outline.radius > 0 || Boolean(effects.silhouette) || effects.feather > 0;
}
