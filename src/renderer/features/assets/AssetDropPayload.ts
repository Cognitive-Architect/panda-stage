import {
  AssetDropPayloadSchema,
  type AssetDropPayload,
} from '../../../domain';

export const ASSET_DRAG_MIME =
  'application/x-panda-stage-asset' as const;

export { AssetDropPayloadSchema };
export type { AssetDropPayload };

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
