import {
  isFlaGraphicDefinition,
  type Asset,
  type Character,
  type CharacterAction,
  type CharacterBodyPose,
  type CharacterExpression,
  type CharacterMotionMapping,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  type MouthPoseSet,
  type Project,
  type ProjectAnimationDefinition,
  type VoiceProfile,
} from '../models';
import type { ProjectResourceImportClosure } from './ProjectResourceImportPlanner';

export type ProjectResourceReuseKind = 'character' | 'animation';

export interface ProjectResourceReuseSelection {
  readonly kind: ProjectResourceReuseKind;
  readonly sourceId: string;
  readonly targetId: string;
}

export interface ProjectResourceReusableDefinition {
  readonly kind: ProjectResourceReuseKind;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly partIdMap?: Readonly<Record<string, string>>;
  readonly actionIdMap?: Readonly<Record<string, string>>;
  readonly voiceProfileId?: string;
  readonly dependencyAnimationIds: readonly string[];
  readonly dependencyAssetIds: readonly string[];
}

export type ProjectResourceReuseDiagnosticCode =
  | 'TARGET_MODIFIED'
  | 'SOURCE_OR_DEPENDENCY_CHANGED'
  | 'INTERNAL_IDENTITY_AMBIGUOUS'
  | 'MULTIPLE_TARGET_CANDIDATES'
  | 'NAME_ONLY_MATCH'
  | 'DISK_ASSET_UNVERIFIED';

export interface ProjectResourceReuseDiagnostic {
  readonly kind: ProjectResourceReuseKind;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly code: ProjectResourceReuseDiagnosticCode;
  readonly reason: string;
}

export interface ProjectResourceReuseAnalysis {
  readonly reusableDefinitions: readonly ProjectResourceReusableDefinition[];
  readonly diagnostics: readonly ProjectResourceReuseDiagnostic[];
  /** Compatible reusable animations indexed by sourceAnimationId. */
  readonly reusableAnimationBySourceId: ReadonlyMap<
    string,
    ProjectResourceReusableDefinition
  >;
  /** Compatible reusable characters indexed by sourceCharacterId. */
  readonly reusableCharacterBySourceId: ReadonlyMap<
    string,
    ProjectResourceReusableDefinition
  >;
  /**
   * Required target asset IDs for each reusable definition, indexed by
   * `${kind}:${sourceId}:${targetId}`, so Main can verify actual on-disk files
   * for reused definitions before committing reuse.
   */
  readonly requiredTargetAssetPairsByCandidate: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly sourceAssetId: string; readonly targetAssetId: string }>
  >;
}

export interface ResolvedDefinitionReusePlan {
  readonly reusedAnimations: ReadonlyMap<string, ProjectResourceReusableDefinition>;
  readonly reusedCharacters: ReadonlyMap<string, ProjectResourceReusableDefinition>;
  /** Any requested reuse choices that were rejected because the candidate is not compatible. */
  readonly rejectedChoices: readonly ProjectResourceReuseSelection[];
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function stableJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== typeof right ||
    left === null ||
    right === null ||
    typeof left !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!stableJsonEqual(left[i], right[i])) return false;
    }
    return true;
  }
  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObj).filter((k) => leftObj[k] !== undefined);
  const rightKeys = Object.keys(rightObj).filter(
    (k) => rightObj[k] !== undefined,
  );
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in rightObj)) return false;
    if (!stableJsonEqual(leftObj[key], rightObj[key])) return false;
  }
  return true;
}

interface AssetCompatibilityChecker {
  check(
    sourceAssetId: string,
    targetAssetId: string,
    options?: {
      readonly allowFlaGraphicFrameForTargetAnimationId?: string;
    },
  ): { ok: true } | { ok: false; code: ProjectResourceReuseDiagnosticCode };
}

function createAssetCompatibilityChecker(
  sourceProject: Project,
  targetProject: Project,
  verifiedAssetMatches?: ReadonlyMap<string, ReadonlySet<string>>,
): AssetCompatibilityChecker {
  const sourceById = new Map(sourceProject.assets.map((a) => [a.id, a]));
  const targetById = new Map(targetProject.assets.map((a) => [a.id, a]));

  return {
    check(sourceAssetId, targetAssetId, options) {
      const sourceAsset = sourceById.get(sourceAssetId);
      const targetAsset = targetById.get(targetAssetId);
      if (!sourceAsset || !targetAsset) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (sourceAsset.kind !== targetAsset.kind) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (!sourceAsset.sha256 || !targetAsset.sha256) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (sourceAsset.sha256 !== targetAsset.sha256) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (
        sourceAsset.mimeType.trim().toLowerCase() !==
        targetAsset.mimeType.trim().toLowerCase()
      ) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (sourceAsset.kind === 'image' && targetAsset.kind === 'image') {
        if (
          sourceAsset.width !== targetAsset.width ||
          sourceAsset.height !== targetAsset.height
        ) {
          return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
        }
        const expectedAnimId = options?.allowFlaGraphicFrameForTargetAnimationId;
        if (sourceAsset.flaGraphicFrame || targetAsset.flaGraphicFrame) {
          if (
            !expectedAnimId ||
            !sourceAsset.flaGraphicFrame ||
            !targetAsset.flaGraphicFrame ||
            targetAsset.flaGraphicFrame.definitionId !== expectedAnimId ||
            sourceAsset.flaGraphicFrame.ordinal !==
              targetAsset.flaGraphicFrame.ordinal
          ) {
            return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
          }
        }
      }
      if (verifiedAssetMatches) {
        if (!verifiedAssetMatches.get(sourceAssetId)?.has(targetAssetId)) {
          return { ok: false, code: 'DISK_ASSET_UNVERIFIED' };
        }
      }
      return { ok: true };
    },
  };
}

function recordPair(
  pairs: Map<string, string>,
  sourceId: string,
  targetId: string,
): boolean {
  const existing = pairs.get(sourceId);
  if (existing !== undefined) return existing === targetId;
  pairs.set(sourceId, targetId);
  return true;
}

function compareStructureNodes(
  sourceNodes: readonly FlaGraphicStructureNode[],
  targetNodes: readonly FlaGraphicStructureNode[],
  assetChecker: AssetCompatibilityChecker,
  assetPairs: Map<string, string>,
  targetAnimationId: string,
): { ok: true } | { ok: false; code: ProjectResourceReuseDiagnosticCode } {
  if (sourceNodes.length !== targetNodes.length) {
    return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
  }
  for (let i = 0; i < sourceNodes.length; i += 1) {
    const src = sourceNodes[i]!;
    const tgt = targetNodes[i]!;
    if (src.type !== tgt.type) {
      return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
    }
    if (src.type === 'bitmap' && tgt.type === 'bitmap') {
      const { assetId: srcAssetId, ...srcRest } = src;
      const { assetId: tgtAssetId, ...tgtRest } = tgt;
      if (!stableJsonEqual(srcRest, tgtRest)) {
        return { ok: false, code: 'TARGET_MODIFIED' };
      }
      if (Boolean(srcAssetId) !== Boolean(tgtAssetId)) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (srcAssetId && tgtAssetId) {
        const res = assetChecker.check(srcAssetId, tgtAssetId, {
          allowFlaGraphicFrameForTargetAnimationId: targetAnimationId,
        });
        if (!res.ok) return res;
        if (!recordPair(assetPairs, srcAssetId, tgtAssetId)) {
          return { ok: false, code: 'INTERNAL_IDENTITY_AMBIGUOUS' };
        }
      }
      continue;
    }
    if (src.type === 'opaque' && tgt.type === 'opaque') {
      const { fallbackAssetId: srcFallback, ...srcRest } = src;
      const { fallbackAssetId: tgtFallback, ...tgtRest } = tgt;
      if (!stableJsonEqual(srcRest, tgtRest)) {
        return { ok: false, code: 'TARGET_MODIFIED' };
      }
      if (Boolean(srcFallback) !== Boolean(tgtFallback)) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (srcFallback && tgtFallback) {
        const res = assetChecker.check(srcFallback, tgtFallback, {
          allowFlaGraphicFrameForTargetAnimationId: targetAnimationId,
        });
        if (!res.ok) return res;
        if (!recordPair(assetPairs, srcFallback, tgtFallback)) {
          return { ok: false, code: 'INTERNAL_IDENTITY_AMBIGUOUS' };
        }
      }
      continue;
    }
    if (src.type === 'group' && tgt.type === 'group') {
      const { children: srcChildren, ...srcRest } = src;
      const { children: tgtChildren, ...tgtRest } = tgt;
      if (!stableJsonEqual(srcRest, tgtRest)) {
        return { ok: false, code: 'TARGET_MODIFIED' };
      }
      const childRes = compareStructureNodes(
        srcChildren,
        tgtChildren,
        assetChecker,
        assetPairs,
        targetAnimationId,
      );
      if (!childRes.ok) return childRes;
      continue;
    }
    if (src.type === 'symbol' && tgt.type === 'symbol') {
      const { children: srcChildren, ...srcRest } = src;
      const { children: tgtChildren, ...tgtRest } = tgt;
      if (!stableJsonEqual(srcRest, tgtRest)) {
        return { ok: false, code: 'TARGET_MODIFIED' };
      }
      if (Boolean(srcChildren) !== Boolean(tgtChildren)) {
        return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
      }
      if (srcChildren && tgtChildren) {
        const childRes = compareStructureNodes(
          srcChildren,
          tgtChildren,
          assetChecker,
          assetPairs,
          targetAnimationId,
        );
        if (!childRes.ok) return childRes;
      }
      continue;
    }
    if (!stableJsonEqual(src, tgt)) {
      return { ok: false, code: 'TARGET_MODIFIED' };
    }
  }
  return { ok: true };
}

function compareFlaGraphicStructure(
  src: FlaGraphicStructure | undefined,
  tgt: FlaGraphicStructure | undefined,
  assetChecker: AssetCompatibilityChecker,
  assetPairs: Map<string, string>,
  targetAnimationId: string,
): { ok: true } | { ok: false; code: ProjectResourceReuseDiagnosticCode } {
  if (!src && !tgt) return { ok: true };
  if (!src || !tgt) return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
  if (src.version !== tgt.version) {
    return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
  }
  if (src.frames.length !== tgt.frames.length) {
    return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
  }
  for (let i = 0; i < src.frames.length; i += 1) {
    const sf = src.frames[i]!;
    const tf = tgt.frames[i]!;
    if (sf.ordinal !== tf.ordinal || sf.layers.length !== tf.layers.length) {
      return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
    }
    for (let j = 0; j < sf.layers.length; j += 1) {
      const sl = sf.layers[j]!;
      const tl = tf.layers[j]!;
      if (sl.name !== tl.name) {
        return { ok: false, code: 'TARGET_MODIFIED' };
      }
      const res = compareStructureNodes(
        sl.nodes,
        tl.nodes,
        assetChecker,
        assetPairs,
        targetAnimationId,
      );
      if (!res.ok) return res;
    }
  }
  const srcDefs = src.symbolDefinitions ?? {};
  const tgtDefs = tgt.symbolDefinitions ?? {};
  const srcKeys = Object.keys(srcDefs).sort();
  const tgtKeys = Object.keys(tgtDefs).sort();
  if (!stableJsonEqual(srcKeys, tgtKeys)) {
    return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
  }
  for (const key of srcKeys) {
    const sd = srcDefs[key]!;
    const td = tgtDefs[key]!;
    if (sd.symbolRef !== td.symbolRef) {
      return { ok: false, code: 'SOURCE_OR_DEPENDENCY_CHANGED' };
    }
    const res = compareStructureNodes(
      sd.children,
      td.children,
      assetChecker,
      assetPairs,
      targetAnimationId,
    );
    if (!res.ok) return res;
  }
  return { ok: true };
}

function evaluateAnimationCompatibility(
  sourceAnim: ProjectAnimationDefinition,
  targetAnim: ProjectAnimationDefinition,
  sourceAssetsById: ReadonlyMap<string, Asset>,
  targetAssetsById: ReadonlyMap<string, Asset>,
  assetChecker: AssetCompatibilityChecker,
):
  | { ok: true; assetPairs: Map<string, string> }
  | { ok: false; code: ProjectResourceReuseDiagnosticCode; reason: string } {
  const isSrcGraphic = isFlaGraphicDefinition(sourceAnim);
  const isTgtGraphic = isFlaGraphicDefinition(targetAnim);
  if (isSrcGraphic !== isTgtGraphic) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '目标动画类型与来源不一致，将复制为独立定义。',
    };
  }
  if (
    targetAnim.importProvenance?.importedName !== undefined &&
    targetAnim.name !== targetAnim.importProvenance.importedName
  ) {
    return {
      ok: false,
      code: 'TARGET_MODIFIED',
      reason: '目标动画已在当前工程中被重命名或修改，将复制为独立定义。',
    };
  }
  if (
    sourceAnim.durationMs !== targetAnim.durationMs ||
    !stableJsonEqual(sourceAnim.source, targetAnim.source)
  ) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '动画元数据或时长已变化，将复制为独立定义。',
    };
  }
  if (sourceAnim.frames.length !== targetAnim.frames.length) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '动画帧数已变化，将复制为独立定义。',
    };
  }

  const assetPairs = new Map<string, string>();
  for (let i = 0; i < sourceAnim.frames.length; i += 1) {
    const sf = sourceAnim.frames[i]!;
    const tf = targetAnim.frames[i]!;
    const { assetId: srcAssetId, ...srcRest } = sf;
    const { assetId: tgtAssetId, ...tgtRest } = tf;
    if (!stableJsonEqual(srcRest, tgtRest)) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '动画帧定义已变化，将复制为独立定义。',
      };
    }
    const srcHasAsset = sourceAssetsById.has(srcAssetId);
    const tgtHasAsset = targetAssetsById.has(tgtAssetId);
    if (srcHasAsset !== tgtHasAsset) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '动画依赖的帧素材已变化，将复制为独立定义。',
      };
    }
    if (srcHasAsset) {
      const check = assetChecker.check(srcAssetId, tgtAssetId, {
        allowFlaGraphicFrameForTargetAnimationId: isTgtGraphic
          ? targetAnim.id
          : undefined,
      });
      if (!check.ok) {
        return {
          ok: false,
          code: check.code,
          reason:
            check.code === 'DISK_ASSET_UNVERIFIED'
              ? '目标动画依赖的磁盘素材文件缺失或已变更，无法安全复用，将复制为独立定义。'
              : '动画依赖的素材内容已变化，将复制为独立定义。',
        };
      }
      if (!recordPair(assetPairs, srcAssetId, tgtAssetId)) {
        return {
          ok: false,
          code: 'INTERNAL_IDENTITY_AMBIGUOUS',
          reason: '动画内部素材引用对应关系不唯一，将复制为独立定义。',
        };
      }
    }
  }

  if (isSrcGraphic && isTgtGraphic) {
    if (
      !stableJsonEqual(
        sourceAnim.sourceFrameLabels,
        targetAnim.sourceFrameLabels,
      )
    ) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: 'Graphic 帧标签已变化，将复制为独立定义。',
      };
    }
    if (
      !stableJsonEqual(
        sourceAnim.flaGraphicSharedShapeOverrides,
        targetAnim.flaGraphicSharedShapeOverrides,
      )
    ) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '目标 Graphic 的矢量覆盖已被独立精修，将复制为独立定义。',
      };
    }
    const structureRes = compareFlaGraphicStructure(
      sourceAnim.structure,
      targetAnim.structure,
      assetChecker,
      assetPairs,
      targetAnim.id,
    );
    if (!structureRes.ok) {
      return {
        ok: false,
        code: structureRes.code,
        reason:
          structureRes.code === 'DISK_ASSET_UNVERIFIED'
            ? '目标 Graphic 依赖的磁盘素材未通过校验，将复制为独立定义。'
            : 'Graphic 结构或依赖素材已变化，将复制为独立定义。',
      };
    }
  }

  return { ok: true, assetPairs };
}

function compareVoiceProfile(
  src: VoiceProfile | undefined,
  tgt: VoiceProfile | undefined,
  targetCharacterId: string,
): boolean {
  if (!src || !tgt) return false;
  if (tgt.characterId !== targetCharacterId) return false;
  return (
    src.name === tgt.name &&
    src.locale === tgt.locale &&
    src.rate === tgt.rate &&
    src.pitch === tgt.pitch
  );
}

function validateBijectiveIdMap(
  sourceIds: readonly string[],
  targetIds: readonly string[],
  recordedMap: Readonly<Record<string, string>> | undefined,
): Map<string, string> | null {
  if (sourceIds.length !== targetIds.length) return null;
  if (sourceIds.length === 0) return new Map();
  if (!recordedMap) return null;
  const targetIdSet = new Set(targetIds);
  const usedTargetIds = new Set<string>();
  const map = new Map<string, string>();
  for (const srcId of sourceIds) {
    const tgtId = recordedMap[srcId];
    if (!tgtId || !targetIdSet.has(tgtId) || usedTargetIds.has(tgtId)) {
      return null;
    }
    usedTargetIds.add(tgtId);
    map.set(srcId, tgtId);
  }
  return map;
}

function compareExpressions(
  srcExprs: readonly CharacterExpression[] | undefined,
  tgtExprs: readonly CharacterExpression[] | undefined,
  checkAsset: (srcId: string, tgtId: string) => boolean,
  checkAnim: (srcId: string, tgtId: string) => boolean,
): Map<string, string> | null {
  const s = srcExprs ?? [];
  const t = tgtExprs ?? [];
  if (s.length !== t.length) return null;
  const exprMap = new Map<string, string>();
  for (let i = 0; i < s.length; i += 1) {
    const se = s[i]!;
    const te = t[i]!;
    if (se.name !== te.name) return null;
    if (Boolean(se.assetId) !== Boolean(te.assetId)) return null;
    if (se.assetId && te.assetId && !checkAsset(se.assetId, te.assetId)) {
      return null;
    }
    if (Boolean(se.visualSource) !== Boolean(te.visualSource)) return null;
    if (se.visualSource && te.visualSource) {
      const { animationId: sa, ...sRest } = se.visualSource;
      const { animationId: ta, ...tRest } = te.visualSource;
      if (!stableJsonEqual(sRest, tRest) || !checkAnim(sa, ta)) return null;
    }
    exprMap.set(se.id, te.id);
  }
  return exprMap;
}

function compareMouthPoseSet(
  src: MouthPoseSet | undefined,
  tgt: MouthPoseSet | undefined,
  checkAsset: (srcId: string, tgtId: string) => boolean,
  checkAnim: (srcId: string, tgtId: string) => boolean,
  partIdMap: ReadonlyMap<string, string>,
): boolean {
  if (!src && !tgt) return true;
  if (!src || !tgt) return false;
  if (src.poses.length !== tgt.poses.length) return false;
  const poseIdMap = new Map<string, string>();
  for (let i = 0; i < src.poses.length; i += 1) {
    const sp = src.poses[i]!;
    const tp = tgt.poses[i]!;
    if (sp.name !== tp.name) return false;
    if (sp.source.kind !== tp.source.kind) return false;
    if (sp.source.kind === 'image' && tp.source.kind === 'image') {
      const { assetId: sa, ...sRest } = sp.source;
      const { assetId: ta, ...tRest } = tp.source;
      if (!stableJsonEqual(sRest, tRest) || !checkAsset(sa, ta)) return false;
    } else if (
      sp.source.kind !== 'image' &&
      tp.source.kind !== 'image'
    ) {
      const { animationId: sa, ...sRest } = sp.source;
      const { animationId: ta, ...tRest } = tp.source;
      if (!stableJsonEqual(sRest, tRest) || !checkAnim(sa, ta)) return false;
    }
    if (sp.target.kind !== tp.target.kind) return false;
    if (sp.target.kind === 'mouth' && tp.target.kind === 'mouth') {
      if (partIdMap.get(sp.target.partId) !== tp.target.partId) return false;
    }
    poseIdMap.set(sp.id, tp.id);
  }
  if (poseIdMap.get(src.restPoseId) !== tgt.restPoseId) return false;
  for (const key of ['rest', 'open', 'wide', 'round', 'closed'] as const) {
    if (poseIdMap.get(src.analyzerMapping[key]) !== tgt.analyzerMapping[key]) {
      return false;
    }
  }
  return true;
}

function compareActions(
  srcActions: readonly CharacterAction[] | undefined,
  tgtActions: readonly CharacterAction[] | undefined,
  actionIdMap: ReadonlyMap<string, string>,
  partIdMap: ReadonlyMap<string, string>,
  checkAnim: (srcId: string, tgtId: string) => boolean,
): boolean {
  const s = srcActions ?? [];
  const t = tgtActions ?? [];
  if (s.length !== t.length) return false;
  const tgtById = new Map(t.map((a) => [a.id, a]));
  for (const sa of s) {
    const mappedId = actionIdMap.get(sa.id);
    if (!mappedId) return false;
    const ta = tgtById.get(mappedId);
    if (!ta) return false;
    if ('kind' in sa !== 'kind' in ta) return false;
    if ('kind' in sa && 'kind' in ta) {
      const {
        id: _sid,
        tracks: sTracks,
        headAnchorPartId: sHead,
        partPivotOffsets: sPivots,
        ...sRest
      } = sa;
      const {
        id: _tid,
        tracks: tTracks,
        headAnchorPartId: tHead,
        partPivotOffsets: tPivots,
        ...tRest
      } = ta;
      void _sid;
      void _tid;
      if (!stableJsonEqual(sRest, tRest)) return false;
      if (Boolean(sHead) !== Boolean(tHead)) return false;
      if (sHead && partIdMap.get(sHead) !== tHead) return false;
      if (sTracks.length !== tTracks.length) return false;
      for (let i = 0; i < sTracks.length; i += 1) {
        const st = sTracks[i]!;
        const tt = tTracks[i]!;
        const { partId: sp, ...stRest } = st;
        const { partId: tp, ...ttRest } = tt;
        if (partIdMap.get(sp) !== tp || !stableJsonEqual(stRest, ttRest)) {
          return false;
        }
      }
      const spArr = sPivots ?? [];
      const tpArr = tPivots ?? [];
      if (spArr.length !== tpArr.length) return false;
      for (let i = 0; i < spArr.length; i += 1) {
        const sp = spArr[i]!;
        const tp = tpArr[i]!;
        if (
          partIdMap.get(sp.partId) !== tp.partId ||
          !stableJsonEqual(sp.offset, tp.offset)
        ) {
          return false;
        }
      }
    } else if (!('kind' in sa) && !('kind' in ta)) {
      const { id: _sid, animationId: sAnim, ...sRest } = sa;
      const { id: _tid, animationId: tAnim, ...tRest } = ta;
      void _sid;
      void _tid;
      if (!stableJsonEqual(sRest, tRest) || !checkAnim(sAnim, tAnim)) {
        return false;
      }
    }
  }
  return true;
}

function compareBodyPoses(
  srcPoses: readonly CharacterBodyPose[] | undefined,
  tgtPoses: readonly CharacterBodyPose[] | undefined,
  partIdMap: ReadonlyMap<string, string>,
): boolean {
  const s = srcPoses ?? [];
  const t = tgtPoses ?? [];
  if (s.length !== t.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    const sp = s[i]!;
    const tp = t[i]!;
    if (sp.name !== tp.name || sp.parts.length !== tp.parts.length) return false;
    for (let j = 0; j < sp.parts.length; j += 1) {
      const spe = sp.parts[j]!;
      const tpe = tp.parts[j]!;
      const { partId: sPart, ...sRest } = spe;
      const { partId: tPart, ...tRest } = tpe;
      if (partIdMap.get(sPart) !== tPart || !stableJsonEqual(sRest, tRest)) {
        return false;
      }
    }
  }
  return true;
}

function compareMotionMappings(
  srcMappings: readonly CharacterMotionMapping[] | undefined,
  tgtMappings: readonly CharacterMotionMapping[] | undefined,
  sourceProject: Project,
  targetProject: Project,
  partIdMap: ReadonlyMap<string, string>,
  actionIdMap: ReadonlyMap<string, string>,
  inBatchSourceCharacterIds: ReadonlySet<string>,
): boolean {
  const s = srcMappings ?? [];
  const t = tgtMappings ?? [];
  // Filter source mappings to those that would survive in this batch vs already persisted in target.
  const expectedSource = s.filter((m) =>
    inBatchSourceCharacterIds.has(m.sourceCharacterId),
  );
  if (expectedSource.length === 0 && t.length === 0) return true;
  if (expectedSource.length !== t.length) return false;

  const targetCharById = new Map(targetProject.characters.map((c) => [c.id, c]));
  for (let i = 0; i < expectedSource.length; i += 1) {
    const sm = expectedSource[i]!;
    const tm = t[i]!;
    const tgtSrcChar = targetCharById.get(tm.sourceCharacterId);
    if (
      !tgtSrcChar ||
      tgtSrcChar.importProvenance?.sourceProjectId !== sourceProject.id ||
      tgtSrcChar.importProvenance?.sourceDefinitionId !== sm.sourceCharacterId
    ) {
      return false;
    }
    const srcCharActionMap = tgtSrcChar.importProvenance.actionIdMap;
    const srcCharPartMap = tgtSrcChar.importProvenance.partIdMap;
    if (
      srcCharActionMap?.[sm.sourceActionId] !== tm.sourceActionId ||
      actionIdMap.get(sm.generatedActionId) !== tm.generatedActionId
    ) {
      return false;
    }
    if (sm.rules.length !== tm.rules.length) return false;
    for (let r = 0; r < sm.rules.length; r += 1) {
      const sr = sm.rules[r]!;
      const tr = tm.rules[r]!;
      if (srcCharPartMap?.[sr.sourcePartId] !== tr.sourcePartId) return false;
      if (Boolean(sr.targetPartId) !== Boolean(tr.targetPartId)) return false;
      if (sr.targetPartId && partIdMap.get(sr.targetPartId) !== tr.targetPartId) {
        return false;
      }
      const { sourcePartId: _sp, targetPartId: _tp, ...sRest } = sr;
      const { sourcePartId: _tsp, targetPartId: _ttp, ...tRest } = tr;
      void _sp;
      void _tp;
      void _tsp;
      void _ttp;
      if (!stableJsonEqual(sRest, tRest)) return false;
    }
  }
  return true;
}

function evaluateCharacterCompatibility(options: {
  sourceChar: Character;
  targetChar: Character;
  sourceProject: Project;
  targetProject: Project;
  assetChecker: AssetCompatibilityChecker;
  compatibleAnimTargetIdsBySourceId: ReadonlyMap<string, ReadonlySet<string>>;
  inBatchSourceCharacterIds: ReadonlySet<string>;
}):
  | {
      ok: true;
      partIdMap?: Record<string, string>;
      actionIdMap?: Record<string, string>;
      dependencyAnimationIds: string[];
      assetPairs: Map<string, string>;
    }
  | { ok: false; code: ProjectResourceReuseDiagnosticCode; reason: string } {
  const {
    sourceChar,
    targetChar,
    sourceProject,
    targetProject,
    assetChecker,
    compatibleAnimTargetIdsBySourceId,
    inBatchSourceCharacterIds,
  } = options;

  if (sourceChar.mode !== targetChar.mode) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色结构模式已变化，将复制为独立定义。',
    };
  }
  if (
    targetChar.importProvenance?.importedName !== undefined &&
    targetChar.name !== targetChar.importProvenance.importedName
  ) {
    return {
      ok: false,
      code: 'TARGET_MODIFIED',
      reason: '目标角色已在当前工程中被重命名或修改，将复制为独立定义。',
    };
  }
  const srcHeadMotion =
    'talkingHeadMotionIntensityPercent' in sourceChar
      ? sourceChar.talkingHeadMotionIntensityPercent
      : undefined;
  const tgtHeadMotion =
    'talkingHeadMotionIntensityPercent' in targetChar
      ? targetChar.talkingHeadMotionIntensityPercent
      : undefined;
  if (
    sourceChar.defaultScale !== targetChar.defaultScale ||
    sourceChar.defaultFlipX !== targetChar.defaultFlipX ||
    srcHeadMotion !== tgtHeadMotion
  ) {
    return {
      ok: false,
      code: 'TARGET_MODIFIED',
      reason: '角色默认缩放、翻转或口型头部摆动设置已变化，将复制为独立定义。',
    };
  }

  const srcVoice = sourceProject.voiceProfiles.find(
    (v) => v.id === sourceChar.defaultVoiceProfileId,
  );
  const tgtVoice = targetProject.voiceProfiles.find(
    (v) => v.id === targetChar.defaultVoiceProfileId,
  );
  if (!compareVoiceProfile(srcVoice, tgtVoice, targetChar.id)) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色配音档案已变化，将复制为独立定义。',
    };
  }

  const assetPairs = new Map<string, string>();
  const dependencyAnimationIds = new Set<string>();
  let firstAssetFailureCode: ProjectResourceReuseDiagnosticCode | null = null;
  let animDependencyFailed = false;

  const checkAsset = (srcId: string, tgtId: string): boolean => {
    const res = assetChecker.check(srcId, tgtId);
    if (!res.ok) {
      firstAssetFailureCode ??= res.code;
      return false;
    }
    if (!recordPair(assetPairs, srcId, tgtId)) {
      firstAssetFailureCode ??= 'INTERNAL_IDENTITY_AMBIGUOUS';
      return false;
    }
    return true;
  };

  const checkAnim = (srcAnimId: string, tgtAnimId: string): boolean => {
    dependencyAnimationIds.add(srcAnimId);
    const compatibleTargets = compatibleAnimTargetIdsBySourceId.get(srcAnimId);
    if (!compatibleTargets || !compatibleTargets.has(tgtAnimId)) {
      animDependencyFailed = true;
      return false;
    }
    return true;
  };

  // Validate internal action ID bijection first.
  const actionIdMap = validateBijectiveIdMap(
    (sourceChar.actions ?? []).map((a) => a.id),
    (targetChar.actions ?? []).map((a) => a.id),
    targetChar.importProvenance?.actionIdMap,
  );
  if (!actionIdMap) {
    return {
      ok: false,
      code: 'INTERNAL_IDENTITY_AMBIGUOUS',
      reason: '角色内部动作身份对应不明确或动作数量已变化，将复制为独立定义。',
    };
  }

  let partIdMap = new Map<string, string>();

  if (sourceChar.mode === 'adaptive-parts' && targetChar.mode === 'adaptive-parts') {
    const validatedParts = validateBijectiveIdMap(
      sourceChar.parts.map((p) => p.partId),
      targetChar.parts.map((p) => p.partId),
      targetChar.importProvenance?.partIdMap,
    );
    if (!validatedParts) {
      return {
        ok: false,
        code: 'INTERNAL_IDENTITY_AMBIGUOUS',
        reason: '分件角色内部部件身份对应不明确或部件数量已变化，将复制为独立定义。',
      };
    }
    partIdMap = validatedParts;

    if (
      !stableJsonEqual(
        sourceChar.sourceRootTransform,
        targetChar.sourceRootTransform,
      )
    ) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '分件角色根变换已变化，将复制为独立定义。',
      };
    }

    const tgtPartById = new Map(targetChar.parts.map((p) => [p.partId, p]));
    for (const sp of sourceChar.parts) {
      const mappedPartId = partIdMap.get(sp.partId)!;
      const tp = tgtPartById.get(mappedPartId)!;
      const {
        partId: _spid,
        assetId: sAssetId,
        visualSource: sVisual,
        ...sRest
      } = sp;
      const {
        partId: _tpid,
        assetId: tAssetId,
        visualSource: tVisual,
        ...tRest
      } = tp;
      void _spid;
      void _tpid;
      if (!stableJsonEqual(sRest, tRest)) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: `角色部件“${sp.displayName ?? sp.partId}”已被独立修改，将复制为独立定义。`,
        };
      }
      if (Boolean(sAssetId) !== Boolean(tAssetId)) {
        return {
          ok: false,
          code: 'SOURCE_OR_DEPENDENCY_CHANGED',
          reason: '角色部件素材引用已变化，将复制为独立定义。',
        };
      }
      if (sAssetId && tAssetId && !checkAsset(sAssetId, tAssetId)) {
        return {
          ok: false,
          code: firstAssetFailureCode ?? 'SOURCE_OR_DEPENDENCY_CHANGED',
          reason:
            firstAssetFailureCode === 'DISK_ASSET_UNVERIFIED'
              ? '目标角色部件依赖的磁盘素材未通过校验，将复制为独立定义。'
              : '角色部件依赖的素材内容已变化，将复制为独立定义。',
        };
      }
      if (Boolean(sVisual) !== Boolean(tVisual)) {
        return {
          ok: false,
          code: 'SOURCE_OR_DEPENDENCY_CHANGED',
          reason: '角色部件视觉来源已变化，将复制为独立定义。',
        };
      }
      if (sVisual && tVisual) {
        if (sVisual.kind !== tVisual.kind) {
          return {
            ok: false,
            code: 'SOURCE_OR_DEPENDENCY_CHANGED',
            reason: '角色部件视觉来源类型已变化，将复制为独立定义。',
          };
        }
        if (sVisual.kind === 'image' && tVisual.kind === 'image') {
          const { assetId: sa, ...svRest } = sVisual;
          const { assetId: ta, ...tvRest } = tVisual;
          if (!stableJsonEqual(svRest, tvRest) || !checkAsset(sa, ta)) {
            return {
              ok: false,
              code: firstAssetFailureCode ?? 'SOURCE_OR_DEPENDENCY_CHANGED',
              reason: '角色部件图片映射或素材内容已变化，将复制为独立定义。',
            };
          }
        } else if (sVisual.kind !== 'image' && tVisual.kind !== 'image') {
          const { animationId: sa, ...svRest } = sVisual;
          const { animationId: ta, ...tvRest } = tVisual;
          if (!stableJsonEqual(svRest, tvRest) || !checkAnim(sa, ta)) {
            return {
              ok: false,
              code: 'SOURCE_OR_DEPENDENCY_CHANGED',
              reason: '角色部件依赖的 Graphic/动画不兼容或已变化，将复制为独立定义。',
            };
          }
        }
      }
    }

    // faceBinding
    if (Boolean(sourceChar.faceBinding) !== Boolean(targetChar.faceBinding)) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '角色面部绑定已变化，将复制为独立定义。',
      };
    }
    if (sourceChar.faceBinding && targetChar.faceBinding) {
      const {
        targetPartId: sTgt,
        replacePartIds: sRep,
        ...sFbRest
      } = sourceChar.faceBinding;
      const {
        targetPartId: tTgt,
        replacePartIds: tRep,
        ...tFbRest
      } = targetChar.faceBinding;
      if (
        partIdMap.get(sTgt) !== tTgt ||
        !stableJsonEqual(
          sRep.map((id) => partIdMap.get(id)),
          tRep,
        ) ||
        !stableJsonEqual(sFbRest, tFbRest)
      ) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: '角色面部绑定参数已变化，将复制为独立定义。',
        };
      }
    }

    // headMotionBinding
    if (
      Boolean(sourceChar.headMotionBinding) !==
      Boolean(targetChar.headMotionBinding)
    ) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '角色头部运动绑定已变化，将复制为独立定义。',
      };
    }
    if (sourceChar.headMotionBinding && targetChar.headMotionBinding) {
      if (
        !stableJsonEqual(
          sourceChar.headMotionBinding.partIds.map((id) => partIdMap.get(id)),
          targetChar.headMotionBinding.partIds,
        )
      ) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: '角色头部运动绑定部件已变化，将复制为独立定义。',
        };
      }
    }

    // armChain
    if (Boolean(sourceChar.armChain) !== Boolean(targetChar.armChain)) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '角色手臂链配置已变化，将复制为独立定义。',
      };
    }
    if (sourceChar.armChain && targetChar.armChain) {
      const { segments: sSegs, ...sArmRest } = sourceChar.armChain;
      const { segments: tSegs, ...tArmRest } = targetChar.armChain;
      if (
        !stableJsonEqual(sArmRest, tArmRest) ||
        sSegs.length !== tSegs.length
      ) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: '角色手臂链配置已变化，将复制为独立定义。',
        };
      }
      for (let i = 0; i < sSegs.length; i += 1) {
        const ss = sSegs[i]!;
        const ts = tSegs[i]!;
        const { partId: sp, ...sSegRest } = ss;
        const { partId: tp, ...tSegRest } = ts;
        if (
          partIdMap.get(sp) !== tp ||
          !stableJsonEqual(sSegRest, tSegRest)
        ) {
          return {
            ok: false,
            code: 'TARGET_MODIFIED',
            reason: '角色手臂链部件已变化，将复制为独立定义。',
          };
        }
      }
    }

    // bodyPoses
    if (!compareBodyPoses(sourceChar.bodyPoses, targetChar.bodyPoses, partIdMap)) {
      return {
        ok: false,
        code: 'TARGET_MODIFIED',
        reason: '角色身体姿势库已变化，将复制为独立定义。',
      };
    }

    // motionMappings
    if (
      !compareMotionMappings(
        sourceChar.motionMappings,
        targetChar.motionMappings,
        sourceProject,
        targetProject,
        partIdMap,
        actionIdMap,
        inBatchSourceCharacterIds,
      )
    ) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色跨角色动作映射依赖已变化，将复制为独立定义。',
      };
    }
  } else if (
    sourceChar.mode !== 'adaptive-parts' &&
    targetChar.mode !== 'adaptive-parts'
  ) {
    if (Boolean(sourceChar.baseAssetId) !== Boolean(targetChar.baseAssetId)) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色基础素材引用已变化，将复制为独立定义。',
      };
    }
    if (
      sourceChar.baseAssetId &&
      targetChar.baseAssetId &&
      !checkAsset(sourceChar.baseAssetId, targetChar.baseAssetId)
    ) {
      return {
        ok: false,
        code: firstAssetFailureCode ?? 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色基础素材内容已变化，将复制为独立定义。',
      };
    }
    if (sourceChar.mode === 'composite' && targetChar.mode === 'composite') {
      if (!checkAsset(sourceChar.bodyAssetId, targetChar.bodyAssetId)) {
        return {
          ok: false,
          code: firstAssetFailureCode ?? 'SOURCE_OR_DEPENDENCY_CHANGED',
          reason: '组合角色身体素材已变化，将复制为独立定义。',
        };
      }
      if (
        !stableJsonEqual(sourceChar.facePlacement, targetChar.facePlacement) ||
        !stableJsonEqual(sourceChar.bodyPlacement, targetChar.bodyPlacement)
      ) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: '组合角色布局参数已变化，将复制为独立定义。',
        };
      }
      if (Boolean(sourceChar.head) !== Boolean(targetChar.head)) {
        return {
          ok: false,
          code: 'TARGET_MODIFIED',
          reason: '组合角色头部配置已变化，将复制为独立定义。',
        };
      }
      if (sourceChar.head && targetChar.head) {
        const { assetId: sh, ...shRest } = sourceChar.head;
        const { assetId: th, ...thRest } = targetChar.head;
        if (!stableJsonEqual(shRest, thRest) || !checkAsset(sh, th)) {
          return {
            ok: false,
            code: firstAssetFailureCode ?? 'TARGET_MODIFIED',
            reason: '组合角色头部素材或参数已变化，将复制为独立定义。',
          };
        }
      }
    }
  }

  // Expressions & defaultExpressionId
  const expressionIdMap = compareExpressions(
    sourceChar.expressions,
    targetChar.expressions,
    checkAsset,
    checkAnim,
  );
  if (!expressionIdMap) {
    return {
      ok: false,
      code:
        firstAssetFailureCode ??
        (animDependencyFailed ? 'SOURCE_OR_DEPENDENCY_CHANGED' : 'TARGET_MODIFIED'),
      reason: '角色表情列表或依赖素材已变化，将复制为独立定义。',
    };
  }
  if (
    Boolean(sourceChar.defaultExpressionId) !==
    Boolean(targetChar.defaultExpressionId)
  ) {
    return {
      ok: false,
      code: 'TARGET_MODIFIED',
      reason: '角色默认表情已变化，将复制为独立定义。',
    };
  }
  if (
    sourceChar.defaultExpressionId &&
    expressionIdMap.get(sourceChar.defaultExpressionId) !==
      targetChar.defaultExpressionId
  ) {
    return {
      ok: false,
      code: 'TARGET_MODIFIED',
      reason: '角色默认表情已变化，将复制为独立定义。',
    };
  }

  // expressionTalkingSources
  const srcETS = sourceChar.expressionTalkingSources ?? {};
  const tgtETS = targetChar.expressionTalkingSources ?? {};
  const srcETSKeys = Object.keys(srcETS);
  const tgtETSKeys = Object.keys(tgtETS);
  if (srcETSKeys.length !== tgtETSKeys.length) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色表情说话动画配置已变化，将复制为独立定义。',
    };
  }
  for (const sExprId of srcETSKeys) {
    const tExprId = expressionIdMap.get(sExprId);
    if (!tExprId || !(tExprId in tgtETS)) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色表情说话动画配置已变化，将复制为独立定义。',
      };
    }
    const se = srcETS[sExprId]!;
    const te = tgtETS[tExprId]!;
    const { animationId: sa, ...sRest } = se;
    const { animationId: ta, ...tRest } = te;
    if (!stableJsonEqual(sRest, tRest) || !checkAnim(sa, ta)) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色表情说话动画依赖不兼容，将复制为独立定义。',
      };
    }
  }

  // talkingAnimationId
  if (
    Boolean(sourceChar.talkingAnimationId) !==
    Boolean(targetChar.talkingAnimationId)
  ) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色说话动画配置已变化，将复制为独立定义。',
    };
  }
  if (
    sourceChar.talkingAnimationId &&
    targetChar.talkingAnimationId &&
    !checkAnim(sourceChar.talkingAnimationId, targetChar.talkingAnimationId)
  ) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色说话动画依赖不兼容，将复制为独立定义。',
    };
  }

  // mouthOpenAssetId & mouthOpenVisualSource
  if (
    Boolean(sourceChar.mouthOpenAssetId) !== Boolean(targetChar.mouthOpenAssetId)
  ) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色张嘴素材已变化，将复制为独立定义。',
    };
  }
  if (
    sourceChar.mouthOpenAssetId &&
    targetChar.mouthOpenAssetId &&
    !checkAsset(sourceChar.mouthOpenAssetId, targetChar.mouthOpenAssetId)
  ) {
    return {
      ok: false,
      code: firstAssetFailureCode ?? 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色张嘴素材内容已变化，将复制为独立定义。',
    };
  }
  if (
    Boolean(sourceChar.mouthOpenVisualSource) !==
    Boolean(targetChar.mouthOpenVisualSource)
  ) {
    return {
      ok: false,
      code: 'SOURCE_OR_DEPENDENCY_CHANGED',
      reason: '角色张嘴动画来源已变化，将复制为独立定义。',
    };
  }
  if (sourceChar.mouthOpenVisualSource && targetChar.mouthOpenVisualSource) {
    const { animationId: sa, ...sRest } = sourceChar.mouthOpenVisualSource;
    const { animationId: ta, ...tRest } = targetChar.mouthOpenVisualSource;
    if (!stableJsonEqual(sRest, tRest) || !checkAnim(sa, ta)) {
      return {
        ok: false,
        code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        reason: '角色张嘴动画依赖不兼容，将复制为独立定义。',
      };
    }
  }

  // mouthPoseSet
  if (
    !compareMouthPoseSet(
      sourceChar.mouthPoseSet,
      targetChar.mouthPoseSet,
      checkAsset,
      checkAnim,
      partIdMap,
    )
  ) {
    return {
      ok: false,
      code:
        firstAssetFailureCode ??
        (animDependencyFailed ? 'SOURCE_OR_DEPENDENCY_CHANGED' : 'TARGET_MODIFIED'),
      reason: '角色口型集合或依赖素材已变化，将复制为独立定义。',
    };
  }

  // actions
  if (
    !compareActions(
      sourceChar.actions,
      targetChar.actions,
      actionIdMap,
      partIdMap,
      checkAnim,
    )
  ) {
    return {
      ok: false,
      code: animDependencyFailed ? 'SOURCE_OR_DEPENDENCY_CHANGED' : 'TARGET_MODIFIED',
      reason: '角色动作定义或依赖动画已变化，将复制为独立定义。',
    };
  }

  return {
    ok: true,
    ...(partIdMap.size > 0
      ? { partIdMap: Object.fromEntries(partIdMap.entries()) }
      : {}),
    ...(actionIdMap.size > 0
      ? { actionIdMap: Object.fromEntries(actionIdMap.entries()) }
      : {}),
    dependencyAnimationIds: [...dependencyAnimationIds],
    assetPairs,
  };
}

/**
 * Evaluates definition-level reuse compatibility across the actual dependency
 * closure of a cross-project import without scanning or hashing the whole project.
 *
 * Follows Blender append dependency semantics: if any required dependency
 * animation or asset is incompatible, the owning character is disqualified from
 * reuse and falls back to an independent copy.
 */
export function analyzeProjectResourceReuse(options: {
  sourceProject: Project;
  targetProject: Project;
  closure: ProjectResourceImportClosure;
  /** Optional Main-verified on-disk asset match map (`sourceAssetId -> Set<targetAssetId>`). */
  verifiedAssetMatches?: ReadonlyMap<string, ReadonlySet<string>>;
}): ProjectResourceReuseAnalysis {
  const { sourceProject, targetProject, closure, verifiedAssetMatches } = options;
  const sourceAssetsById = new Map(sourceProject.assets.map((a) => [a.id, a]));
  const targetAssetsById = new Map(targetProject.assets.map((a) => [a.id, a]));
  const assetChecker = createAssetCompatibilityChecker(
    sourceProject,
    targetProject,
    verifiedAssetMatches,
  );

  const reusableDefinitions: ProjectResourceReusableDefinition[] = [];
  const diagnostics: ProjectResourceReuseDiagnostic[] = [];
  const reusableAnimationBySourceId = new Map<
    string,
    ProjectResourceReusableDefinition
  >();
  const reusableCharacterBySourceId = new Map<
    string,
    ProjectResourceReusableDefinition
  >();
  const compatibleAnimTargetIdsBySourceId = new Map<string, Set<string>>();
  const requiredTargetAssetPairsByCandidate = new Map<
    string,
    Array<{ readonly sourceAssetId: string; readonly targetAssetId: string }>
  >();

  // Step 1: Evaluate all animations in the closure first (characters depend on animations).
  for (const sourceAnim of closure.animations) {
    const provenanceMatches = targetProject.animations.filter(
      (candidate) =>
        candidate.importProvenance?.sourceProjectId === sourceProject.id &&
        candidate.importProvenance?.sourceDefinitionId === sourceAnim.id,
    );

    if (provenanceMatches.length === 0) {
      const sameName = targetProject.animations.find(
        (candidate) =>
          normalizeName(candidate.name) === normalizeName(sourceAnim.name),
      );
      if (sameName) {
        diagnostics.push({
          kind: 'animation',
          sourceId: sourceAnim.id,
          sourceName: sourceAnim.name,
          targetId: sameName.id,
          targetName: sameName.name,
          code: 'NAME_ONLY_MATCH',
          reason: `目标工程存在同名 Graphic/动画“${sameName.name}”，但无同源记录，不能仅凭名称合并，将复制为独立定义。`,
        });
      }
      continue;
    }

    const compatible: Array<{
      targetAnim: ProjectAnimationDefinition;
      assetPairs: Map<string, string>;
    }> = [];
    let lastFailure: {
      targetAnim: ProjectAnimationDefinition;
      code: ProjectResourceReuseDiagnosticCode;
      reason: string;
    } | null = null;

    for (const targetAnim of provenanceMatches) {
      const res = evaluateAnimationCompatibility(
        sourceAnim,
        targetAnim,
        sourceAssetsById,
        targetAssetsById,
        assetChecker,
      );
      if (res.ok) {
        compatible.push({ targetAnim, assetPairs: res.assetPairs });
      } else {
        lastFailure = { targetAnim, code: res.code, reason: res.reason };
      }
    }

    if (compatible.length === 1) {
      const winner = compatible[0]!;
      const candidate: ProjectResourceReusableDefinition = {
        kind: 'animation',
        sourceId: sourceAnim.id,
        sourceName: sourceAnim.name,
        targetId: winner.targetAnim.id,
        targetName: winner.targetAnim.name,
        dependencyAnimationIds: [],
        dependencyAssetIds: [...winner.assetPairs.keys()],
      };
      reusableDefinitions.push(candidate);
      reusableAnimationBySourceId.set(sourceAnim.id, candidate);
      compatibleAnimTargetIdsBySourceId.set(
        sourceAnim.id,
        new Set([winner.targetAnim.id]),
      );
      requiredTargetAssetPairsByCandidate.set(
        `animation:${sourceAnim.id}:${winner.targetAnim.id}`,
        [...winner.assetPairs.entries()].map(([sourceAssetId, targetAssetId]) => ({
          sourceAssetId,
          targetAssetId,
        })),
      );
    } else if (compatible.length > 1) {
      diagnostics.push({
        kind: 'animation',
        sourceId: sourceAnim.id,
        sourceName: sourceAnim.name,
        code: 'MULTIPLE_TARGET_CANDIDATES',
        reason: `目标工程存在 ${compatible.length} 个同源兼容动画，对应关系不明确，将复制为独立定义。`,
      });
    } else if (lastFailure) {
      diagnostics.push({
        kind: 'animation',
        sourceId: sourceAnim.id,
        sourceName: sourceAnim.name,
        targetId: lastFailure.targetAnim.id,
        targetName: lastFailure.targetAnim.name,
        code: lastFailure.code,
        reason: lastFailure.reason,
      });
    }
  }

  // Step 2: Evaluate all characters in the closure using compatible animation results.
  const inBatchSourceCharacterIds = new Set(closure.characterIds);
  for (const sourceChar of closure.characters) {
    const provenanceMatches = targetProject.characters.filter(
      (candidate) =>
        candidate.importProvenance?.sourceProjectId === sourceProject.id &&
        candidate.importProvenance?.sourceDefinitionId === sourceChar.id,
    );

    if (provenanceMatches.length === 0) {
      const sameName = targetProject.characters.find(
        (candidate) =>
          normalizeName(candidate.name) === normalizeName(sourceChar.name),
      );
      if (sameName) {
        diagnostics.push({
          kind: 'character',
          sourceId: sourceChar.id,
          sourceName: sourceChar.name,
          targetId: sameName.id,
          targetName: sameName.name,
          code: 'NAME_ONLY_MATCH',
          reason: `目标工程存在同名角色“${sameName.name}”，但无同源记录，不能仅凭名称合并，将复制为独立定义。`,
        });
      }
      continue;
    }

    const compatible: Array<{
      targetChar: Character;
      partIdMap?: Record<string, string>;
      actionIdMap?: Record<string, string>;
      dependencyAnimationIds: string[];
      assetPairs: Map<string, string>;
    }> = [];
    let lastFailure: {
      targetChar: Character;
      code: ProjectResourceReuseDiagnosticCode;
      reason: string;
    } | null = null;

    for (const targetChar of provenanceMatches) {
      const res = evaluateCharacterCompatibility({
        sourceChar,
        targetChar,
        sourceProject,
        targetProject,
        assetChecker,
        compatibleAnimTargetIdsBySourceId,
        inBatchSourceCharacterIds,
      });
      if (res.ok) {
        compatible.push({
          targetChar,
          partIdMap: res.partIdMap,
          actionIdMap: res.actionIdMap,
          dependencyAnimationIds: res.dependencyAnimationIds,
          assetPairs: res.assetPairs,
        });
      } else {
        lastFailure = { targetChar, code: res.code, reason: res.reason };
      }
    }

    if (compatible.length === 1) {
      const winner = compatible[0]!;
      const allAssetPairs = new Map(winner.assetPairs);
      for (const depAnimId of winner.dependencyAnimationIds) {
        const depAnim = reusableAnimationBySourceId.get(depAnimId);
        if (!depAnim) continue;
        const depPairs =
          requiredTargetAssetPairsByCandidate.get(
            `animation:${depAnimId}:${depAnim.targetId}`,
          ) ?? [];
        for (const pair of depPairs) {
          allAssetPairs.set(pair.sourceAssetId, pair.targetAssetId);
        }
      }
      const candidate: ProjectResourceReusableDefinition = {
        kind: 'character',
        sourceId: sourceChar.id,
        sourceName: sourceChar.name,
        targetId: winner.targetChar.id,
        targetName: winner.targetChar.name,
        ...(winner.partIdMap ? { partIdMap: winner.partIdMap } : {}),
        ...(winner.actionIdMap ? { actionIdMap: winner.actionIdMap } : {}),
        voiceProfileId: winner.targetChar.defaultVoiceProfileId,
        dependencyAnimationIds: winner.dependencyAnimationIds,
        dependencyAssetIds: [...allAssetPairs.keys()],
      };
      reusableDefinitions.push(candidate);
      reusableCharacterBySourceId.set(sourceChar.id, candidate);
      requiredTargetAssetPairsByCandidate.set(
        `character:${sourceChar.id}:${winner.targetChar.id}`,
        [...allAssetPairs.entries()].map(([sourceAssetId, targetAssetId]) => ({
          sourceAssetId,
          targetAssetId,
        })),
      );
    } else if (compatible.length > 1) {
      diagnostics.push({
        kind: 'character',
        sourceId: sourceChar.id,
        sourceName: sourceChar.name,
        code: 'MULTIPLE_TARGET_CANDIDATES',
        reason: `目标工程存在 ${compatible.length} 个同源兼容角色，对应关系不明确，将复制为独立定义。`,
      });
    } else if (lastFailure) {
      diagnostics.push({
        kind: 'character',
        sourceId: sourceChar.id,
        sourceName: sourceChar.name,
        targetId: lastFailure.targetChar.id,
        targetName: lastFailure.targetChar.name,
        code: lastFailure.code,
        reason: lastFailure.reason,
      });
    }
  }

  return {
    reusableDefinitions,
    diagnostics,
    reusableAnimationBySourceId,
    reusableCharacterBySourceId,
    requiredTargetAssetPairsByCandidate,
  };
}

/**
 * Resolves explicit user reuse selections against a verified compatibility analysis.
 * Any choice whose targetId does not match a provably compatible candidate is
 * rejected rather than silently merged.
 */
export function resolveDefinitionReusePlan(
  analysis: ProjectResourceReuseAnalysis,
  requestedReuseSelections: readonly ProjectResourceReuseSelection[] = [],
): ResolvedDefinitionReusePlan {
  const reusedAnimations = new Map<string, ProjectResourceReusableDefinition>();
  const reusedCharacters = new Map<string, ProjectResourceReusableDefinition>();
  const rejectedChoices: ProjectResourceReuseSelection[] = [];

  for (const choice of requestedReuseSelections) {
    if (choice.kind === 'animation') {
      const candidate = analysis.reusableAnimationBySourceId.get(choice.sourceId);
      if (candidate && candidate.targetId === choice.targetId) {
        reusedAnimations.set(choice.sourceId, candidate);
      } else {
        rejectedChoices.push(choice);
      }
    } else {
      const candidate = analysis.reusableCharacterBySourceId.get(choice.sourceId);
      if (candidate && candidate.targetId === choice.targetId) {
        reusedCharacters.set(choice.sourceId, candidate);
      } else {
        rejectedChoices.push(choice);
      }
    }
  }

  return {
    reusedAnimations,
    reusedCharacters,
    rejectedChoices,
  };
}
