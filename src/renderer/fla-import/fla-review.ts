import {
  FlaRasterSelectionIntentSchema,
  type AnimationImportIR,
  type FlaCompatibilityStatus,
  type FlaRasterSelectionIntent,
} from '../../shared/fla-import-api';
import {
  analyzeAssetFileName,
  type AssetNameAnalysis,
} from '../../shared/asset-name';

export const FLA_COMPATIBILITY_STATUSES: readonly FlaCompatibilityStatus[] = [
  'exact',
  'degraded',
  'unsupported',
  'unknown',
  'not-present',
];

export const FLA_COMPATIBILITY_LABELS: Readonly<
  Record<FlaCompatibilityStatus, string>
> = {
  exact: '完全兼容',
  degraded: '部分兼容',
  unsupported: '暂不支持',
  unknown: '未知',
  'not-present': '未出现',
};

export interface ExistingAssetName {
  relativePath: string;
}

export interface FlaReviewMedia {
  media: AnimationImportIR['media'][number];
  placed: boolean;
  libraryOnly: boolean;
  name: AssetNameAnalysis;
  warnings: readonly string[];
}

export function reviewMedia(
  ir: AnimationImportIR,
  existingAssets: readonly ExistingAssetName[] = [],
): FlaReviewMedia[] {
  const placedMediaIds = new Set(
    ir.timelines.flatMap((timeline) =>
      timeline.layers.flatMap((layer) =>
        layer.frames.flatMap((frame) =>
          frame.instances.map((instance) => instance.mediaId),
        ),
      ),
    ),
  );
  const existingNames = new Set(
    existingAssets.map((asset) => basename(asset.relativePath).toLocaleLowerCase('en-US')),
  );
  const media = [...ir.media].sort((left, right) =>
    `${left.name}\u001f${left.sourceReference}\u001f${left.id}`.localeCompare(
      `${right.name}\u001f${right.sourceReference}\u001f${right.id}`,
      'en-US',
    ),
  );
  const targetNameCounts = new Map<string, number>();
  for (const item of media) {
    const targetName = analyzeAssetFileName(item.name, '.png').targetFileName;
    const key = targetName.toLocaleLowerCase('en-US');
    targetNameCounts.set(key, (targetNameCounts.get(key) ?? 0) + 1);
  }
  const sourceCounts = sourceNameCounts(media);

  return media.map((mediaItem) => {
    const name = analyzeAssetFileName(mediaItem.name, '.png');
    const targetKey = name.targetFileName.toLocaleLowerCase('en-US');
    const sourceKey = basename(mediaItem.name)
      .normalize('NFC')
      .toLocaleLowerCase('en-US');
    const warnings: string[] = [];
    if (name.hadInvalidWindowsCharacters || name.hadTrailingDotOrSpace) {
      warnings.push('源名称含 Windows 文件名限制字符，已预览规范化名称');
    }
    if (name.wasReservedWindowsName) {
      warnings.push('源名称是 Windows 保留名，已预览安全名称');
    }
    if ((sourceCounts.get(sourceKey) ?? 0) > 1) {
      warnings.push('源名称重复；Slice 3 将按稳定 ID 区分');
    }
    if ((targetNameCounts.get(targetKey) ?? 0) > 1) {
      warnings.push('未来目标文件名与另一个 FLA 媒体项冲突');
    }
    if (existingNames.has(targetKey)) {
      warnings.push('未来目标文件名与现有 Asset 冲突');
    }
    const placed = placedMediaIds.has(mediaItem.id);
    return {
      media: mediaItem,
      placed,
      libraryOnly: !placed,
      name,
      warnings,
    };
  });
}

export function toggleFlaMediaSelection(
  selectedMediaIds: ReadonlySet<string>,
  mediaId: string,
): Set<string> {
  const next = new Set(selectedMediaIds);
  if (next.has(mediaId)) next.delete(mediaId);
  else next.add(mediaId);
  return next;
}

export function compatibilityCounts(
  ir: AnimationImportIR,
): Record<FlaCompatibilityStatus, number> {
  const counts = Object.fromEntries(
    FLA_COMPATIBILITY_STATUSES.map((status) => [status, 0]),
  ) as Record<FlaCompatibilityStatus, number>;
  for (const entry of ir.compatibility) counts[entry.status] += 1;
  return counts;
}

export function compatibilityWarnings(
  ir: AnimationImportIR,
): AnimationImportIR['compatibility'] {
  return ir.compatibility.filter((entry) =>
    entry.status === 'degraded' ||
    entry.status === 'unsupported' ||
    entry.status === 'unknown',
  );
}

export function createFlaRasterSelectionIntent(
  ir: AnimationImportIR,
  sessionId: string,
  selectedMediaIds: ReadonlySet<string>,
): FlaRasterSelectionIntent {
  const orderedIds = reviewMedia(ir)
    .map(({ media }) => media.id)
    .filter((mediaId) => selectedMediaIds.has(mediaId));
  return FlaRasterSelectionIntentSchema.parse({
    format: 'fla-raster-selection',
    version: 1,
    sessionId,
    source: {
      basename: ir.source.basename,
      sha256: ir.source.sha256,
    },
    selectedMediaIds: orderedIds,
    selectedCount: orderedIds.length,
  });
}

function sourceNameCounts(
  media: readonly AnimationImportIR['media'][number][],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of media) {
    const key = basename(item.name).normalize('NFC').toLocaleLowerCase('en-US');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
