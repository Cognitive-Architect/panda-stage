import type { Project } from './models/project';
import type { Asset } from './models/asset';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import { MOUTH_FLAP_PERIOD_MS, MOUTH_OPEN_MS } from './selectors/temporalRender';
import { resolveLayerVisualParts } from './selectors/visualParts';
import { audioClipGain } from './audio-contract';
import {
  scanAssetReferences,
  type AssetReference,
} from './validators/referenceScanner';
import {
  EXPORT_PREPARATION_MAX_ASSETS,
  EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
  EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
  EXPORT_PREPARATION_SUPPORT_PROFILE,
  isFormalExportMimeTypeSupported,
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

function shotVisualSampleTimes(shot: Project['shots'][number]): number[] {
  const times = new Set<number>([0]);
  for (const event of shot.timelineEvents) {
    if (event.type === 'expression' || event.type === 'visibility') {
      times.add(event.startMs);
    }
  }
  return [...times].sort((left, right) => left - right);
}

function characterVisibleDuringMouthOpen(
  project: Project,
  shot: Project['shots'][number],
  audioClip: Project['shots'][number]['audioClips'][number],
  characterLayerIds: ReadonlySet<string>,
): boolean {
  const activeEndMs = Math.min(audioClip.endMs, shot.durationMs);
  if (audioClip.startMs >= activeEndMs) return false;
  const stateChangeTimes = [
    ...new Set([
      audioClip.startMs,
      ...shot.timelineEvents
        .filter(
          (event) =>
            event.type === 'visibility' &&
            event.startMs > audioClip.startMs &&
            event.startMs < activeEndMs,
        )
        .map((event) => event.startMs),
    ]),
  ].sort((left, right) => left - right);

  for (let index = 0; index < stateChangeTimes.length; index += 1) {
    const segmentStartMs = stateChangeTimes[index]!;
    const segmentEndMs = stateChangeTimes[index + 1] ?? activeEndMs;
    if (segmentStartMs >= segmentEndMs) continue;
    const visible = evaluateShotAtTime(shot, segmentStartMs, project).layers.some(
      (layer) => characterLayerIds.has(layer.id) && layer.visible,
    );
    if (!visible) continue;

    const phase =
      (segmentStartMs - audioClip.startMs) % MOUTH_FLAP_PERIOD_MS;
    if (phase < MOUTH_OPEN_MS) return true;
    const nextOpenStartMs =
      segmentStartMs + (MOUTH_FLAP_PERIOD_MS - phase);
    if (nextOpenStartMs < segmentEndMs) return true;
  }
  return false;
}

function addShotVisualAssets(
  entries: Map<string, ExportPreparationMediaSource>,
  project: Project,
  shot: Project['shots'][number],
  shotIndex: number,
  referencesByAssetId: ReadonlyMap<string, readonly AssetReference[]>,
): void {
  const fallbackUsage = ['镜头“' + shot.name + '”的图像素材'];
  for (const timeMs of shotVisualSampleTimes(shot)) {
    const evaluatedShot = evaluateShotAtTime(shot, timeMs, project);
    for (const evaluatedLayer of evaluatedShot.layers) {
      if (!evaluatedLayer.visible) continue;
      const visual = resolveLayerVisualParts(project, shot, evaluatedLayer);
      for (const resource of [
        ...visual.resources.required,
        ...visual.resources.fallback,
      ]) {
        const asset = project.assets.find(
          (candidate) => candidate.id === resource.assetId,
        );
        if (asset?.kind !== 'image') continue;
        const labels = referenceLabelsForShot(
          referencesByAssetId.get(asset.id) ?? [],
          project,
          shotIndex,
        );
        addUsage(entries, asset, labels.length > 0 ? labels : fallbackUsage);
      }
    }
  }

  for (const dialogue of shot.dialogues) {
    const audioClip = shot.audioClips.find(
      (clip) => clip.id === dialogue.audioClipId,
    );
    if (!dialogue.audioClipId || !audioClip) continue;
    const audioAsset = project.assets.find(
      (asset) => asset.id === audioClip.assetId,
    );
    if (audioAsset?.kind !== 'audio') continue;
    const character = project.characters.find(
      (candidate) => candidate.id === dialogue.characterId,
    );
    if (!character?.mouthOpenAssetId) continue;
    const characterLayerIds = new Set(
      shot.layers
        .filter(
          (layer) =>
            layer.source.kind === 'character' &&
            layer.source.characterId === dialogue.characterId,
        )
        .map((layer) => layer.id),
    );
    if (characterLayerIds.size === 0) continue;
    const visibleDuringMouthOpen = characterVisibleDuringMouthOpen(
      project,
      shot,
      audioClip,
      characterLayerIds,
    );
    if (!visibleDuringMouthOpen) continue;
    const mouthAsset = project.assets.find(
      (asset) =>
        asset.id === character.mouthOpenAssetId && asset.kind === 'image',
    );
    if (!mouthAsset || mouthAsset.kind !== 'image') continue;
    const labels = referenceLabelsForShot(
      referencesByAssetId.get(mouthAsset.id) ?? [],
      project,
      shotIndex,
    );
    addUsage(entries, mouthAsset, labels.length > 0 ? labels : fallbackUsage);
  }
}

/**
 * Enumerates the image resources selected by the formal evaluator across the
 * shot's visual state changes. Preview-only alternate-expression preloads are
 * excluded; audio-bound Mouth assets are included when the shot can use them.
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
    addShotVisualAssets(
      entries,
      project,
      shot,
      shotIndex,
      referencesByAssetId,
    );

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
 * DL-04 adds whole-Project Shot sequencing to the formal export slice.
 * Project and reference validation runs before this support check; audio is
 * frozen with the other selected media before Main builds a mix plan.
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
        '\u9879\u76ee',
        '\u6b63\u5f0f\u5bfc\u51fa\u6700\u591a\u652f\u6301 ' + EXPORT_PREPARATION_SUPPORT_PROFILE.shotCount.maximum + ' \u4e2a\u955c\u5934\u3002',
        '\u8bf7\u51cf\u5c11\u955c\u5934\u6570\u91cf\u540e\u91cd\u65b0\u5bfc\u51fa\u3002',
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
    const location = '镜头“' + shot.name + '”';
    if (shot.backgroundLayerId === null) {
      issues.push(
        issue(
          location,
          '当前导出切片需要可见的图像背景。',
          '为镜头指定并显示图像背景后重新检查。',
        ),
      );
    } else {
      const background = shot.layers.find(
        (layer) => layer.id === shot.backgroundLayerId,
      );
      const backgroundSource = background?.source;
      const backgroundAsset =
        backgroundSource?.kind === 'asset'
          ? project.assets.find((asset) => asset.id === backgroundSource.assetId)
          : undefined;
      if (
        !background ||
        backgroundSource?.kind !== 'asset' ||
        backgroundAsset?.kind !== 'image'
      ) {
        issues.push({
          code: 'INVALID_PROJECT',
          location,
          problem: '镜头引用的背景图层或背景图像素材无效。',
          nextStep: '修复镜头的背景图层引用后重新检查。',
        });
      } else if (!background.visible) {
        issues.push(
          issue(
            location,
            '当前导出切片需要可见的图像背景。',
            '显示镜头的图像背景后重新检查。',
          ),
        );
      } else if (!isFormalExportMimeTypeSupported(backgroundAsset.mimeType)) {
        issues.push(
          issue(
            location,
            '当前正式导出不支持这张背景图的文件格式。',
            '将背景图转换为 PNG 或 JPEG 后重新检查。',
          ),
        );
      }
    }
    shot.audioClips.forEach((clip) => {
      const clipLocation =
        '镜头“' + shot.name + '”的音频片段“' + clip.name + '”';
      const asset = project.assets.find(
        (candidate) => candidate.id === clip.assetId,
      );
      if (!asset || asset.kind !== 'audio') {
        issues.push({
          code: 'INVALID_PROJECT',
          location: clipLocation,
          problem: '音频片段没有引用有效的音频素材。',
          nextStep: '修复音频素材引用后再导出。',
        });
        return;
      }
      if (clip.startMs >= clip.endMs || clip.endMs > shot.durationMs) {
        issues.push({
          code: 'INVALID_PROJECT',
          location: clipLocation,
          problem: '音频片段的时间范围必须为正数且位于镜头时长内。',
          nextStep: '调整片段起止时间，使其位于镜头时长内。',
        });
      }
      const requestedSourceEndMs =
        clip.offsetMs + (clip.endMs - clip.startMs);
      if (
        !Number.isSafeInteger(clip.offsetMs) ||
        !Number.isSafeInteger(clip.startMs) ||
        !Number.isSafeInteger(clip.endMs) ||
        !Number.isSafeInteger(requestedSourceEndMs) ||
        asset.durationMs === undefined ||
        requestedSourceEndMs > asset.durationMs
      ) {
        issues.push({
          code: 'INVALID_PROJECT',
          location: clipLocation,
          problem: '音频片段的源区间不可用或超出素材时长。',
          nextStep: '修复音频源偏移或片段长度后再导出。',
        });
      }
      try {
        audioClipGain(clip.volume);
      } catch {
        issues.push({
          code: 'INVALID_PROJECT',
          location: clipLocation,
          problem: '音频片段音量必须是 0 到 2 之间的有限值。',
          nextStep: '将片段音量调整到 0 到 2 之间。',
        });
      }
      if (!isFormalExportMimeTypeSupported(asset.mimeType)) {
        issues.push({
          code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
          location: clipLocation,
          problem: '当前导出切片支持 MP3 和 WAV 音频素材。',
          nextStep: '使用 MP3 或 WAV 音频素材后再导出。',
        });
      }
    });
  });

  return issues;
}
