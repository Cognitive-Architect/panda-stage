import { z } from 'zod';

export const ASSET_DRAG_MIME =
  'application/x-panda-stage-asset' as const;

export const AssetDropPayloadSchema = z
  .object({
    version: z.literal(1),
    assetId: z.uuid(),
    type: z.enum([
      'character-image',
      'background-image',
      'audio',
    ]),
  })
  .strict();

export type AssetDropPayload = z.infer<
  typeof AssetDropPayloadSchema
>;

export function serializeAssetDropPayload(
  payload: AssetDropPayload,
): string {
  return JSON.stringify(AssetDropPayloadSchema.parse(payload));
}

export function parseAssetDropPayload(
  serialized: string,
): AssetDropPayload {
  return AssetDropPayloadSchema.parse(JSON.parse(serialized));
}

export function writeAssetDropPayload(
  dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>,
  payload: AssetDropPayload,
): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(
    ASSET_DRAG_MIME,
    serializeAssetDropPayload(payload),
  );
}
