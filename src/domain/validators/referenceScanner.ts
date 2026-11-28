import { resolveCharacterPartVisualSource } from '../models/character';
import type { Project } from '../models/project';
import { reconstructFlaGraphicStructure } from '../models/flaGraphicStructure';
import { findTalkingAnimation, listTalkingAnimationImageIds, resolveCharacterFaceSource, resolveCharacterFaceSourceOrNull } from '../selectors/characterFaceSource';

export type AssetReferenceKind =
  | 'character-base'
  | 'character-body'
  | 'character-head'
  | 'character-part'
  | 'character-expression'
  | 'character-mouth'
  | 'shot-background'
  | 'shot-layer'
  | 'audio-clip'
  | 'dialogue-audio'
  | 'animation-frame'
  | 'animation-structure';

export interface AssetReference {
  kind: AssetReferenceKind;
  path: string;
  label: string;
}

export type CharacterReferenceKind =
  | 'shot-layer-character'
  | 'dialogue-character';

export interface CharacterReference {
  kind: CharacterReferenceKind;
  path: string;
  label: string;
}

export type ExpressionReferenceKind =
  | 'shot-layer-expression'
  | 'timeline-expression-event';

export interface ExpressionReference {
  kind: ExpressionReferenceKind;
  path: string;
  label: string;
}

export interface CharacterActionReference {
  kind: 'timeline-character-action-event' | 'character-action-origin';
  path: string;
  label: string;
}

function dialoguePreview(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 160
    ? normalized
    : `${normalized.slice(0, 159)}…`;
}

export function scanAssetReferences(
  project: Project,
  assetId: string,
): AssetReference[] {
  const references: AssetReference[] = [];

  project.animations.forEach((animation, animationIndex) => {
    if ('kind' in animation && animation.kind === 'fla-graphic' && animation.structure &&
        reconstructFlaGraphicStructure(animation.structure).some(({ node }) =>
          (node.type === 'bitmap' && node.assetId === assetId) ||
          (node.type === 'opaque' && node.fallbackAssetId === assetId),
        )) {
      references.push({
        kind: 'animation-structure',
        path: `animations[${animationIndex}].structure`,
        label: `动画“${animation.name}”的元件内容`,
      });
    }
    animation.frames.forEach((frame, frameIndex) => {
      if (frame.assetId !== assetId) return;
      references.push({
        kind: 'animation-frame',
        path: `animations[${animationIndex}].frames[${frameIndex}].assetId`,
        label: `Animation “${animation.name}” frame ${frame.ordinal + 1}`,
      });
    });
  });

  project.characters.forEach((character, characterIndex) => {
    for (const [poseIndex, pose] of (character.mouthPoseSet?.poses ?? []).entries()) {
      const resolved = resolveCharacterFaceSourceOrNull(project, pose.source);
      if (resolved?.assetId === assetId || resolved?.flaGraphic?.resourceAssetIds.includes(assetId)) {
        references.push({ kind: 'character-mouth', path: `characters[${characterIndex}].mouthPoseSet.poses[${poseIndex}].source`,
          label: `角色“${character.name}”的口型“${pose.name}”` });
      }
    }
    const talking = findTalkingAnimation(project, character.talkingAnimationId);
    if (talking && listTalkingAnimationImageIds(talking).has(assetId)) {
      references.push({
        kind: 'character-mouth',
        path: `characters[${characterIndex}].talkingAnimationId`,
        label: `角色“${character.name}”的说话动画`,
      });
    }
    for (const [expressionId, source] of Object.entries(character.expressionTalkingSources ?? {})) {
      const animation = findTalkingAnimation(project, source.animationId);
      if (!animation || !listTalkingAnimationImageIds(animation).has(assetId)) continue;
      const expression = (character.expressions ?? []).find((entry) => entry.id === expressionId);
      references.push({
        kind: 'character-mouth',
        path: `characters[${characterIndex}].expressionTalkingSources.${expressionId}`,
        label: `角色“${character.name}”的表情“${expression?.name ?? ''}”专属说话动画`,
      });
    }
    if (character.mode === 'adaptive-parts') {
      character.parts.forEach((part, partIndex) => {
        const visualSource = resolveCharacterPartVisualSource(part);
        if (visualSource.kind !== 'image' || visualSource.assetId !== assetId) {
          return;
        }
        references.push({
          kind: 'character-part',
          path: `characters[${characterIndex}].parts[${partIndex}].${part.visualSource ? 'visualSource.assetId' : 'assetId'}`,
          label:
            `Character "${character.name}" Part ` +
            `${part.displayName ?? part.partId}`,
        });
      });
      (character.expressions ?? []).forEach((expression, expressionIndex) => {
        if (expression.visualSource && resolveCharacterFaceSource(project, expression.visualSource).flaGraphic?.resourceAssetIds.includes(assetId)) {
          references.push({ kind: 'character-expression', path: `characters[${characterIndex}].expressions[${expressionIndex}].visualSource`, label: `角色“${character.name}”的表情“${expression.name}”` });
        }
        if (expression.assetId !== assetId) return;
        references.push({
          kind: 'character-expression',
          path:
            `characters[${characterIndex}].expressions` +
            `[${expressionIndex}].assetId`,
          label: `角色“${character.name}”的表情“${expression.name}”`,
        });
      });
      if (character.mouthOpenAssetId === assetId) {
        references.push({
          kind: 'character-mouth',
          path: `characters[${characterIndex}].mouthOpenAssetId`,
          label: `角色“${character.name}”的张嘴图片`,
        });
      }
      if (character.mouthOpenVisualSource && resolveCharacterFaceSource(project, character.mouthOpenVisualSource).flaGraphic?.resourceAssetIds.includes(assetId)) {
        references.push({ kind: 'character-mouth', path: `characters[${characterIndex}].mouthOpenVisualSource`, label: `角色“${character.name}”的张嘴状态` });
      }
      return;
    }
    if (character.baseAssetId === assetId) {
      references.push({
        kind: 'character-base',
        path: `characters[${characterIndex}].baseAssetId`,
        label: `角色“${character.name}”的基础图片`,
      });
    }
    if (character.mode === 'composite' && character.bodyAssetId === assetId) {
      references.push({
        kind: 'character-body',
        path: `characters[${characterIndex}].bodyAssetId`,
        label: `角色“${character.name}”的身体图片`,
      });
    }
    if (character.mode === 'composite' && character.head?.assetId === assetId) {
      references.push({
        kind: 'character-head',
        path: `characters[${characterIndex}].head.assetId`,
        label: `Character “${character.name}” Head image`,
      });
    }
    character.expressions.forEach((expression, expressionIndex) => {
      if (expression.visualSource && resolveCharacterFaceSource(project, expression.visualSource).flaGraphic?.resourceAssetIds.includes(assetId)) {
        references.push({ kind: 'character-expression', path: `characters[${characterIndex}].expressions[${expressionIndex}].visualSource`, label: `角色“${character.name}”的表情“${expression.name}”` });
      }
      if (expression.assetId !== assetId) return;
      references.push({
        kind: 'character-expression',
        path:
          `characters[${characterIndex}].expressions` +
          `[${expressionIndex}].assetId`,
        label: `角色“${character.name}”的表情“${expression.name}”`,
      });
    });
    if (character.mouthOpenAssetId === assetId) {
      references.push({
        kind: 'character-mouth',
        path: `characters[${characterIndex}].mouthOpenAssetId`,
        label: `角色“${character.name}”的张嘴图片`,
      });
    }
    if (character.mouthOpenVisualSource && resolveCharacterFaceSource(project, character.mouthOpenVisualSource).flaGraphic?.resourceAssetIds.includes(assetId)) {
      references.push({ kind: 'character-mouth', path: `characters[${characterIndex}].mouthOpenVisualSource`, label: `角色“${character.name}”的张嘴状态` });
    }
  });

  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (layer.source.kind === 'video') {
        if (layer.source.assetId === assetId) {
          references.push({
            kind: 'shot-layer',
            path: `shots[${shotIndex}].layers[${layerIndex}].source.assetId`,
            label: `镜头“${shot.name}”的视频图层“${layer.name}”`,
          });
        }
        if (layer.source.audioAssetId === assetId) {
          references.push({
            kind: 'shot-layer',
            path: `shots[${shotIndex}].layers[${layerIndex}].source.audioAssetId`,
            label: `镜头“${shot.name}”的视频音轨“${layer.name}”`,
          });
        }
        return;
      }
      if (
        layer.source.kind !== 'asset' ||
        layer.source.assetId !== assetId
      ) {
        return;
      }
      const background = shot.backgroundLayerId === layer.id;
      references.push({
        kind: background ? 'shot-background' : 'shot-layer',
        path:
          `shots[${shotIndex}].layers[${layerIndex}]` +
          '.source.assetId',
        label: `镜头“${shot.name}”的${background ? '背景' : '图层'}“${layer.name}”`,
      });
    });

    shot.audioClips.forEach((clip, clipIndex) => {
      if (clip.assetId !== assetId) return;
      references.push({
        kind: 'audio-clip',
        path: `shots[${shotIndex}].audioClips[${clipIndex}].assetId`,
        label: `镜头“${shot.name}”的音频片段“${clip.name}”`,
      });
      shot.dialogues.forEach((dialogue, dialogueIndex) => {
        if (dialogue.audioClipId !== clip.id) return;
        references.push({
          kind: 'dialogue-audio',
          path:
            `shots[${shotIndex}].dialogues[${dialogueIndex}]` +
            '.audioClipId',
          label:
            `镜头“${shot.name}”的对白` +
            `“${dialoguePreview(dialogue.text)}”`,
        });
      });
    });
  });

  return references;
}

export type AnimationDefinitionReferenceKind =
  | 'shot-layer'
  | 'shot-background'
  | 'timeline-graphic-event'
  | 'character-expression'
  | 'character-mouth'
  | 'character-talking'
  | 'character-action'
  | 'character-part'
  | 'animation-segment';

export interface AnimationDefinitionReference {
  kind: AnimationDefinitionReferenceKind;
  path: string;
  label: string;
}

/**
 * Lists every persisted owner that still references one Animation Definition.
 * Reused by Definition deletion protection so a shared/native Graphic can never
 * be removed while a Layer instance, Character part, event, or saved segment
 * still points at it.
 */
export function scanAnimationDefinitionReferences(
  project: Project,
  animationId: string,
): AnimationDefinitionReference[] {
  const references: AnimationDefinitionReference[] = [];

  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (layer.source.kind !== 'animation' || layer.source.animationId !== animationId) return;
      const isBackground = shot.backgroundLayerId === layer.id;
      references.push({
        kind: isBackground ? 'shot-background' : 'shot-layer',
        path: `shots[${shotIndex}].layers[${layerIndex}].source.animationId`,
        label: `镜头“${shot.name}”的${isBackground ? '背景' : '动画'}图层“${layer.name}”`,
      });
    });
    shot.timelineEvents.forEach((event, eventIndex) => {
      if (
        (event.type === 'graphic-frame' || event.type === 'graphic-playback') &&
        event.animationId === animationId
      ) {
        references.push({
          kind: 'timeline-graphic-event',
          path: `shots[${shotIndex}].timelineEvents[${eventIndex}].animationId`,
          label: `镜头“${shot.name}”的元件帧事件`,
        });
      }
    });
  });

  for (const [animationSegmentIndex, segment] of (project.animationSegments ?? []).entries()) {
    if (segment.animationId !== animationId) continue;
    references.push({
      kind: 'animation-segment',
      path: `animationSegments[${animationSegmentIndex}].animationId`,
      label: `可复用片段“${segment.name}”`,
    });
  }

  project.characters.forEach((character, characterIndex) => {
    if (character.talkingAnimationId === animationId) {
      references.push({
        kind: 'character-talking',
        path: `characters[${characterIndex}].talkingAnimationId`,
        label: `角色“${character.name}”的说话动画`,
      });
    }
    for (const [expressionId, source] of Object.entries(character.expressionTalkingSources ?? {})) {
      if (source.animationId !== animationId) continue;
      const expression = (character.expressions ?? []).find((entry) => entry.id === expressionId);
      references.push({
        kind: 'character-talking',
        path: `characters[${characterIndex}].expressionTalkingSources.${expressionId}.animationId`,
        label: `角色“${character.name}”的表情“${expression?.name ?? ''}”专属说话动画`,
      });
    }
    for (const [poseIndex, pose] of (character.mouthPoseSet?.poses ?? []).entries()) {
      if (pose.source.kind !== 'fla-graphic' || pose.source.animationId !== animationId) continue;
      references.push({
        kind: 'character-mouth',
        path: `characters[${characterIndex}].mouthPoseSet.poses[${poseIndex}].source.animationId`,
        label: `角色“${character.name}”的口型“${pose.name}”`,
      });
    }
    if (
      character.mouthOpenVisualSource &&
      character.mouthOpenVisualSource.animationId === animationId
    ) {
      references.push({
        kind: 'character-mouth',
        path: `characters[${characterIndex}].mouthOpenVisualSource.animationId`,
        label: `角色“${character.name}”的张嘴状态`,
      });
    }
    (character.actions ?? []).forEach((action, actionIndex) => {
      if (!('animationId' in action) || action.animationId !== animationId) return;
      references.push({
        kind: 'character-action',
        path: `characters[${characterIndex}].actions[${actionIndex}].animationId`,
        label: `角色“${character.name}”的动作`,
      });
    });
    (character.expressions ?? []).forEach((expression, expressionIndex) => {
      if (expression.visualSource?.animationId !== animationId) return;
      references.push({
        kind: 'character-expression',
        path: `characters[${characterIndex}].expressions[${expressionIndex}].visualSource.animationId`,
        label: `角色“${character.name}”的表情“${expression.name}”`,
      });
    });
    if (character.mode === 'adaptive-parts') {
      character.parts.forEach((part, partIndex) => {
        const visualSource = resolveCharacterPartVisualSource(part);
        if (visualSource.kind !== 'fla-graphic' || visualSource.animationId !== animationId) return;
        references.push({
          kind: 'character-part',
          path: `characters[${characterIndex}].parts[${partIndex}].visualSource.animationId`,
          label: `角色“${character.name}”的零件“${part.displayName ?? part.partId}”`,
        });
      });
    }
  });

  return references;
}

export function scanCharacterReferences(
  project: Project,
  characterId: string,
): CharacterReference[] {
  const references: CharacterReference[] = [];
  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (
        layer.source.kind !== 'character' ||
        layer.source.characterId !== characterId
      ) {
        return;
      }
      references.push({
        kind: 'shot-layer-character',
        path:
          `shots[${shotIndex}].layers[${layerIndex}]` +
          '.source.characterId',
        label: `镜头“${shot.name}”的角色图层“${layer.name}”`,
      });
    });
    shot.dialogues.forEach((dialogue, dialogueIndex) => {
      if (dialogue.characterId !== characterId) return;
      references.push({
        kind: 'dialogue-character',
        path: `shots[${shotIndex}].dialogues[${dialogueIndex}].characterId`,
        label:
          `镜头“${shot.name}”的对白` +
          `“${dialoguePreview(dialogue.text)}”`,
      });
    });
  });
  return references;
}

export function hasCharacterFaceTimelineEvents(project: Project, characterId: string): boolean {
  return project.shots.some((shot) => {
    const layerIds = new Set(shot.layers.flatMap((layer) =>
      layer.source.kind === 'character' && layer.source.characterId === characterId
        ? [layer.id]
        : [],
    ));
    return shot.timelineEvents.some((event) =>
      (event.type === 'expression' || event.type === 'mouth-cue') && layerIds.has(event.layerId),
    );
  });
}

export function scanExpressionReferences(
  project: Project,
  characterId: string,
  expressionId: string,
): ExpressionReference[] {
  const references: ExpressionReference[] = [];
  project.shots.forEach((shot, shotIndex) => {
    const characterLayerIds = new Set<string>();
    shot.layers.forEach((layer, layerIndex) => {
      if (
        layer.source.kind !== 'character' ||
        layer.source.characterId !== characterId
      ) {
        return;
      }
      characterLayerIds.add(layer.id);
      if (layer.source.expressionId !== expressionId) return;
      references.push({
        kind: 'shot-layer-expression',
        path:
          `shots[${shotIndex}].layers[${layerIndex}]` +
          '.source.expressionId',
        label: `镜头“${shot.name}”的角色图层“${layer.name}”`,
      });
    });
    shot.timelineEvents.forEach((event, eventIndex) => {
      if (
        event.type !== 'expression' ||
        event.expressionId !== expressionId ||
        !characterLayerIds.has(event.layerId)
      ) {
        return;
      }
      references.push({
        kind: 'timeline-expression-event',
        path:
          `shots[${shotIndex}].timelineEvents[${eventIndex}]` +
          '.expressionId',
        label: `镜头“${shot.name}”的表情切换事件`,
      });
    });
  });
  return references;
}

export function scanCharacterActionReferences(
  project: Project,
  characterId: string,
  actionId: string,
): CharacterActionReference[] {
  const references: CharacterActionReference[] = [];
  project.shots.forEach((shot, shotIndex) => {
    const characterLayerIds = new Set(shot.layers.flatMap((layer) =>
      layer.source.kind === 'character' && layer.source.characterId === characterId
        ? [layer.id]
        : [],
    ));
    shot.timelineEvents.forEach((event, eventIndex) => {
      if (
        event.type !== 'character-action' ||
        event.actionId !== actionId ||
        !characterLayerIds.has(event.layerId)
      ) {
        return;
      }
      references.push({
        kind: 'timeline-character-action-event',
        path: `shots[${shotIndex}].timelineEvents[${eventIndex}].actionId`,
        label: `镜头“${shot.name}”中的角色动作段`,
      });
    });
  });
  // #1449: instance-scoped copies keep a provenance link to their origin action.
  const character = project.characters.find((entry) => entry.id === characterId);
  const characterIndex = project.characters.findIndex((entry) => entry.id === characterId);
  (character && 'actions' in character ? character.actions ?? [] : []).forEach((action, actionIndex) => {
    if (!('originActionId' in action) || action.originActionId !== actionId) return;
    references.push({
      kind: 'character-action-origin',
      path: `characters[${characterIndex}].actions[${actionIndex}].originActionId`,
      label: `动作“${action.name}”是它的独立副本`,
    });
  });
  return references;
}
