import {
  buildAdaptivePartsFromFlaGraphicSubtrees,
  collectFlaGraphicSubtreeSelections,
  isFlaGraphicDefinition,
  type FlaGraphicAuthorPoseReference,
  type FlaGraphicAuthorPoseResolution,
  type FlaGraphicDefinition,
  type FlaGraphicSavedLayoutResolution,
  type FlaGraphicSubtreeCollectionResult,
  type FlaGraphicSubtreeCollectionSkippedItem,
} from '../../../domain';
import type {
  FlaGraphicInstanceCommitErrorCode,
  FlaGraphicInstanceCommitRequest,
  FlaGraphicInstanceCommitResponse,
} from '../../../shared/fla-graphic-instance-api';
import type { CharacterStore } from '../../stores/characterStore';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import type { EditableFlaGraphicInstancePreview } from './fla-graphic-instance-import';

export interface CreateAdaptiveCharacterFromGraphicInput {
  readonly preview: EditableFlaGraphicInstancePreview;
  readonly unitId: string;
  readonly characterName?: string;
  readonly poseFrameOrdinal?: number;
  readonly reusedAnimationId?: string;
}

export type FlaGraphicAutoPlacedOrigin =
  | 'author-pose'
  | 'saved-layout'
  | 'author-pose-and-layout';

export type CreateAdaptiveCharacterFromGraphicResult =
  | {
      readonly ok: true;
      readonly animationId: string;
      readonly characterId: string;
      readonly characterName: string;
      readonly partCount: number;
      readonly autoPlacedCount: number;
      readonly authorPosePlacedCount?: number;
      readonly savedLayoutPlacedCount?: number;
      readonly autoPlacedOrigin?: FlaGraphicAutoPlacedOrigin | null;
      readonly autoPlacedReferenceLabel?: string | null;
      readonly skipped: readonly FlaGraphicSubtreeCollectionSkippedItem[];
      readonly warnings: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind:
        | 'definition-commit-failed'
        | 'no-multipart-candidates'
        | 'character-create-failed';
      readonly code?: FlaGraphicInstanceCommitErrorCode | string;
      readonly animationId?: string;
      readonly definitionName?: string;
      readonly collection?: FlaGraphicSubtreeCollectionResult;
      readonly message: string;
    };

export type CreateAdaptiveCharacterFromGraphic = (
  input: CreateAdaptiveCharacterFromGraphicInput,
) => Promise<CreateAdaptiveCharacterFromGraphicResult>;

export interface CreateAdaptiveCharacterFromGraphicDependencies
  extends CreateAdaptiveCharacterFromGraphicInput {
  readonly api: {
    commitGraphicInstance(
      request: FlaGraphicInstanceCommitRequest,
    ): Promise<FlaGraphicInstanceCommitResponse>;
  };
  readonly store?: EditorProjectStore;
  readonly characters: Pick<CharacterStore, 'createAdaptiveParts'>;
  readonly ensureMainSnapshot?: (snapshot: EditorProjectSnapshot) => Promise<void>;
}

export interface FlaGraphicPlacementNoticeMeta {
  readonly autoPlacedCount?: number;
  readonly authorPosePlacedCount?: number;
  readonly savedLayoutPlacedCount?: number;
  readonly autoPlacedOrigin?: FlaGraphicAutoPlacedOrigin | null;
}

export function formatFlaGraphicSkippedSummary(
  partCount: number,
  skipped: readonly FlaGraphicSubtreeCollectionSkippedItem[],
  warnings: readonly string[] = [],
  placement?: FlaGraphicPlacementNoticeMeta,
): string | undefined {
  const uniqueWarnings = Array.from(
    new Set(warnings.map((warning) => warning.trim()).filter(Boolean)),
  );
  const autoPlacedCount = placement?.autoPlacedCount ?? 0;
  const authorCount = placement?.authorPosePlacedCount ?? 0;
  const layoutCount = placement?.savedLayoutPlacedCount ?? 0;
  const placementLead =
    autoPlacedCount > 0
      ? placement?.autoPlacedOrigin === 'author-pose-and-layout' && authorCount > 0 && layoutCount > 0
        ? `已按参考姿势还原 ${authorCount}/${partCount} 个零件，并按已保存布局补充摆放 ${layoutCount} 个零件`
        : placement?.autoPlacedOrigin === 'saved-layout'
          ? `已按已保存布局自动摆放 ${autoPlacedCount}/${partCount} 个零件`
          : `已按参考姿势自动还原 ${autoPlacedCount}/${partCount} 个零件`
      : null;

  if (skipped.length === 0 && uniqueWarnings.length === 0) {
    return placementLead ?? undefined;
  }
  if (skipped.length > 0 && uniqueWarnings.length === 0) {
    const firstReason = skipped[0]?.reason?.trim();
    const detail = firstReason ? `（${firstReason}）` : '';
    if (placementLead) {
      return `${placementLead}，已跳过 ${skipped.length} 个不支持独立提取的节点${detail}`;
    }
    return `已创建 ${partCount} 个可编辑零件，已跳过 ${skipped.length} 个不支持独立提取的节点${detail}`;
  }
  if (skipped.length === 0) {
    if (placementLead) {
      return `${placementLead}，部分内容存在限制或已跳过：${uniqueWarnings.join('；')}`;
    }
    return `角色已创建（${partCount} 个可编辑零件），部分内容存在限制或已跳过：${uniqueWarnings.join('；')}`;
  }
  const firstReason = skipped[0]?.reason?.trim();
  const extraWarnings = uniqueWarnings.filter((warning) => warning !== firstReason);
  const details = Array.from(
    new Set([...(firstReason ? [firstReason] : []), ...extraWarnings]),
  );
  const suffix = details.length > 0 ? `（${details.join('；')}）` : '';
  if (placementLead) {
    return `${placementLead}，已跳过 ${skipped.length} 个不支持独立提取的节点${suffix}`;
  }
  return `角色已创建（${partCount} 个可编辑零件），已跳过 ${skipped.length} 个不支持独立提取的节点${suffix}`;
}

export async function createAdaptiveCharacterFromFlaGraphic(
  options: CreateAdaptiveCharacterFromGraphicDependencies,
): Promise<CreateAdaptiveCharacterFromGraphicResult> {
  const store = options.store ?? editorProjectStore;
  const snapshot = store.getSnapshot();
  const openInstanceId = store.getProjectInstanceId();
  if (!snapshot || openInstanceId === null) {
    return {
      ok: false,
      kind: 'definition-commit-failed',
      code: 'PROJECT_NOT_TRACKED',
      message: '请先打开项目。',
    };
  }

  let animationId: string | undefined =
    options.reusedAnimationId &&
    snapshot.project.animations.some(
      (candidate) =>
        candidate.id === options.reusedAnimationId &&
        isFlaGraphicDefinition(candidate) &&
        Boolean(candidate.structure),
    )
      ? options.reusedAnimationId
      : undefined;

  let authorPoseReferences: readonly FlaGraphicAuthorPoseReference[] | undefined;

  if (!animationId) {
    const { preview, unitId } = options;
    if (
      !preview.sessionId ||
      !preview.generation ||
      !preview.planId ||
      !preview.poseIdentity
    ) {
      return {
        ok: false,
        kind: 'definition-commit-failed',
        code: 'STALE_PLAN',
        message: 'FLA 对象预览已失效，请重新准备。',
      };
    }

    const lease = store.acquireProjectOperationLease({
      projectRoot: snapshot.projectRoot,
      projectId: snapshot.project.id,
      revision: snapshot.revision,
      openInstanceId,
    });
    try {
      await options.ensureMainSnapshot?.(snapshot);
      if (store.getSnapshot() !== snapshot) {
        return {
          ok: false,
          kind: 'definition-commit-failed',
          code: 'STALE_PROJECT_REVISION',
          message: '项目状态已更新，请重试。',
        };
      }
      const response = await options.api.commitGraphicInstance({
        format: 'fla-graphic-instance-commit',
        version: 1,
        requestId: crypto.randomUUID(),
        projectRoot: snapshot.projectRoot,
        projectId: snapshot.project.id,
        baseRevision: snapshot.revision,
        openInstanceId,
        startTimeMs: 0,
        plan: {
          sessionId: preview.sessionId,
          planId: preview.planId,
          generation: preview.generation,
          poseIdentity: preview.poseIdentity,
          unitId,
        },
      });
      if (!response.ok) {
        return {
          ok: false,
          kind: 'definition-commit-failed',
          code: response.error.code,
          message: response.error.message,
        };
      }
      if (
        response.projectRoot !== lease.projectRoot ||
        response.projectId !== lease.projectId ||
        response.openInstanceId !== lease.openInstanceId ||
        response.baseRevision !== lease.revision
      ) {
        return {
          ok: false,
          kind: 'definition-commit-failed',
          code: 'STALE_PROJECT_REVISION',
          message: 'Main Process 返回的元件结果与当前打开的项目不一致。',
        };
      }
      if (response.projectChanged) {
        store.acceptSavedProjectCommand(
          lease,
          response.project,
          response.savedRevision,
          '导入 FLA 元件',
        );
      } else {
        store.markSaved(response.project, response.savedRevision);
      }
      animationId = response.animationId;
      authorPoseReferences = response.authorPoseReferences;
    } catch (error) {
      return {
        ok: false,
        kind: 'definition-commit-failed',
        message: error instanceof Error ? error.message : '无法保存 FLA 元件，请重试。',
      };
    } finally {
      store.releaseProjectOperationLease(lease);
    }
  }

  const liveSnapshot = store.getSnapshot();
  if (!liveSnapshot) {
    return {
      ok: false,
      kind: 'character-create-failed',
      animationId,
      message: '项目已关闭，无法创建角色。',
    };
  }
  const definition = liveSnapshot.project.animations.find(
    (candidate): candidate is FlaGraphicDefinition =>
      candidate.id === animationId && isFlaGraphicDefinition(candidate),
  );
  if (!definition || !definition.structure) {
    return {
      ok: false,
      kind: 'no-multipart-candidates',
      animationId,
      definitionName: definition?.name,
      message: '已保存原元件，但该元件缺少可用于自动拆件的结构信息，可在结构树中继续查看。',
    };
  }

  const frameOrdinal =
    options.poseFrameOrdinal ?? definition.structure.frames[0]?.ordinal ?? 0;
  const collection = collectFlaGraphicSubtreeSelections({
    definition,
    frameOrdinal,
    assets: liveSnapshot.project.assets,
  });
  if (collection.selections.length < 2) {
    const detail = collection.skipped[0]?.reason
      ? `（${collection.skipped[0].reason}）`
      : '';
    return {
      ok: false,
      kind: 'no-multipart-candidates',
      animationId: definition.id,
      definitionName: definition.name,
      collection,
      message: `该元件当前没有可拆分的多个独立零件${detail}，已保留原元件，可在素材库「导入元件」或结构树中继续使用。`,
    };
  }

  try {
    const authorPoseRef: { current: FlaGraphicAuthorPoseResolution | null } = { current: null };
    const savedLayoutRef: { current: FlaGraphicSavedLayoutResolution | null } = { current: null };
    const createInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project: liveSnapshot.project,
      definition,
      frameOrdinal,
      selections: collection.selections,
      ...(options.characterName?.trim()
        ? { characterName: options.characterName.trim() }
        : {}),
      applyAuthorPose: true,
      ...(authorPoseReferences?.length ? { authorPoseReferences } : {}),
      onAuthorPoseResolved: (resolution) => {
        authorPoseRef.current = resolution;
      },
      applySavedLayoutReuse: true,
      onSavedLayoutResolved: (resolution) => {
        savedLayoutRef.current = resolution;
      },
    });
    const authorPoseCount = authorPoseRef.current?.matchedCount ?? 0;
    const savedLayoutCount = savedLayoutRef.current?.matchedCount ?? 0;
    const autoPlacedCount = authorPoseCount + savedLayoutCount;
    const autoPlacedOrigin: FlaGraphicAutoPlacedOrigin | null =
      authorPoseCount > 0 && savedLayoutCount > 0
        ? 'author-pose-and-layout'
        : authorPoseCount > 0
          ? 'author-pose'
          : savedLayoutCount > 0
            ? 'saved-layout'
            : null;
    const autoPlacedReferenceLabel =
      authorPoseCount > 0
        ? (authorPoseRef.current?.matchedReferenceLabel ?? null)
        : savedLayoutCount > 0
          ? (savedLayoutRef.current?.selectedTemplate?.templateCharacterName ?? null)
          : null;
    const updatedProject = options.characters.createAdaptiveParts(
      createInput,
      liveSnapshot,
    );
    const createdPartId = createInput.parts[0]?.partId;
    const createdCharacter =
      (createdPartId
        ? updatedProject.characters.find(
            (candidate) =>
              candidate.mode === 'adaptive-parts' &&
              candidate.parts.some((part) => part.partId === createdPartId),
          )
        : undefined) ?? updatedProject.characters.at(-1);
    if (!createdCharacter || createdCharacter.mode !== 'adaptive-parts') {
      return {
        ok: false,
        kind: 'character-create-failed',
        animationId: definition.id,
        definitionName: definition.name,
        collection,
        message: '角色未能写入角色库，请重试。',
      };
    }
    return {
      ok: true,
      animationId: definition.id,
      characterId: createdCharacter.id,
      characterName: createdCharacter.name,
      partCount: createdCharacter.parts.length,
      autoPlacedCount,
      authorPosePlacedCount: authorPoseCount,
      savedLayoutPlacedCount: savedLayoutCount,
      autoPlacedOrigin,
      autoPlacedReferenceLabel,
      skipped: collection.skipped,
      warnings: collection.warnings,
    };
  } catch (error) {
    return {
      ok: false,
      kind: 'character-create-failed',
      animationId: definition.id,
      definitionName: definition.name,
      collection,
      message: error instanceof Error ? error.message : '角色创建失败，请重试。',
    };
  }
}
