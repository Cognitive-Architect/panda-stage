import {
  characterBoneProtectedPartIds,
  resolveCharacterBoneTree,
} from '../character-bone-pose';
import {
  evaluateVectorSkinDeformation,
  type CharacterVectorSkinFallbackCode,
} from '../character-vector-skin';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import { selectFlaGraphicSubtreeVisual } from '../fla-graphic-subtree';
import {
  AdaptivePartsCharacterSchema,
  CHARACTER_VECTOR_SKIN_MAX_COUNT,
  CharacterVectorSkinSchema,
  resolveCharacterPartVisualSource,
  type AdaptivePartsCharacter,
  type CharacterPart,
  type CharacterVectorSkin,
} from '../models/character';
import { isFlaGraphicDefinition, type FlaGraphicDefinition } from '../models/animation';
import { ProjectSchema, type Project } from '../models/project';
import { resolveLayerVisualParts, type LayerVisualPartVectorSkinStatus } from '../selectors/visualParts';
import { isValidFrameTime } from '../timeline/frame-grid';

/**
 * Two-Bone vector skin authoring/read service (#1459). Mutations return one
 * Project produced through `ProjectSchema.parse`, so the caller records exactly
 * one undo per confirmed action. Drafts live in React state only.
 */

export interface CharacterVectorSkinCreateInput {
  readonly partId: string;
  /** Exactly two distinct Bones of the same Character Bone tree. */
  readonly boneIds: readonly [string, string];
}

export interface CharacterVectorSkinStatusRow {
  readonly skin: CharacterVectorSkin;
  readonly partId: string;
  readonly partName: string;
  readonly boneNames: readonly [string, string];
  readonly status?: LayerVisualPartVectorSkinStatus;
  /** True when the Layer has no Character Animation Clip yet, so no Bone pose can deform it. */
  readonly requiresAnimationClip: boolean;
}

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;

export function characterVectorSkinFallbackText(code: CharacterVectorSkinFallbackCode): string {
  switch (code) {
    case 'missing-bone':
      return '蒙皮引用的骨骼缺失，已按原样显示。';
    case 'missing-part':
      return '绑定部件不在当前动作中，已按原样显示。';
    case 'not-vector-content':
      return '该部件不是可编辑矢量路径，已按原样显示。';
    case 'mixed-content':
      return '该元件混有位图或文字，当前只支持纯矢量蒙皮，已按原样显示。';
    case 'clip-path':
      return '该元件带裁剪路径，首版蒙皮不支持，已按原样显示。';
    case 'non-solid-style':
      return '该元件含渐变或图案填充，首版蒙皮不支持，已按原样显示。';
    case 'too-many-anchors':
      return '该元件锚点过多，超出小样上限，已按原样显示。';
    case 'degenerate-transform':
      return '该帧变换不可逆，蒙皮已跳过，按原样显示。';
  }
}

function adaptiveCharacter(project: Project, characterId: string): AdaptivePartsCharacter {
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('请选择分件角色。');
  }
  return character;
}

function replaceCharacter(
  project: Project,
  character: AdaptivePartsCharacter,
  next: AdaptivePartsCharacter,
): Project {
  const validated = AdaptivePartsCharacterSchema.parse(next);
  return ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    characters: project.characters.map((candidate) =>
      candidate.id === character.id ? validated : candidate),
  });
}

function partDisplayName(part: CharacterPart, index: number): string {
  return part.displayName?.trim() || `部件 ${index + 1}`;
}

function boneDisplayName(character: AdaptivePartsCharacter, boneId: string): string {
  const tree = resolveCharacterBoneTree(character);
  const order = tree.ok ? tree.order : [];
  const bone = tree.ok ? tree.byId.get(boneId) : undefined;
  const index = order.indexOf(boneId);
  return bone?.name?.trim() || `骨骼 ${Math.max(0, index) + 1}`;
}

function definitionOf(
  project: Project,
  part: CharacterPart,
): { definition: FlaGraphicDefinition; visualSource: ReturnType<typeof resolveCharacterPartVisualSource> } | null {
  const visualSource = resolveCharacterPartVisualSource(part);
  if (visualSource.kind !== 'fla-graphic') return null;
  const definition = project.animations.find(
    (candidate): candidate is FlaGraphicDefinition =>
      isFlaGraphicDefinition(candidate) && candidate.id === visualSource.animationId,
  );
  return definition && definition.structure ? { definition, visualSource } : null;
}

/**
 * Evaluates the Part's authored Definition frame and isolates its selected
 * subtree/region, so the create-time check really inspects vector content.
 */
function partVectorVisual(
  project: Project,
  part: CharacterPart,
  skin: CharacterVectorSkin,
): ReturnType<typeof evaluateVectorSkinDeformation> {
  const resolved = definitionOf(project, part);
  if (!resolved) return { ok: false, code: 'not-vector-content' };
  const { definition, visualSource } = resolved;
  const frameOrdinal = 'poseFrameOrdinal' in visualSource && visualSource.poseFrameOrdinal !== undefined
    ? visualSource.poseFrameOrdinal
    : (definition.frames[0]?.ordinal ?? 0);
  const evaluated = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode: 'instance',
    ...('instanceTransformOverrides' in visualSource && visualSource.instanceTransformOverrides
      ? { instanceTransformOverrides: visualSource.instanceTransformOverrides }
      : {}),
  });
  if (!evaluated) return { ok: false, code: 'not-vector-content' };
  const nodePath = 'nodePath' in visualSource ? visualSource.nodePath : undefined;
  const regionSelection = 'regionRef' in visualSource || 'regionVector' in visualSource
    ? {
        ...('regionRef' in visualSource && visualSource.regionRef
          ? { regionRef: visualSource.regionRef }
          : {}),
        ...('regionVector' in visualSource && visualSource.regionVector
          ? { regionVector: visualSource.regionVector }
          : {}),
      }
    : undefined;
  // The formal Part resolver only scopes a region under a node path; a region
  // selection without one renders an empty subtree and must not be skin-bindable.
  if (!nodePath && regionSelection && Object.keys(regionSelection).length > 0) {
    return { ok: false, code: 'not-vector-content' };
  }
  const visual = nodePath
    ? selectFlaGraphicSubtreeVisual(
        evaluated,
        nodePath,
        regionSelection && Object.keys(regionSelection).length > 0 ? regionSelection : undefined,
      )
    : evaluated;
  return evaluateVectorSkinDeformation({
    visual,
    posedClipTransform: IDENTITY,
    restCharacterTransform: IDENTITY,
    clipDeltas: new Map(),
    skin,
    // The rest probe never reaches deformation; these only satisfy the Bone check.
    boneSegments: new Map(skin.boneIds.map((boneId) => [boneId, {
      boneId,
      head: { x: 0, y: 0 },
      tail: { x: 0, y: 0 },
    }])),
    overrides: new Map(),
  });
}

export class CharacterVectorSkinService {
  private readonly createId: () => string;

  constructor(options: { createId?: () => string } = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  create(
    project: Project,
    characterId: string,
    input: CharacterVectorSkinCreateInput,
  ): Project {
    const character = adaptiveCharacter(project, characterId);
    const partIndex = character.parts.findIndex((part) => part.partId === input.partId);
    if (partIndex < 0) throw new Error('未找到要蒙皮的部件。');
    const part = character.parts[partIndex]!;
    if (!part.visible) throw new Error('隐藏的部件不能创建蒙皮。');
    if (characterBoneProtectedPartIds(character).has(part.partId)) {
      throw new Error('脸部、口型与随头部件保持原有系统，不能创建矢量蒙皮。');
    }
    const tree = resolveCharacterBoneTree(character);
    if (!tree.ok) throw new Error(`骨骼树无效：${tree.message}`);
    const [firstBoneId, secondBoneId] = input.boneIds;
    if (firstBoneId === secondBoneId) throw new Error('请选择两根不同的骨骼。');
    if (!tree.byId.has(firstBoneId) || !tree.byId.has(secondBoneId)) {
      throw new Error('未找到所选骨骼。');
    }
    const skins = character.vectorSkins ?? [];
    if (skins.length >= CHARACTER_VECTOR_SKIN_MAX_COUNT) {
      throw new Error(`一个角色最多 ${CHARACTER_VECTOR_SKIN_MAX_COUNT} 个矢量蒙皮。`);
    }
    if (skins.some((skin) => skin.partId === input.partId)) {
      throw new Error('该部件已有蒙皮，请先删除。');
    }
    if (!definitionOf(project, part)) {
      throw new Error('请选择矢量元件部件。');
    }
    const skin = CharacterVectorSkinSchema.parse({
      id: this.createId(),
      partId: input.partId,
      boneIds: [firstBoneId, secondBoneId],
    });
    const probe = partVectorVisual(project, part, skin);
    if (!probe.ok) throw new Error(characterVectorSkinFallbackText(probe.code));
    if (probe.anchorCount === 0) throw new Error('该部件没有可蒙皮的矢量锚点。');
    return replaceCharacter(project, character, {
      ...character,
      vectorSkins: [...skins, skin],
    });
  }

  delete(project: Project, characterId: string, skinId: string): Project {
    const character = adaptiveCharacter(project, characterId);
    const skins = character.vectorSkins ?? [];
    const remaining = skins.filter((skin) => skin.id !== skinId);
    if (remaining.length === skins.length) throw new Error('未找到要删除的蒙皮。');
    return replaceCharacter(project, character, {
      ...character,
      ...(remaining.length > 0 ? { vectorSkins: remaining } : { vectorSkins: undefined }),
    });
  }

  list(project: Project, characterId: string): readonly CharacterVectorSkin[] {
    return adaptiveCharacter(project, characterId).vectorSkins ?? [];
  }

  /** Runtime weights/fallback rows for the Inspector at one Shot time. */
  describe(
    project: Project,
    input: { readonly shotId: string; readonly layerId: string; readonly timeMs: number },
  ): readonly CharacterVectorSkinStatusRow[] {
    const shot = project.shots.find((candidate) => candidate.id === input.shotId);
    const layer = shot?.layers.find((candidate) => candidate.id === input.layerId);
    if (!shot || !layer || layer.source.kind !== 'character') throw new Error('请选择角色图层。');
    if (!isValidFrameTime(input.timeMs) || input.timeMs > shot.durationMs) {
      throw new Error('请选择镜头内的有效帧。');
    }
    const character = adaptiveCharacter(project, layer.source.characterId);
    const skins = character.vectorSkins ?? [];
    if (skins.length === 0) return [];
    const requiresAnimationClip = layer.animationClip?.version !== 1;
    const evaluated = evaluateShotAtTime(shot, input.timeMs, project)
      .layers.find((candidate) => candidate.id === layer.id);
    let statusByPartId = new Map<string, LayerVisualPartVectorSkinStatus>();
    if (evaluated) {
      const visual = resolveLayerVisualParts(project, shot, evaluated, input.timeMs);
      statusByPartId = new Map(visual.parts.flatMap((part) =>
        part.vectorSkin && part.source.kind === 'adaptive-part-fla-graphic'
          ? [[part.source.characterPartId, part.vectorSkin] as const]
          : []));
    }
    return skins.map((skin): CharacterVectorSkinStatusRow => {
      const partIndex = character.parts.findIndex((part) => part.partId === skin.partId);
      const part = character.parts[partIndex];
      return {
        skin,
        partId: skin.partId,
        partName: part ? partDisplayName(part, partIndex) : skin.partId,
        boneNames: [
          boneDisplayName(character, skin.boneIds[0]),
          boneDisplayName(character, skin.boneIds[1]),
        ],
        ...(statusByPartId.get(skin.partId) ? { status: statusByPartId.get(skin.partId)! } : {}),
        requiresAnimationClip,
      };
    });
  }
}
