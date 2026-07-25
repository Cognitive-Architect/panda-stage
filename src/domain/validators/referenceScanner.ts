import type { Project } from '../models/project';

export type AssetReferenceKind =
  | 'character-base'
  | 'character-expression'
  | 'shot-background'
  | 'shot-layer'
  | 'audio-clip'
  | 'dialogue-audio';

export interface AssetReference {
  kind: AssetReferenceKind;
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

  project.characters.forEach((character, characterIndex) => {
    if (character.baseAssetId === assetId) {
      references.push({
        kind: 'character-base',
        path: `characters[${characterIndex}].baseAssetId`,
        label: `角色“${character.name}”的基础图片`,
      });
    }
    character.expressions.forEach((expression, expressionIndex) => {
      if (expression.assetId !== assetId) return;
      references.push({
        kind: 'character-expression',
        path:
          `characters[${characterIndex}].expressions` +
          `[${expressionIndex}].assetId`,
        label: `角色“${character.name}”的表情“${expression.name}”`,
      });
    });
  });

  project.shots.forEach((shot, shotIndex) => {
    shot.layers.forEach((layer, layerIndex) => {
      if (
        layer.source.kind !== 'asset' ||
        layer.source.assetId !== assetId
      ) {
        return;
      }
      const background =
        layer.zIndex === 0 || /background|背景/iu.test(layer.name);
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
