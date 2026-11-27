import {
  isFlaGraphicDefinition,
  ProjectSchema,
  resolveCharacterPartVisualSource,
  type Asset,
  type Character,
  type CharacterAction,
  type CharacterBodyPose,
  type CharacterExpression,
  type CharacterMotionMapping,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  type ImageAsset,
  type MouthPose,
  type MouthPoseSet,
  type Project,
  type ProjectAnimationDefinition,
  type VoiceProfile,
} from '../models';

export type ProjectResourceImportItemKind = 'character' | 'animation' | 'image';

export interface ProjectResourceImportSelection {
  kind: ProjectResourceImportItemKind;
  id: string;
}

export interface ProjectResourceImportCatalogItem {
  id: string;
  kind: ProjectResourceImportItemKind;
  name: string;
  mode?: Character['mode'];
  animationKind?: 'fla-graphic' | 'frame-sequence';
  usage?: ImageAsset['usage'];
  dependencyAssetCount: number;
  dependencyAnimationCount: number;
  hasNameConflict: boolean;
  supported: boolean;
  reason?: string;
}

export interface ProjectResourceImportClosure {
  characters: Character[];
  animations: ProjectAnimationDefinition[];
  assets: Asset[];
  voiceProfiles: VoiceProfile[];
  /** Asset IDs that exist in the source project and are required by the closure. */
  assetIds: string[];
  animationIds: string[];
  characterIds: string[];
  voiceProfileIds: string[];
  issues: string[];
}

export interface ProjectResourceImportPreviewPlan {
  selectedCount: number;
  characterCount: number;
  animationCount: number;
  assetCount: number;
  reusableAssetCount: number;
  newFileCount: number;
  nameConflicts: Array<{
    kind: 'character' | 'animation';
    sourceName: string;
    resolvedName: string;
  }>;
  issues: string[];
}

export interface PlannedAssetTransfer {
  sourceAsset: Asset;
  targetId: string;
  reused: boolean;
  /** Target relativePath (e.g. `assets/foo.png`) when copied, or existing asset's relativePath when reused. */
  targetRelativePath: string;
  sha256?: string;
}

export interface BuiltProjectResourceImportCandidate {
  project: Project;
  importedAssets: Asset[];
  reusedAssetIds: string[];
  importedAnimations: ProjectAnimationDefinition[];
  importedCharacters: Character[];
  importedVoiceProfiles: VoiceProfile[];
  assetIdMap: Map<string, string>;
  animationIdMap: Map<string, string>;
  characterIdMap: Map<string, string>;
  nameConflicts: Array<{
    kind: 'character' | 'animation';
    sourceName: string;
    resolvedName: string;
  }>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
]);

const SUPPORTED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
]);

export function normalizeResourceName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

export function allocateUniqueResourceName(
  rawName: string,
  occupiedNames: Set<string>,
): { name: string; conflicted: boolean } {
  const trimmed = rawName.trim();
  const baseKey = normalizeResourceName(trimmed);
  if (!occupiedNames.has(baseKey)) {
    occupiedNames.add(baseKey);
    return { name: trimmed, conflicted: false };
  }
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const marker = ` (${suffix})`;
    const candidate = `${Array.from(trimmed)
      .slice(0, 200 - marker.length)
      .join('')
      .trimEnd()}${marker}`;
    const key = normalizeResourceName(candidate);
    if (occupiedNames.has(key)) continue;
    occupiedNames.add(key);
    return { name: candidate, conflicted: true };
  }
  throw new Error(`Could not allocate a unique name for ${trimmed}.`);
}

export function isAssetSupportedForCrossProjectImport(asset: Asset): string | null {
  if (asset.kind === 'image') {
    const mime = asset.mimeType.trim().toLowerCase();
    if (!SUPPORTED_IMAGE_MIMES.has(mime)) {
      return `不支持的图片格式（${asset.mimeType}）`;
    }
    return null;
  }
  if (asset.kind === 'audio') {
    const mime = asset.mimeType.trim().toLowerCase();
    if (!SUPPORTED_AUDIO_MIMES.has(mime)) {
      return `不支持的音频格式（${asset.mimeType}）`;
    }
    return null;
  }
  return '当前首版暂不支持跨项目导入视频素材';
}

/**
 * Finds a provably compatible existing asset in the target project.
 * Never matches by name or UUID alone; requires verified content hash +
 * matching kind, MIME type, and image dimensions, and excludes internal
 * FLA Graphic frames owned by a specific definition.
 */
export function findProvablyReusableTargetAsset(
  targetProject: Project,
  sourceAsset: Asset,
  verifiedSourceSha256?: string,
): Asset | null {
  const sourceHash = verifiedSourceSha256 ?? sourceAsset.sha256;
  if (!sourceHash) return null;
  if (sourceAsset.kind === 'image' && sourceAsset.flaGraphicFrame) {
    return null;
  }
  for (const candidate of targetProject.assets) {
    if (candidate.kind !== sourceAsset.kind) continue;
    if (!candidate.sha256 || candidate.sha256 !== sourceHash) continue;
    if (
      candidate.mimeType.trim().toLowerCase() !==
      sourceAsset.mimeType.trim().toLowerCase()
    ) {
      continue;
    }
    if (candidate.kind === 'image' && sourceAsset.kind === 'image') {
      if (candidate.flaGraphicFrame) continue;
      if (
        candidate.width !== sourceAsset.width ||
        candidate.height !== sourceAsset.height
      ) {
        continue;
      }
      return candidate;
    }
    if (candidate.kind === 'audio' && sourceAsset.kind === 'audio') {
      return candidate;
    }
  }
  return null;
}

/**
 * Forward dependency closure collector using a visited set + type/source-ID maps.
 * Guarantees each shared dependency is collected once even across cycles or
 * multiple selected items sharing animations/assets.
 */
export function collectProjectResourceClosure(
  sourceProject: Project,
  selections: readonly ProjectResourceImportSelection[],
): ProjectResourceImportClosure {
  const assetsById = new Map(sourceProject.assets.map((asset) => [asset.id, asset]));
  const animationsById = new Map(
    sourceProject.animations.map((animation) => [animation.id, animation]),
  );
  const charactersById = new Map(
    sourceProject.characters.map((character) => [character.id, character]),
  );
  const voiceProfilesById = new Map(
    sourceProject.voiceProfiles.map((profile) => [profile.id, profile]),
  );

  const visited = new Set<string>();
  const collectedCharacters = new Map<string, Character>();
  const collectedAnimations = new Map<string, ProjectAnimationDefinition>();
  const collectedAssets = new Map<string, Asset>();
  const collectedVoiceProfiles = new Map<string, VoiceProfile>();
  const issues: string[] = [];

  const collectAsset = (
    assetId: string,
    expectedKind: 'image' | 'audio' | 'any',
    ownerLabel: string,
  ): void => {
    const key = `asset:${assetId}`;
    if (visited.has(key)) return;
    visited.add(key);

    const asset = assetsById.get(assetId);
    if (!asset) {
      issues.push(`${ownerLabel}引用的素材不存在`);
      return;
    }
    if (expectedKind !== 'any' && asset.kind !== expectedKind) {
      issues.push(`${ownerLabel}引用的素材“${asset.name}”类型不匹配`);
      return;
    }
    const unsupported = isAssetSupportedForCrossProjectImport(asset);
    if (unsupported) {
      issues.push(`${ownerLabel}依赖的“${asset.name}”：${unsupported}`);
      return;
    }
    collectedAssets.set(asset.id, asset);
  };

  const walkStructureNodes = (
    nodes: readonly FlaGraphicStructureNode[],
    structure: FlaGraphicStructure,
    visitedDefs: Set<string>,
    ownerLabel: string,
  ): void => {
    for (const node of nodes) {
      if (node.type === 'bitmap' && node.assetId) {
        collectAsset(node.assetId, 'image', ownerLabel);
      } else if (
        node.type === 'opaque' &&
        node.fallbackAssetId &&
        node.fallbackScope &&
        node.fallbackViewBox
      ) {
        collectAsset(node.fallbackAssetId, 'image', ownerLabel);
      } else if (node.type === 'group') {
        walkStructureNodes(node.children, structure, visitedDefs, ownerLabel);
      } else if (node.type === 'symbol') {
        if (node.nestedDefinitionId) {
          if (!visitedDefs.has(node.nestedDefinitionId)) {
            visitedDefs.add(node.nestedDefinitionId);
            const nested = structure.symbolDefinitions?.[node.nestedDefinitionId];
            if (nested) {
              walkStructureNodes(nested.children, structure, visitedDefs, ownerLabel);
            }
          }
        } else if (node.children) {
          walkStructureNodes(node.children, structure, visitedDefs, ownerLabel);
        }
      }
    }
  };

  const collectAnimation = (animationId: string, ownerLabel: string): void => {
    const key = `animation:${animationId}`;
    if (visited.has(key)) return;
    visited.add(key);

    const animation = animationsById.get(animationId);
    if (!animation) {
      issues.push(`${ownerLabel}引用的 Graphic 或动画不存在`);
      return;
    }
    collectedAnimations.set(animation.id, animation);
    const animLabel = `Graphic/动画“${animation.name}”`;

    const isFlaGraphic = isFlaGraphicDefinition(animation);
    const structure = isFlaGraphic ? animation.structure : undefined;
    const visitedDefs = new Set<string>();

    if (structure) {
      // Walk all structure frames and shared symbolDefinitions so non-current frames are never missed.
      for (const frame of structure.frames) {
        for (const layer of frame.layers) {
          walkStructureNodes(layer.nodes, structure, visitedDefs, animLabel);
        }
      }
      for (const [defId, def] of Object.entries(structure.symbolDefinitions ?? {})) {
        if (!visitedDefs.has(defId)) {
          visitedDefs.add(defId);
          walkStructureNodes(def.children, structure, visitedDefs, animLabel);
        }
      }
    }

    for (const frame of animation.frames) {
      const hasStructureFrame = Boolean(
        structure?.frames.some((candidate) => candidate.ordinal === frame.ordinal),
      );
      if (hasStructureFrame) {
        // Optional display/fallback SVG frame asset if present in source project.
        if (assetsById.has(frame.assetId)) {
          collectAsset(frame.assetId, 'image', animLabel);
        }
      } else {
        collectAsset(frame.assetId, 'image', animLabel);
      }
    }
  };

  const collectCharacter = (characterId: string): void => {
    const key = `character:${characterId}`;
    if (visited.has(key)) return;
    visited.add(key);

    const character = charactersById.get(characterId);
    if (!character) {
      issues.push('所选角色在来源项目中不存在');
      return;
    }
    const charLabel = `角色“${character.name}”`;
    const voiceProfile = voiceProfilesById.get(character.defaultVoiceProfileId);
    if (!voiceProfile || voiceProfile.characterId !== character.id) {
      issues.push(`${charLabel}缺少有效的默认配音档案`);
      return;
    }
    collectedCharacters.set(character.id, character);
    if (!visited.has(`voiceProfile:${voiceProfile.id}`)) {
      visited.add(`voiceProfile:${voiceProfile.id}`);
      collectedVoiceProfiles.set(voiceProfile.id, voiceProfile);
    }

    if (character.talkingAnimationId) {
      collectAnimation(character.talkingAnimationId, charLabel);
    }
    for (const source of Object.values(character.expressionTalkingSources ?? {})) {
      collectAnimation(source.animationId, charLabel);
    }
    for (const pose of character.mouthPoseSet?.poses ?? []) {
      if (pose.source.kind === 'image') {
        collectAsset(pose.source.assetId, 'image', charLabel);
      } else {
        collectAnimation(pose.source.animationId, charLabel);
      }
    }
    for (const action of character.actions ?? []) {
      if (!('kind' in action)) {
        collectAnimation(action.animationId, charLabel);
      }
    }

    if (character.mode === 'adaptive-parts') {
      for (const part of character.parts) {
        const visualSource = resolveCharacterPartVisualSource(part);
        if (visualSource.kind === 'image') {
          collectAsset(visualSource.assetId, 'image', charLabel);
        } else {
          collectAnimation(visualSource.animationId, charLabel);
        }
      }
      for (const expression of character.expressions ?? []) {
        if (expression.visualSource) {
          collectAnimation(expression.visualSource.animationId, charLabel);
        } else if (expression.assetId) {
          collectAsset(expression.assetId, 'image', charLabel);
        }
      }
      if (character.mouthOpenAssetId) {
        collectAsset(character.mouthOpenAssetId, 'image', charLabel);
      }
      if (character.mouthOpenVisualSource) {
        collectAnimation(character.mouthOpenVisualSource.animationId, charLabel);
      }
    } else {
      if (character.baseAssetId) {
        collectAsset(character.baseAssetId, 'image', charLabel);
      }
      if (character.mode === 'composite') {
        collectAsset(character.bodyAssetId, 'image', charLabel);
        if (character.head) {
          collectAsset(character.head.assetId, 'image', charLabel);
        }
      }
      for (const expression of character.expressions) {
        if (expression.visualSource) {
          collectAnimation(expression.visualSource.animationId, charLabel);
        } else if (expression.assetId) {
          collectAsset(expression.assetId, 'image', charLabel);
        }
      }
      if (character.mouthOpenAssetId) {
        collectAsset(character.mouthOpenAssetId, 'image', charLabel);
      }
      if (character.mouthOpenVisualSource) {
        collectAnimation(character.mouthOpenVisualSource.animationId, charLabel);
      }
    }
  };

  for (const selection of selections) {
    if (selection.kind === 'character') {
      collectCharacter(selection.id);
    } else if (selection.kind === 'animation') {
      collectAnimation(selection.id, '所选素材');
    } else if (selection.kind === 'image') {
      collectAsset(selection.id, 'image', '所选图片');
    }
  }

  return {
    characters: [...collectedCharacters.values()],
    animations: [...collectedAnimations.values()],
    assets: [...collectedAssets.values()],
    voiceProfiles: [...collectedVoiceProfiles.values()],
    assetIds: [...collectedAssets.keys()],
    animationIds: [...collectedAnimations.keys()],
    characterIds: [...collectedCharacters.keys()],
    voiceProfileIds: [...collectedVoiceProfiles.keys()],
    issues,
  };
}

/**
 * Builds the selectable catalog from a read-only source project, evaluating each
 * item independently so partial unsupported items are reported without blocking
 * valid selectable items.
 */
export function buildProjectResourceImportCatalog(
  sourceProject: Project,
  targetProject: Project,
): ProjectResourceImportCatalogItem[] {
  const targetCharacterNames = new Set(
    targetProject.characters.map((character) =>
      normalizeResourceName(character.name),
    ),
  );
  const targetAnimationNames = new Set(
    targetProject.animations.map((animation) =>
      normalizeResourceName(animation.name),
    ),
  );

  const items: ProjectResourceImportCatalogItem[] = [];

  for (const character of sourceProject.characters) {
    const closure = collectProjectResourceClosure(sourceProject, [
      { kind: 'character', id: character.id },
    ]);
    const reason = closure.issues[0];
    items.push({
      id: character.id,
      kind: 'character',
      name: character.name,
      mode: character.mode,
      dependencyAssetCount: closure.assets.length,
      dependencyAnimationCount: closure.animations.length,
      hasNameConflict: targetCharacterNames.has(
        normalizeResourceName(character.name),
      ),
      supported: reason === undefined,
      ...(reason ? { reason } : {}),
    });
  }

  for (const animation of sourceProject.animations) {
    const closure = collectProjectResourceClosure(sourceProject, [
      { kind: 'animation', id: animation.id },
    ]);
    const reason = closure.issues[0];
    items.push({
      id: animation.id,
      kind: 'animation',
      name: animation.name,
      animationKind: isFlaGraphicDefinition(animation)
        ? 'fla-graphic'
        : 'frame-sequence',
      dependencyAssetCount: closure.assets.length,
      dependencyAnimationCount: Math.max(0, closure.animations.length - 1),
      hasNameConflict: targetAnimationNames.has(
        normalizeResourceName(animation.name),
      ),
      supported: reason === undefined,
      ...(reason ? { reason } : {}),
    });
  }

  for (const asset of sourceProject.assets) {
    if (asset.kind !== 'image') continue;
    // Internal FLA Graphic frame SVGs belong to their FlaGraphicDefinition, not standalone selection.
    if (asset.flaGraphicFrame) continue;
    if (asset.usage !== 'background' && asset.usage !== 'prop') continue;
    const unsupported = isAssetSupportedForCrossProjectImport(asset);
    items.push({
      id: asset.id,
      kind: 'image',
      name: asset.name,
      usage: asset.usage,
      dependencyAssetCount: 1,
      dependencyAnimationCount: 0,
      hasNameConflict: false,
      supported: unsupported === null,
      ...(unsupported ? { reason: unsupported } : {}),
    });
  }

  return items;
}

/**
 * Pure preview calculation with zero disk writes.
 */
export function buildProjectResourceImportPreview(
  sourceProject: Project,
  targetProject: Project,
  selections: readonly ProjectResourceImportSelection[],
  reuseIdenticalAssets = false,
): ProjectResourceImportPreviewPlan {
  const closure = collectProjectResourceClosure(sourceProject, selections);
  const occupiedCharacterNames = new Set(
    targetProject.characters.map((character) =>
      normalizeResourceName(character.name),
    ),
  );
  const occupiedAnimationNames = new Set(
    targetProject.animations.map((animation) =>
      normalizeResourceName(animation.name),
    ),
  );
  const nameConflicts: ProjectResourceImportPreviewPlan['nameConflicts'] = [];

  for (const character of closure.characters) {
    const allocated = allocateUniqueResourceName(
      character.name,
      occupiedCharacterNames,
    );
    if (allocated.conflicted) {
      nameConflicts.push({
        kind: 'character',
        sourceName: character.name,
        resolvedName: allocated.name,
      });
    }
  }
  for (const animation of closure.animations) {
    const allocated = allocateUniqueResourceName(
      animation.name,
      occupiedAnimationNames,
    );
    if (allocated.conflicted) {
      nameConflicts.push({
        kind: 'animation',
        sourceName: animation.name,
        resolvedName: allocated.name,
      });
    }
  }

  let reusableAssetCount = 0;
  for (const asset of closure.assets) {
    if (findProvablyReusableTargetAsset(targetProject, asset)) {
      reusableAssetCount += 1;
    }
  }

  const newFileCount = reuseIdenticalAssets
    ? closure.assets.length - reusableAssetCount
    : closure.assets.length;

  return {
    selectedCount: selections.length,
    characterCount: closure.characters.length,
    animationCount: closure.animations.length,
    assetCount: closure.assets.length,
    reusableAssetCount,
    newFileCount,
    nameConflicts,
    issues: closure.issues,
  };
}

export function collectProjectUuidValues(project: Project): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (UUID_PATTERN.test(value)) ids.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(project);
  return ids;
}

function createUniqueUuidAllocator(
  usedIds: Set<string>,
  createId: () => string,
): () => string {
  return () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = createId();
      if (!UUID_PATTERN.test(id) || usedIds.has(id)) continue;
      usedIds.add(id);
      return id;
    }
    throw new Error('Could not allocate a unique Project resource identity.');
  };
}

function remapStructureNodes(
  nodes: readonly FlaGraphicStructureNode[],
  remapAssetOptional: (sourceId: string) => string,
): FlaGraphicStructureNode[] {
  return nodes.map((node) => {
    if (node.type === 'bitmap') {
      return {
        ...node,
        ...(node.assetId ? { assetId: remapAssetOptional(node.assetId) } : {}),
      };
    }
    if (node.type === 'opaque') {
      return {
        ...node,
        ...(node.fallbackAssetId
          ? { fallbackAssetId: remapAssetOptional(node.fallbackAssetId) }
          : {}),
      };
    }
    if (node.type === 'group') {
      return {
        ...node,
        children: remapStructureNodes(node.children, remapAssetOptional),
      };
    }
    return {
      ...node,
      ...(node.children
        ? { children: remapStructureNodes(node.children, remapAssetOptional) }
        : {}),
    };
  });
}

function remapFlaGraphicStructure(
  structure: FlaGraphicStructure,
  remapAssetOptional: (sourceId: string) => string,
): FlaGraphicStructure {
  return {
    ...structure,
    ...(structure.symbolDefinitions
      ? {
          symbolDefinitions: Object.fromEntries(
            Object.entries(structure.symbolDefinitions).map(([defId, def]) => [
              defId,
              {
                ...def,
                children: remapStructureNodes(def.children, remapAssetOptional),
              },
            ]),
          ),
        }
      : {}),
    frames: structure.frames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((layer) => ({
        ...layer,
        nodes: remapStructureNodes(layer.nodes, remapAssetOptional),
      })),
    })),
  };
}

function remapCharacterActions(
  actions: readonly CharacterAction[] | undefined,
  remapAnimation: (sourceId: string) => string,
  remapPartId: (sourceId: string) => string,
  allocateId: () => string,
): { actions?: CharacterAction[]; actionIdMap: Map<string, string> } {
  const actionIdMap = new Map<string, string>();
  if (!actions) return { actionIdMap };
  const mapped: CharacterAction[] = actions.map((action) => {
    const nextId = allocateId();
    actionIdMap.set(action.id, nextId);
    if ('kind' in action) {
      return {
        ...action,
        id: nextId,
        tracks: action.tracks.map((track) => ({
          ...track,
          partId: remapPartId(track.partId),
          keys: track.keys.map((key) => ({ ...key })),
        })),
        ...(action.headAnchorPartId
          ? { headAnchorPartId: remapPartId(action.headAnchorPartId) }
          : {}),
        ...(action.partPivotOffsets
          ? {
              partPivotOffsets: action.partPivotOffsets.map((entry) => ({
                ...entry,
                partId: remapPartId(entry.partId),
                offset: { ...entry.offset },
              })),
            }
          : {}),
      };
    }
    return {
      ...action,
      id: nextId,
      animationId: remapAnimation(action.animationId),
      placement: { ...action.placement },
    };
  });
  return { actions: mapped, actionIdMap };
}

function remapMouthPoseSet(
  mouthPoseSet: MouthPoseSet | undefined,
  remapAsset: (sourceId: string) => string,
  remapAnimation: (sourceId: string) => string,
  remapPartId: (sourceId: string) => string,
  allocateId: () => string,
): MouthPoseSet | undefined {
  if (!mouthPoseSet) return undefined;
  const poseIdMap = new Map<string, string>();
  const poses: MouthPose[] = mouthPoseSet.poses.map((pose) => {
    const nextId = allocateId();
    poseIdMap.set(pose.id, nextId);
    return {
      ...pose,
      id: nextId,
      source:
        pose.source.kind === 'image'
          ? { ...pose.source, assetId: remapAsset(pose.source.assetId) }
          : { ...pose.source, animationId: remapAnimation(pose.source.animationId) },
      target:
        pose.target.kind === 'mouth'
          ? { kind: 'mouth', partId: remapPartId(pose.target.partId) }
          : { kind: 'face' },
    };
  });
  const remapPoseId = (id: string): string => {
    const mapped = poseIdMap.get(id);
    if (!mapped) throw new Error(`Missing remapped mouth pose ID for ${id}`);
    return mapped;
  };
  return {
    ...mouthPoseSet,
    poses,
    restPoseId: remapPoseId(mouthPoseSet.restPoseId),
    analyzerMapping: {
      rest: remapPoseId(mouthPoseSet.analyzerMapping.rest),
      open: remapPoseId(mouthPoseSet.analyzerMapping.open),
      wide: remapPoseId(mouthPoseSet.analyzerMapping.wide),
      round: remapPoseId(mouthPoseSet.analyzerMapping.round),
      closed: remapPoseId(mouthPoseSet.analyzerMapping.closed),
    },
  };
}

function remapExpressions(
  expressions: readonly CharacterExpression[] | undefined,
  remapAsset: (sourceId: string) => string,
  remapAnimation: (sourceId: string) => string,
  allocateId: () => string,
): { expressions?: CharacterExpression[]; expressionIdMap: Map<string, string> } {
  const expressionIdMap = new Map<string, string>();
  if (!expressions) return { expressionIdMap };
  const mapped: CharacterExpression[] = expressions.map((expression) => {
    const nextId = allocateId();
    expressionIdMap.set(expression.id, nextId);
    return {
      ...expression,
      id: nextId,
      ...(expression.assetId
        ? { assetId: remapAsset(expression.assetId) }
        : {}),
      ...(expression.visualSource
        ? {
            visualSource: {
              ...expression.visualSource,
              animationId: remapAnimation(expression.visualSource.animationId),
            },
          }
        : {}),
    };
  });
  return { expressions: mapped, expressionIdMap };
}

function remapExpressionTalkingSources(
  sources: Character['expressionTalkingSources'],
  expressionIdMap: ReadonlyMap<string, string>,
  remapAnimation: (sourceId: string) => string,
): Character['expressionTalkingSources'] {
  if (!sources) return undefined;
  return Object.fromEntries(
    Object.entries(sources).map(([sourceExprId, entry]) => {
      const targetExprId = expressionIdMap.get(sourceExprId);
      if (!targetExprId) {
        throw new Error(`Missing remapped expression ID for ${sourceExprId}`);
      }
      return [
        targetExprId,
        {
          ...entry,
          animationId: remapAnimation(entry.animationId),
          playback: { ...entry.playback },
        },
      ];
    }),
  );
}

/**
 * Two-phase project-level ID remapper & candidate Project builder:
 * Phase 1: Allocate all target project-level IDs (assets, animations, characters, voice profiles) and conflict-safe names.
 * Phase 2: Rewrite all formal references while preserving definition-local / source identities.
 * Validates the resulting candidate Project with `ProjectSchema.parse`.
 */
export function buildImportedProjectCandidate(options: {
  targetProject: Project;
  sourceProject: Project;
  closure: ProjectResourceImportClosure;
  plannedAssets: readonly PlannedAssetTransfer[];
  createId: () => string;
  updatedAtIso: string;
}): BuiltProjectResourceImportCandidate {
  const {
    targetProject,
    sourceProject,
    closure,
    plannedAssets,
    createId,
    updatedAtIso,
  } = options;

  const usedIds = new Set([
    ...collectProjectUuidValues(targetProject),
    ...collectProjectUuidValues(sourceProject),
    ...plannedAssets.map((item) => item.targetId),
  ]);
  const allocateId = createUniqueUuidAllocator(usedIds, createId);

  // Phase 1: Allocate project-level IDs & conflict-safe names.
  const assetIdMap = new Map<string, string>();
  const reusedAssetIds: string[] = [];
  for (const planned of plannedAssets) {
    assetIdMap.set(planned.sourceAsset.id, planned.targetId);
    if (planned.reused) {
      reusedAssetIds.push(planned.targetId);
    }
  }

  const animationIdMap = new Map<string, string>();
  const animationNameMap = new Map<string, string>();
  const occupiedAnimationNames = new Set(
    targetProject.animations.map((animation) =>
      normalizeResourceName(animation.name),
    ),
  );
  const nameConflicts: BuiltProjectResourceImportCandidate['nameConflicts'] = [];
  for (const animation of closure.animations) {
    animationIdMap.set(animation.id, allocateId());
    const allocated = allocateUniqueResourceName(
      animation.name,
      occupiedAnimationNames,
    );
    animationNameMap.set(animation.id, allocated.name);
    if (allocated.conflicted) {
      nameConflicts.push({
        kind: 'animation',
        sourceName: animation.name,
        resolvedName: allocated.name,
      });
    }
  }

  const characterIdMap = new Map<string, string>();
  const characterNameMap = new Map<string, string>();
  const voiceProfileIdMap = new Map<string, string>();
  const occupiedCharacterNames = new Set(
    targetProject.characters.map((character) =>
      normalizeResourceName(character.name),
    ),
  );
  for (const character of closure.characters) {
    characterIdMap.set(character.id, allocateId());
    const allocated = allocateUniqueResourceName(
      character.name,
      occupiedCharacterNames,
    );
    characterNameMap.set(character.id, allocated.name);
    if (allocated.conflicted) {
      nameConflicts.push({
        kind: 'character',
        sourceName: character.name,
        resolvedName: allocated.name,
      });
    }
  }
  for (const voiceProfile of closure.voiceProfiles) {
    voiceProfileIdMap.set(voiceProfile.id, allocateId());
  }

  const remapAsset = (sourceId: string): string => {
    const targetId = assetIdMap.get(sourceId);
    if (!targetId) {
      throw new Error(`Missing remapped asset ID for ${sourceId}.`);
    }
    return targetId;
  };
  const remapAssetOptional = (sourceId: string): string =>
    assetIdMap.get(sourceId) ?? sourceId;
  const remapAnimation = (sourceId: string): string => {
    const targetId = animationIdMap.get(sourceId);
    if (!targetId) {
      throw new Error(`Missing remapped animation ID for ${sourceId}.`);
    }
    return targetId;
  };

  // Phase 2: Rewrite all formal references.
  const importedAssets: Asset[] = [];
  for (const planned of plannedAssets) {
    if (planned.reused) continue;
    const sourceAsset = planned.sourceAsset;
    if (sourceAsset.kind === 'image') {
      importedAssets.push({
        ...sourceAsset,
        id: planned.targetId,
        relativePath: planned.targetRelativePath,
        ...(planned.sha256 ? { sha256: planned.sha256 } : {}),
        ...(sourceAsset.flaGraphicFrame
          ? {
              flaGraphicFrame: {
                ...sourceAsset.flaGraphicFrame,
                definitionId: remapAnimation(
                  sourceAsset.flaGraphicFrame.definitionId,
                ),
              },
            }
          : {}),
      });
    } else {
      importedAssets.push({
        ...sourceAsset,
        id: planned.targetId,
        relativePath: planned.targetRelativePath,
        ...(planned.sha256 ? { sha256: planned.sha256 } : {}),
      });
    }
  }

  const importedAnimations: ProjectAnimationDefinition[] = closure.animations.map(
    (animation) => {
      const targetId = remapAnimation(animation.id);
      const targetName = animationNameMap.get(animation.id)!;
      const frames = animation.frames.map((frame) => ({
        ...frame,
        assetId: remapAssetOptional(frame.assetId),
      }));
      if (isFlaGraphicDefinition(animation)) {
        return {
          ...animation,
          id: targetId,
          name: targetName,
          frames,
          ...(animation.structure
            ? {
                structure: remapFlaGraphicStructure(
                  animation.structure,
                  remapAssetOptional,
                ),
              }
            : {}),
        };
      }
      return {
        ...animation,
        id: targetId,
        name: targetName,
        frames,
      };
    },
  );

  const importedCharacters: Character[] = closure.characters.map((character) => {
    const targetCharacterId = characterIdMap.get(character.id)!;
    const targetVoiceProfileId = voiceProfileIdMap.get(
      character.defaultVoiceProfileId,
    )!;
    const targetName = characterNameMap.get(character.id)!;

    if (character.mode === 'adaptive-parts') {
      const partIdMap = new Map<string, string>();
      const parts = character.parts.map((part) => {
        const nextPartId = allocateId();
        partIdMap.set(part.partId, nextPartId);
        const visualSource = part.visualSource
          ? part.visualSource.kind === 'image'
            ? {
                ...part.visualSource,
                assetId: remapAsset(part.visualSource.assetId),
              }
            : {
                ...part.visualSource,
                animationId: remapAnimation(part.visualSource.animationId),
              }
          : undefined;
        return {
          ...part,
          partId: nextPartId,
          ...(part.assetId ? { assetId: remapAsset(part.assetId) } : {}),
          ...(visualSource ? { visualSource } : {}),
        };
      });
      const remapPartId = (sourcePartId: string): string => {
        const mapped = partIdMap.get(sourcePartId);
        if (!mapped) {
          throw new Error(`Missing remapped part ID for ${sourcePartId}.`);
        }
        return mapped;
      };

      const { expressions, expressionIdMap } = remapExpressions(
        character.expressions,
        remapAsset,
        remapAnimation,
        allocateId,
      );
      const defaultExpressionId = character.defaultExpressionId
        ? expressionIdMap.get(character.defaultExpressionId)
        : undefined;
      const expressionTalkingSources = remapExpressionTalkingSources(
        character.expressionTalkingSources,
        expressionIdMap,
        remapAnimation,
      );
      const mouthPoseSet = remapMouthPoseSet(
        character.mouthPoseSet,
        remapAsset,
        remapAnimation,
        remapPartId,
        allocateId,
      );
      const { actions, actionIdMap } = remapCharacterActions(
        character.actions,
        remapAnimation,
        remapPartId,
        allocateId,
      );
      const bodyPoses: CharacterBodyPose[] | undefined = character.bodyPoses?.map(
        (pose) => ({
          ...pose,
          id: allocateId(),
          parts: pose.parts.map((entry) => ({
            ...entry,
            partId: remapPartId(entry.partId),
            properties: { ...entry.properties },
            ...(entry.referencePivot
              ? { referencePivot: { ...entry.referencePivot } }
              : {}),
          })),
        }),
      );
      const armChain = character.armChain
        ? {
            ...character.armChain,
            segments: character.armChain.segments.map((segment) => ({
              ...segment,
              partId: remapPartId(segment.partId),
              joint: { ...segment.joint },
            })),
            tip: { ...character.armChain.tip },
          }
        : undefined;
      // Preserve motionMappings only if generatedActionId was remapped and sourceCharacterId is self or also imported.
      const motionMappings: CharacterMotionMapping[] | undefined =
        character.motionMappings
          ?.filter(
            (mapping) =>
              characterIdMap.has(mapping.sourceCharacterId) &&
              actionIdMap.has(mapping.generatedActionId),
          )
          .map((mapping) => ({
            ...mapping,
            sourceCharacterId: characterIdMap.get(mapping.sourceCharacterId)!,
            generatedActionId: actionIdMap.get(mapping.generatedActionId)!,
            rules: mapping.rules.map((rule) => ({
              ...rule,
              ...(rule.targetPartId
                ? { targetPartId: remapPartId(rule.targetPartId) }
                : {}),
              pivotOffset: { ...rule.pivotOffset },
              properties: [...rule.properties],
            })),
          }));

      return {
        ...character,
        id: targetCharacterId,
        name: targetName,
        defaultVoiceProfileId: targetVoiceProfileId,
        parts,
        ...(character.faceBinding
          ? {
              faceBinding: {
                ...character.faceBinding,
                targetPartId: remapPartId(character.faceBinding.targetPartId),
                replacePartIds:
                  character.faceBinding.replacePartIds.map(remapPartId),
              },
            }
          : {}),
        ...(expressions ? { expressions } : {}),
        ...(defaultExpressionId ? { defaultExpressionId } : {}),
        ...(character.mouthOpenAssetId
          ? { mouthOpenAssetId: remapAsset(character.mouthOpenAssetId) }
          : {}),
        ...(character.mouthOpenVisualSource
          ? {
              mouthOpenVisualSource: {
                ...character.mouthOpenVisualSource,
                animationId: remapAnimation(
                  character.mouthOpenVisualSource.animationId,
                ),
              },
            }
          : {}),
        ...(character.headMotionBinding
          ? {
              headMotionBinding: {
                partIds: character.headMotionBinding.partIds.map(remapPartId),
              },
            }
          : {}),
        ...(character.talkingAnimationId
          ? { talkingAnimationId: remapAnimation(character.talkingAnimationId) }
          : {}),
        ...(mouthPoseSet ? { mouthPoseSet } : {}),
        ...(expressionTalkingSources ? { expressionTalkingSources } : {}),
        ...(actions ? { actions } : {}),
        ...(bodyPoses ? { bodyPoses } : {}),
        ...(armChain ? { armChain } : {}),
        ...(motionMappings && motionMappings.length > 0
          ? { motionMappings }
          : { motionMappings: undefined }),
      };
    }

    const unusedPartRemapper = (id: string): string => id;
    const { expressions, expressionIdMap } = remapExpressions(
      character.expressions,
      remapAsset,
      remapAnimation,
      allocateId,
    );
    const defaultExpressionId = expressionIdMap.get(character.defaultExpressionId);
    if (!defaultExpressionId || !expressions) {
      throw new Error('The source Character has no default expression.');
    }
    const expressionTalkingSources = remapExpressionTalkingSources(
      character.expressionTalkingSources,
      expressionIdMap,
      remapAnimation,
    );
    const mouthPoseSet = remapMouthPoseSet(
      character.mouthPoseSet,
      remapAsset,
      remapAnimation,
      unusedPartRemapper,
      allocateId,
    );
    const { actions } = remapCharacterActions(
      character.actions,
      remapAnimation,
      unusedPartRemapper,
      allocateId,
    );

    const common = {
      id: targetCharacterId,
      name: targetName,
      defaultVoiceProfileId: targetVoiceProfileId,
      ...(character.baseAssetId
        ? { baseAssetId: remapAsset(character.baseAssetId) }
        : {}),
      expressions,
      defaultExpressionId,
      ...(character.mouthOpenAssetId
        ? { mouthOpenAssetId: remapAsset(character.mouthOpenAssetId) }
        : {}),
      ...(character.mouthOpenVisualSource
        ? {
            mouthOpenVisualSource: {
              ...character.mouthOpenVisualSource,
              animationId: remapAnimation(
                character.mouthOpenVisualSource.animationId,
              ),
            },
          }
        : {}),
      ...(character.talkingAnimationId
        ? { talkingAnimationId: remapAnimation(character.talkingAnimationId) }
        : {}),
      ...(mouthPoseSet ? { mouthPoseSet } : {}),
      ...(expressionTalkingSources ? { expressionTalkingSources } : {}),
      ...(actions ? { actions } : {}),
    };

    if (character.mode === 'composite') {
      return {
        ...character,
        ...common,
        bodyAssetId: remapAsset(character.bodyAssetId),
        ...(character.head
          ? {
              head: {
                ...character.head,
                assetId: remapAsset(character.head.assetId),
              },
            }
          : {}),
      };
    }

    return {
      ...character,
      ...common,
    };
  });

  const importedVoiceProfiles: VoiceProfile[] = closure.voiceProfiles.map(
    (profile) => ({
      ...profile,
      id: voiceProfileIdMap.get(profile.id)!,
      characterId: characterIdMap.get(profile.characterId)!,
    }),
  );

  // Strip undefined optional fields cleanly before strict Zod parse.
  const cleanedCharacters = importedCharacters.map((character) => {
    if (
      character.mode === 'adaptive-parts' &&
      character.motionMappings === undefined
    ) {
      const rest = { ...character };
      delete rest.motionMappings;
      return rest;
    }
    return character;
  });

  const candidate = ProjectSchema.parse({
    ...targetProject,
    assets: [...targetProject.assets, ...importedAssets],
    animations: [...targetProject.animations, ...importedAnimations],
    characters: [...targetProject.characters, ...cleanedCharacters],
    voiceProfiles: [...targetProject.voiceProfiles, ...importedVoiceProfiles],
    updatedAt: updatedAtIso,
  });

  return {
    project: candidate,
    importedAssets,
    reusedAssetIds,
    importedAnimations,
    importedCharacters: cleanedCharacters,
    importedVoiceProfiles,
    assetIdMap,
    animationIdMap,
    characterIdMap,
    nameConflicts,
  };
}
