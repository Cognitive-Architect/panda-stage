import type { Project } from './models/project';
import type { Asset, ImageAsset } from './models/asset';
import { listShotRuntimeImageAssets } from './selectors/temporalRender';
import {
  scanAssetReferences,
  type AssetReference,
} from './validators/referenceScanner';
import {
  EXPORT_PREPARATION_MAX_ASSETS,
  EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
  EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
  EXPORT_PREPARATION_SUPPORT_PROFILE,
  type ExportPreparationCameraMode,
  type ExportPreparationIssue,
} from '../shared/export-preparation-types';

export interface ExportPreparationMediaSource {
  asset: Asset;
  usages: string[];
}

export interface ExportPreparationBudgetEntry {
  byteLength: number;
  location: string;
}

export interface ExportPreparationBudgetResult {
  totalBytes: number;
  issues: ExportPreparationIssue[];
}

export function evaluateExportPreparationBudget(
  entries: readonly ExportPreparationBudgetEntry[],
): ExportPreparationBudgetResult {
  const issues: ExportPreparationIssue[] = [];
  const totalBytes = entries.reduce(
    (total, entry) => total + entry.byteLength,
    0,
  );

  if (entries.length > EXPORT_PREPARATION_MAX_ASSETS) {
    issues.push({
      code: 'PREPARATION_BUDGET_EXCEEDED',
      location: '工程素材',
      problem:
        '本次准备需要检查的素材数量超过 ' +
        EXPORT_PREPARATION_MAX_ASSETS +
        ' 项上限。',
      nextStep: '减少本次实际使用的素材数量后重新检查。',
    });
  }
  for (const entry of entries) {
    if (entry.byteLength > EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES) {
      issues.push({
        code: 'PREPARATION_BUDGET_EXCEEDED',
        location: entry.location,
        problem: '单个素材超过 64 MiB 的准备上限。',
        nextStep: '使用更小的源素材后重新检查。',
      });
    }
  }
  if (totalBytes > EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES) {
    issues.push({
      code: 'PREPARATION_BUDGET_EXCEEDED',
      location: '工程素材',
      problem: '本次实际使用素材超过 256 MiB 的准备上限。',
      nextStep: '降低本次使用素材的总大小后重新检查。',
    });
  }
  return { totalBytes, issues };
}

function addUsage(
  entries: Map<string, ExportPreparationMediaSource>,
  asset: Asset,
  usages: readonly string[],
): void {
  const existing = entries.get(asset.id);
  if (existing) {
    for (const usage of usages) {
      if (!existing.usages.includes(usage)) existing.usages.push(usage);
    }
    return;
  }
  entries.set(asset.id, { asset, usages: [...new Set(usages)] });
}

function referenceLabelsForShot(
  references: readonly AssetReference[],
  project: Project,
  shotIndex: number,
): string[] {
  const shot = project.shots[shotIndex];
  if (!shot) return [];
  const shotPrefix = 'shots[' + shotIndex + ']';
  const activeCharacterIndexes = new Set(
    shot.layers
      .filter((layer) => layer.source.kind === 'character')
      .map((layer) => {
        const source = layer.source;
        if (source.kind !== 'character') return -1;
        return project.characters.findIndex(
          (character) => character.id === source.characterId,
        );
      })
      .filter((index) => index >= 0),
  );

  return references
    .filter((reference) => {
      if (reference.path.startsWith(shotPrefix)) return true;
      const characterIndex = /^characters\[(\d+)\]/u.exec(reference.path);
      return (
        characterIndex !== null &&
        activeCharacterIndexes.has(Number(characterIndex[1]))
      );
    })
    .map((reference) => reference.label);
}

function mouthImageIsUsed(project: Project, assetId: string): boolean {
  const characters = new Map(
    project.characters.map((character) => [character.id, character]),
  );
  return project.shots.some((shot) =>
    shot.dialogues.some((dialogue) => {
      if (!dialogue.audioClipId) return false;
      const hasBoundAudio = shot.audioClips.some(
        (clip) => clip.id === dialogue.audioClipId,
      );
      return (
        hasBoundAudio &&
        characters.get(dialogue.characterId)?.mouthOpenAssetId === assetId
      );
    }),
  );
}

function isOptionalUnusedMouthImage(
  project: Project,
  asset: ImageAsset,
): boolean {
  const references = scanAssetReferences(project, asset.id);
  return (
    references.length > 0 &&
    references.every((reference) => reference.kind === 'character-mouth') &&
    !mouthImageIsUsed(project, asset.id)
  );
}

/**
 * Enumerates media that the formal shot renderer can use at any time in the
 * Project. It relies on the same temporal visual selector as Product Preview
 * so later expressions and valid mouth overrides are not missed.
 */
export function collectExportPreparationMedia(
  project: Project,
): ExportPreparationMediaSource[] {
  const entries = new Map<string, ExportPreparationMediaSource>();
  const referencesByAssetId = new Map(
    project.assets.map((asset) => [
      asset.id,
      scanAssetReferences(project, asset.id),
    ]),
  );

  project.shots.forEach((shot, shotIndex) => {
    const runtimeImages = listShotRuntimeImageAssets(project, shot);
    for (const asset of runtimeImages) {
      if (isOptionalUnusedMouthImage(project, asset)) continue;
      const labels = referenceLabelsForShot(
        referencesByAssetId.get(asset.id) ?? [],
        project,
        shotIndex,
      );
      addUsage(
        entries,
        asset,
        labels.length > 0
          ? labels
          : ['镜头“' + shot.name + '”的图像素材'],
      );
    }

    shot.audioClips.forEach((clip) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === clip.assetId,
      );
      if (!asset) return;
      addUsage(entries, asset, [
        '镜头“' + shot.name + '”的音频片段“' + clip.name + '”',
      ]);
    });
  });

  return [...entries.values()];
}

function issue(
  location: string,
  problem: string,
  nextStep: string,
): ExportPreparationIssue {
  return {
    code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
    location,
    problem,
    nextStep,
  };
}

/**
 * DL-01 prepares the initial DL-02 slice: one shot, visible project
 * background, current Preview composition, and no audio mixing. Audio content
 * remains valid Project data and is reported as unsupported, never mutated.
 */
export function evaluateExportPreparationSupport(
  project: Project,
  cameraMode: ExportPreparationCameraMode,
): ExportPreparationIssue[] {
  const issues: ExportPreparationIssue[] = [];
  if (project.shots.length === 0) {
    issues.push({
      code: 'INVALID_PROJECT',
      location: '工程',
      problem: '工程中没有可导出的镜头。',
      nextStep: '添加一个镜头并设置背景后重新检查。',
    });
    return issues;
  }

  if (project.shots.length > EXPORT_PREPARATION_SUPPORT_PROFILE.shotCount.maximum) {
    issues.push(
      issue(
        '工程',
        '当前导出切片只支持单镜头工程；镜头顺序和内容不会被裁掉。',
        '保留原工程，等待多镜头导出支持后再继续。',
      ),
    );
  }

  if (
    !EXPORT_PREPARATION_SUPPORT_PROFILE.cameraModes.includes(cameraMode)
  ) {
    issues.push(
      issue(
        '工程构图',
        '当前导出切片不支持所选运镜模式。',
        '切换到受支持的构图模式后重新检查。',
      ),
    );
  }

  project.shots.forEach((shot) => {
    const background = shot.layers.find(
      (layer) => layer.id === shot.backgroundLayerId,
    );
    const backgroundSource = background?.source;
    if (
      !background ||
      !background.visible ||
      backgroundSource?.kind !== 'asset' ||
      project.assets.find((asset) => asset.id === backgroundSource.assetId)
        ?.kind !== 'image'
    ) {
      issues.push({
        code: 'INVALID_PROJECT',
        location: '镜头“' + shot.name + '”',
        problem: '这个镜头没有可见且有效的背景图层。',
        nextStep: '为镜头设置可见的图像背景后重新检查。',
      });
    }
    shot.audioClips.forEach((clip) => {
      issues.push(
        issue(
          '镜头“' + shot.name + '”的音频片段“' + clip.name + '”',
          '当前导出切片尚不支持有声工程。音频数据和 0..2 音量会原样保留。',
          '保留音频内容，等待带音频导出支持后再继续。',
        ),
      );
    });
  });

  return issues;
}
