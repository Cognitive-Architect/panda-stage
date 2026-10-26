import type { ImageAssetUsage } from '../../../domain';

export const IMAGE_ASSET_USAGE_OPTIONS: readonly {
  value: ImageAssetUsage;
  label: string;
}[] = [
  { value: 'uncategorized', label: '未分类' },
  { value: 'background', label: '背景' },
  { value: 'character', label: '人物图片' },
  { value: 'prop', label: '道具' },
  { value: 'effect', label: '特效' },
];

export function imageAssetUsageLabel(usage: ImageAssetUsage): string {
  return IMAGE_ASSET_USAGE_OPTIONS.find((option) => option.value === usage)!
    .label;
}
