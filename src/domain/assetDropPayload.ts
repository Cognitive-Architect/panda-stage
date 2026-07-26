import { z } from 'zod';

const AssetImageDropPayloadSchema = z
  .object({
    version: z.literal(2),
    type: z.literal('asset-image'),
    assetId: z.uuid(),
  })
  .strict();

const CharacterExpressionDropPayloadSchema = z
  .object({
    version: z.literal(2),
    type: z.literal('character-expression'),
    assetId: z.uuid(),
    characterId: z.uuid(),
    expressionId: z.uuid(),
  })
  .strict();

const AudioDropPayloadSchema = z
  .object({
    version: z.literal(2),
    type: z.literal('audio'),
    assetId: z.uuid(),
  })
  .strict();

export const AssetDropPayloadSchema = z.discriminatedUnion('type', [
  AssetImageDropPayloadSchema,
  CharacterExpressionDropPayloadSchema,
  AudioDropPayloadSchema,
]);

export type AssetDropPayload = z.infer<
  typeof AssetDropPayloadSchema
>;
