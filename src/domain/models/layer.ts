import { z } from 'zod';
import { LAYER_ANCHOR } from '../constants';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';

export const AssetLayerSourceSchema = z
  .object({
    kind: z.literal('asset'),
    assetId: IdSchema,
  })
  .strict();

export const CharacterLayerSourceSchema = z
  .object({
    kind: z.literal('character'),
    characterId: IdSchema,
    expressionId: IdSchema,
  })
  .strict();

export const LayerSourceSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceSchema,
]);

export const LayerSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    source: LayerSourceSchema,
    /** x/y are always the visual center of the layer on the 1920×1080 canvas. */
    anchor: z.literal(LAYER_ANCHOR),
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    scaleX: FiniteNumberSchema.positive().default(1),
    scaleY: FiniteNumberSchema.positive().default(1),
    rotationDeg: FiniteNumberSchema.default(0),
    opacity: FiniteNumberSchema.min(0).max(1).default(1),
    visible: z.boolean().default(true),
    zIndex: z.number().int().nonnegative(),
  })
  .strict();

export type LayerSource = z.infer<typeof LayerSourceSchema>;
export type Layer = z.infer<typeof LayerSchema>;
