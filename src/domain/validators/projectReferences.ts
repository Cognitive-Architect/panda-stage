import type { z } from 'zod';
import {
  resolveFlaGraphicStructureFrame,
  resolveFlaGraphicSymbolChildren,
  type FlaGraphicStructureNode,
} from '../models/flaGraphicStructure';
import { isTalkingAnimationPlaybackInRange, resolveFlaGraphicPreviewTimeline } from '../selectors/animationSourceTimeline';
import { isFlaGraphicDefinition } from '../models/animation';
import { resolveCharacterPartVisualSource } from '../models/character';
import type { ProjectData } from '../models/project';
import { isNarratorDialogue } from '../models/dialogue';

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: 'custom', path, message });
}

function validateUniqueIds(
  values: readonly { id: string }[],
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue(context, [...path, index, 'id'], `Duplicate id: ${value.id}`);
    }
    seen.add(value.id);
  });
}

function validateUniqueNames(
  values: readonly { name: string }[],
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const normalized = value.name.trim().toLocaleLowerCase();
    if (seen.has(normalized)) {
      addIssue(
        context,
        [...path, index, 'name'],
        `Duplicate name: ${value.name}`,
      );
    }
    seen.add(normalized);
  });
}

export function validateProjectReferences(
  project: Omit<ProjectData, 'schemaVersion'>,
  context: z.RefinementCtx,
): void {
  validateUniqueIds(project.assets, ['assets'], context);
  validateUniqueIds(project.animations, ['animations'], context);
  validateUniqueNames(project.animations, ['animations'], context);
  validateUniqueIds(project.characters, ['characters'], context);
  validateUniqueNames(project.characters, ['characters'], context);
  validateUniqueIds(project.voiceProfiles, ['voiceProfiles'], context);
  validateUniqueIds(project.subtitleStyles, ['subtitleStyles'], context);
  validateUniqueIds(project.shots, ['shots'], context);

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const animations = new Map(
    project.animations.map((animation) => [animation.id, animation]),
  );
  function validateFaceGraphic(source: { animationId: string; firstFrame: number }, path: PropertyKey[]): void {
    const definition = animations.get(source.animationId);
    if (!definition || !isFlaGraphicDefinition(definition)) {
      addIssue(context, [...path, 'animationId'], `Unknown FLA Graphic Definition: ${source.animationId}`);
    } else if (source.firstFrame >= definition.frames.length || !definition.frames[source.firstFrame]) {
      addIssue(context, [...path, 'firstFrame'], 'Graphic firstFrame is outside the Definition frame range.');
    }
  }
  const characters = new Map(
    project.characters.map((character) => [character.id, character]),
  );
  const voiceProfiles = new Map(
    project.voiceProfiles.map((profile) => [profile.id, profile]),
  );
  const subtitleStyles = new Set(
    project.subtitleStyles.map((style) => style.id),
  );

  project.animations.forEach((animation, animationIndex) => {
    const isFlaGraphic = 'kind' in animation && animation.kind === 'fla-graphic';
    const structure = isFlaGraphic ? animation.structure : undefined;
    const validatedNestedDefinitions = new Set<string>();
    const validateStructureNodes = (
      nodes: readonly FlaGraphicStructureNode[],
      nodePathPrefix: PropertyKey[],
    ): void => {
      nodes.forEach((node, nodeIndex) => {
        const path = [...nodePathPrefix, nodeIndex];
        if (node.type === 'bitmap' && node.assetId) {
          const bitmapAsset = assets.get(node.assetId);
          if (!bitmapAsset || bitmapAsset.kind !== 'image') {
            addIssue(
              context,
              [...path, 'assetId'],
              `FLA Graphic structured bitmap references unknown or non-image asset: ${node.assetId}`,
            );
          }
        } else if (
          node.type === 'opaque' &&
          node.fallbackAssetId &&
          node.fallbackScope &&
          node.fallbackViewBox
        ) {
          const fallbackAsset = assets.get(node.fallbackAssetId);
          if (!fallbackAsset || fallbackAsset.kind !== 'image') {
            addIssue(
              context,
              [...path, 'fallbackAssetId'],
              `FLA Graphic structured opaque fallback references unknown or non-image asset: ${node.fallbackAssetId}`,
            );
          }
        } else if (node.type === 'group') {
          validateStructureNodes(node.children, [...path, 'children']);
        } else if (node.type === 'symbol') {
          if (node.nestedDefinitionId) {
            if (!validatedNestedDefinitions.has(node.nestedDefinitionId)) {
              validatedNestedDefinitions.add(node.nestedDefinitionId);
              validateStructureNodes(
                resolveFlaGraphicSymbolChildren(node, structure),
                ['animations', animationIndex, 'structure', 'symbolDefinitions', node.nestedDefinitionId, 'children'],
              );
            }
          } else if (node.children) {
            validateStructureNodes(node.children, [...path, 'children']);
          }
        }
      });
    };

    animation.frames.forEach((frame, frameIndex) => {
      const structureFrame = structure
        ? resolveFlaGraphicStructureFrame(structure, frame.ordinal)?.frame
        : undefined;
      if (structureFrame) {
        structureFrame.layers.forEach((layer, layerIndex) => {
          validateStructureNodes(layer.nodes, [
            'animations',
            animationIndex,
            'structure',
            'frames',
            frame.ordinal,
            'layers',
            layerIndex,
            'nodes',
          ]);
        });
        return;
      }

      const asset = frame.assetId ? assets.get(frame.assetId) : undefined;
      if (!asset || asset.kind !== 'image') {
        addIssue(
          context,
          ['animations', animationIndex, 'frames', frameIndex, 'assetId'],
          `Animation references unknown or non-image asset: ${frame.assetId}`,
        );
      } else if (asset.sha256 !== frame.sha256) {
        addIssue(
          context,
          ['animations', animationIndex, 'frames', frameIndex, 'sha256'],
          `Animation frame hash does not match image asset ${asset.id}.`,
        );
      }
      if (isFlaGraphic) {
        if (
          !asset ||
          asset.kind !== 'image' ||
          asset.mimeType !== 'image/svg+xml' ||
          asset.flaGraphicFrame?.definitionId !== animation.id ||
          asset.flaGraphicFrame.ordinal !== frame.ordinal
        ) {
          addIssue(
            context,
            ['animations', animationIndex, 'frames', frameIndex, 'assetId'],
            `FLA Graphic frame ${frame.assetId} is not an SVG owned by Definition ${animation.id}.`,
          );
        }
      }
    });
  });

  project.characters.forEach((character, characterIndex) => {
    for (const [poseIndex, pose] of (character.mouthPoseSet?.poses ?? []).entries()) {
      const path = ['characters', characterIndex, 'mouthPoseSet', 'poses', poseIndex];
      if (pose.source.kind === 'fla-graphic') {
        validateFaceGraphic(pose.source, [...path, 'source']);
        const animation = animations.get(pose.source.animationId);
        if (pose.source.internalTimeMs !== undefined && animation && isFlaGraphicDefinition(animation)) {
          const timeline = resolveFlaGraphicPreviewTimeline(animation, true);
          const frame = Math.round(pose.source.internalTimeMs * timeline.fps / 1_000);
          const sample = timeline.sampleAtFrameIndex(frame);
          if (frame >= timeline.totalFrames || sample.frameOrdinal !== pose.source.firstFrame) {
            addIssue(context, [...path, 'source', 'internalTimeMs'], 'Mouth pose sample is outside its Graphic frame.');
          }
        }
      } else if (assets.get(pose.source.assetId)?.kind !== 'image') {
        addIssue(context, [...path, 'source', 'assetId'], 'Mouth pose requires an existing image.');
      }
      if (pose.target.kind === 'mouth') {
        const { partId } = pose.target;
        if (character.mode !== 'adaptive-parts' || !character.parts.some((part) => part.partId === partId)) {
          addIssue(context, [...path, 'target', 'partId'], 'Mouth pose requires an existing character part.');
        }
      }
    }
    const talkingAnimation = character.talkingAnimationId ? animations.get(character.talkingAnimationId) : undefined;
    if (character.talkingAnimationId && !talkingAnimation) {
      addIssue(context, ['characters', characterIndex, 'talkingAnimationId'], 'Unknown talking animation.');
    }
    if (character.talkingAnimationPlayback && (!talkingAnimation ||
      !isTalkingAnimationPlaybackInRange(talkingAnimation, character.talkingAnimationPlayback))) {
      addIssue(context, ['characters', characterIndex, 'talkingAnimationPlayback'], 'Talking animation frame is outside the source timeline.');
    }
    (character.actions ?? []).forEach((action, actionIndex) => {
      if ('kind' in action) {
        if (character.mode !== 'adaptive-parts') {
          addIssue(context, ['characters', characterIndex, 'actions', actionIndex], 'Layered actions require an Adaptive Parts Character.');
        }
        return;
      }
      if (!animations.has(action.animationId)) {
        addIssue(
          context,
          ['characters', characterIndex, 'actions', actionIndex, 'animationId'],
          `Character action references unknown animation: ${action.animationId}`,
        );
      }
    });
    if (character.mode === 'adaptive-parts') {
      character.parts.forEach((part, partIndex) => {
        const visualSource = resolveCharacterPartVisualSource(part);
        if (visualSource.kind === 'fla-graphic') {
          const definition = animations.get(visualSource.animationId);
          if (!definition || !isFlaGraphicDefinition(definition)) {
            addIssue(
              context,
              [
                'characters',
                characterIndex,
                'parts',
                partIndex,
                'visualSource',
                'animationId',
              ],
              `Part references unknown or non-FLA Graphic definition: ${visualSource.animationId}`,
            );
            return;
          }
          if (!definition.structure && !visualSource.nodePath) {
            addIssue(
              context,
              [
                'characters',
                characterIndex,
                'parts',
                partIndex,
                'visualSource',
                'animationId',
              ],
              `Part requires a structured FLA Graphic definition: ${visualSource.animationId}`,
            );
          }
          return;
        }
        const partAsset = assets.get(visualSource.assetId);
        if (!partAsset || partAsset.kind !== 'image') {
          addIssue(
            context,
            [
              'characters',
              characterIndex,
              'parts',
              partIndex,
              part.visualSource ? 'visualSource' : 'assetId',
            ],
            `Part references unknown or non-image asset: ${visualSource.assetId}`,
          );
          return;
        }
        const expectedWidth = Math.round(
          visualSource.imageMapping.crop.width *
            visualSource.imageMapping.exportScale,
        );
        const expectedHeight = Math.round(
          visualSource.imageMapping.crop.height *
            visualSource.imageMapping.exportScale,
        );
        if (
          partAsset.width !== expectedWidth ||
          partAsset.height !== expectedHeight
        ) {
          addIssue(
            context,
            [
              'characters',
              characterIndex,
              'parts',
              partIndex,
              part.visualSource ? 'visualSource' : 'imageMapping',
            ],
            `Part crop mapping resolves to ${expectedWidth}×${expectedHeight}, but asset ${partAsset.id} is ${partAsset.width}×${partAsset.height}.`,
          );
        }
      });

      const adaptiveExpressions = character.expressions ?? [];
      if (adaptiveExpressions.length > 0) {
        validateUniqueIds(
          adaptiveExpressions,
          ['characters', characterIndex, 'expressions'],
          context,
        );
        validateUniqueNames(
          adaptiveExpressions,
          ['characters', characterIndex, 'expressions'],
          context,
        );
        adaptiveExpressions.forEach((expression, expressionIndex) => {
          if (expression.visualSource) {
            validateFaceGraphic(
              expression.visualSource,
              ['characters', characterIndex, 'expressions', expressionIndex, 'visualSource'],
            );
            return;
          }
          const expressionAsset = expression.assetId ? assets.get(expression.assetId) : undefined;
          if (!expressionAsset || expressionAsset.kind !== 'image') {
            addIssue(
              context,
              [
                'characters',
                characterIndex,
                'expressions',
                expressionIndex,
                'assetId',
              ],
              `Expression references unknown or non-image asset: ${expression.assetId}`,
            );
          }
        });
      }
      if (character.mouthOpenAssetId) {
        const mouthAsset = assets.get(character.mouthOpenAssetId);
        if (!mouthAsset || mouthAsset.kind !== 'image') {
          addIssue(
            context,
            ['characters', characterIndex, 'mouthOpenAssetId'],
            `Character references unknown or non-image mouth asset: ${character.mouthOpenAssetId}`,
          );
        }
      }
      if (character.mouthOpenVisualSource) {
        validateFaceGraphic(
          character.mouthOpenVisualSource,
          ['characters', characterIndex, 'mouthOpenVisualSource'],
        );
      }
    } else {
      validateUniqueIds(
        character.expressions,
        ['characters', characterIndex, 'expressions'],
        context,
      );
      validateUniqueNames(
        character.expressions,
        ['characters', characterIndex, 'expressions'],
        context,
      );
      const baseAsset = character.baseAssetId ? assets.get(character.baseAssetId) : undefined;
      const defaultGraphic = character.expressions.find((expression) => expression.id === character.defaultExpressionId)?.visualSource;
      if (!defaultGraphic && (!baseAsset || baseAsset.kind !== 'image')) {
        addIssue(
          context,
          ['characters', characterIndex, 'baseAssetId'],
          `Character references unknown or non-image base asset: ${character.baseAssetId}`,
        );
      }
      character.expressions.forEach((expression, expressionIndex) => {
        if (expression.visualSource) {
          validateFaceGraphic(expression.visualSource, ['characters', characterIndex, 'expressions', expressionIndex, 'visualSource']);
          return;
        }
        const expressionAsset = expression.assetId ? assets.get(expression.assetId) : undefined;
        if (!expressionAsset || expressionAsset.kind !== 'image') {
          addIssue(
            context,
            [
              'characters',
              characterIndex,
              'expressions',
              expressionIndex,
              'assetId',
            ],
            `Expression references unknown or non-image asset: ${expression.assetId}`,
          );
        }
      });
      const defaultExpression = character.expressions.find(
        (expression) => expression.id === character.defaultExpressionId,
      );
      if (!defaultExpression) {
        addIssue(
          context,
          ['characters', characterIndex, 'defaultExpressionId'],
          `Character references an unknown default expression: ${character.defaultExpressionId}`,
        );
      } else if (defaultExpression.assetId !== character.baseAssetId) {
        addIssue(
          context,
          ['characters', characterIndex, 'baseAssetId'],
          'Character baseAssetId must match the default expression asset.',
        );
      }
      if (character.mouthOpenAssetId) {
        const mouthAsset = assets.get(character.mouthOpenAssetId);
        if (!mouthAsset || mouthAsset.kind !== 'image') {
          addIssue(
            context,
            ['characters', characterIndex, 'mouthOpenAssetId'],
            `Character references unknown or non-image mouth asset: ${character.mouthOpenAssetId}`,
          );
        }
      }
      if (character.mouthOpenVisualSource) {
        validateFaceGraphic(character.mouthOpenVisualSource, ['characters', characterIndex, 'mouthOpenVisualSource']);
      }
      if (character.mode === 'composite') {
        const bodyAsset = assets.get(character.bodyAssetId);
        if (!bodyAsset || bodyAsset.kind !== 'image') {
          addIssue(
            context,
            ['characters', characterIndex, 'bodyAssetId'],
            `Composite character references unknown or non-image body asset: ${character.bodyAssetId}`,
          );
        }
        if (character.head) {
          const headAsset = assets.get(character.head.assetId);
          if (!headAsset || headAsset.kind !== 'image') {
            addIssue(
              context,
              ['characters', characterIndex, 'head', 'assetId'],
              `Composite character references unknown or non-image Head asset: ${character.head.assetId}`,
            );
          }
        }
      }
    }
    const defaultVoice = voiceProfiles.get(character.defaultVoiceProfileId);
    if (!defaultVoice || defaultVoice.characterId !== character.id) {
      addIssue(
        context,
        ['characters', characterIndex, 'defaultVoiceProfileId'],
        `Character references an unknown or foreign voice profile: ${character.defaultVoiceProfileId}`,
      );
    }
  });

  project.voiceProfiles.forEach((profile, profileIndex) => {
    if (!characters.has(profile.characterId)) {
      addIssue(
        context,
        ['voiceProfiles', profileIndex, 'characterId'],
        `Voice profile references unknown character: ${profile.characterId}`,
      );
    }
  });

  project.shots.forEach((shot, shotIndex) => {
    validateUniqueIds(shot.layers, ['shots', shotIndex, 'layers'], context);
    validateUniqueIds(
      shot.dialogues,
      ['shots', shotIndex, 'dialogues'],
      context,
    );
    validateUniqueIds(
      shot.audioClips,
      ['shots', shotIndex, 'audioClips'],
      context,
    );
    validateUniqueIds(
      shot.timelineEvents,
      ['shots', shotIndex, 'timelineEvents'],
      context,
    );
    if (!subtitleStyles.has(shot.defaultSubtitleStyleId)) {
      addIssue(
        context,
        ['shots', shotIndex, 'defaultSubtitleStyleId'],
        `Shot references unknown subtitle style: ${shot.defaultSubtitleStyleId}`,
      );
    }

    const layers = new Map(shot.layers.map((layer) => [layer.id, layer]));
    if (shot.backgroundLayerId !== null) {
      const background = layers.get(shot.backgroundLayerId);
      if (!background) {
        addIssue(
          context,
          ['shots', shotIndex, 'backgroundLayerId'],
          `Shot references unknown background layer: ${shot.backgroundLayerId}`,
        );
      } else {
        const backgroundAsset =
          background.source.kind === 'asset'
            ? assets.get(background.source.assetId)
            : undefined;
        const backgroundAnimation =
          background.source.kind === 'animation'
            ? animations.get(background.source.animationId)
            : undefined;
        const validAssetBackground =
          background.source.kind === 'asset' &&
          (!backgroundAsset || backgroundAsset.kind === 'image');
        const validGraphicBackground =
          background.source.kind === 'animation' &&
          (!backgroundAnimation || isFlaGraphicDefinition(backgroundAnimation));
        if (!validAssetBackground && !validGraphicBackground) {
          addIssue(
            context,
            ['shots', shotIndex, 'backgroundLayerId'],
            'Shot background layer must reference an image asset or FLA Graphic definition.',
          );
        }
      }
    }
    const audioClips = new Map(
      shot.audioClips.map((clip) => [clip.id, clip]),
    );
    shot.layers.forEach((layer, layerIndex) => {
      if (layer.source.kind === 'asset') {
        const asset = assets.get(layer.source.assetId);
        if (!asset || asset.kind !== 'image') {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'source', 'assetId'],
            `Layer references unknown or non-image asset: ${layer.source.assetId}`,
          );
        }
        return;
      }
      if (layer.source.kind === 'video') {
        const asset = assets.get(layer.source.assetId);
        if (!asset || asset.kind !== 'video') {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'source', 'assetId'],
            `Layer references unknown or non-video asset: ${layer.source.assetId}`,
          );
        }
        if (layer.source.audioAssetId) {
          const audioAsset = assets.get(layer.source.audioAssetId);
          if (!audioAsset || audioAsset.kind !== 'audio') {
            addIssue(
              context,
              ['shots', shotIndex, 'layers', layerIndex, 'source', 'audioAssetId'],
              `Video layer references unknown or non-audio asset: ${layer.source.audioAssetId}`,
            );
          }
        }
        return;
      }
      if (layer.source.kind === 'animation') {
        const animation = animations.get(layer.source.animationId);
        if (!animation) {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'source', 'animationId'],
            `Layer references unknown animation: ${layer.source.animationId}`,
          );
        } else if (
          layer.animationFirstFrame !== undefined &&
          layer.animationFirstFrame >= animation.frames.length
        ) {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'animationFirstFrame'],
            'Animation first frame is outside the referenced Definition.',
          );
        }
        if (
          layer.startTimeMs === undefined ||
          layer.startTimeMs > shot.durationMs
        ) {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'startTimeMs'],
            'Animation start time must be within the shot duration.',
          );
        }
        return;
      }
      if (layer.source.kind === 'control') return;
      const characterSource = layer.source;
      const character = characters.get(characterSource.characterId);
      if (!character) {
        addIssue(
          context,
          ['shots', shotIndex, 'layers', layerIndex, 'source', 'characterId'],
          `Layer references unknown character: ${characterSource.characterId}`,
        );
      } else if (character.mode === 'adaptive-parts') {
        if (characterSource.expressionId !== undefined) {
          const expressions = character.expressions ?? [];
          if (expressions.length === 0) {
            addIssue(
              context,
              ['shots', shotIndex, 'layers', layerIndex, 'source', 'expressionId'],
              `Adaptive Parts Layer ${layer.id} must not reference an Expression.`,
            );
          } else if (
            !expressions.some(
              (expression) => expression.id === characterSource.expressionId,
            )
          ) {
            addIssue(
              context,
              ['shots', shotIndex, 'layers', layerIndex, 'source', 'expressionId'],
              `Layer references unknown character expression: ${characterSource.expressionId}`,
            );
          }
        }
      } else if (
        !characterSource.expressionId ||
        !character.expressions.some(
          (expression) => expression.id === characterSource.expressionId,
        )
      ) {
        addIssue(
          context,
          ['shots', shotIndex, 'layers', layerIndex, 'source', 'expressionId'],
          `Layer references unknown character expression: ${characterSource.expressionId ?? '(missing)'}`,
        );
      }
    });

    shot.audioClips.forEach((clip, clipIndex) => {
      const asset = assets.get(clip.assetId);
      if (!asset || asset.kind !== 'audio') {
        addIssue(
          context,
          ['shots', shotIndex, 'audioClips', clipIndex, 'assetId'],
          `Audio clip references unknown or non-audio asset: ${clip.assetId}`,
        );
      } else {
        const requestedDurationMs = clip.endMs - clip.startMs;
        const requiredSourceEndMs = clip.offsetMs + requestedDurationMs;
        if (asset.durationMs === undefined) {
          addIssue(
            context,
            ['shots', shotIndex, 'audioClips', clipIndex, 'assetId'],
            `Audio clip cannot use asset ${asset.id} until its duration metadata is available.`,
          );
        } else if (requiredSourceEndMs > asset.durationMs) {
          addIssue(
            context,
            ['shots', shotIndex, 'audioClips', clipIndex, 'offsetMs'],
            `Audio clip request exceeds the source audio range: offsetMs=${clip.offsetMs} plus requested clip duration ${requestedDurationMs}ms requires source audio through ${requiredSourceEndMs}ms, but source durationMs=${asset.durationMs}.`,
          );
        }
      }
      if (clip.endMs > shot.durationMs) {
        addIssue(
          context,
          ['shots', shotIndex, 'audioClips', clipIndex, 'endMs'],
          'Audio clip must end within the shot duration.',
        );
      }
    });

    shot.dialogues.forEach((dialogue, dialogueIndex) => {
      // Narration has no Character and no VoiceProfile by contract; it must not
      // be forced through the Character reference checks. Character dialogues
      // (including every legacy dialogue without an explicit speakerType) keep
      // the original strict reference requirements.
      if (isNarratorDialogue(dialogue)) {
        if (dialogue.characterId !== undefined || dialogue.voiceProfileId !== undefined) {
          addIssue(
            context,
            ['shots', shotIndex, 'dialogues', dialogueIndex, 'speakerType'],
            'Narration dialogue must not reference a character or voice profile.',
          );
        }
      } else {
        const character = characters.get(dialogue.characterId ?? '');
        if (!character) {
          addIssue(
            context,
            ['shots', shotIndex, 'dialogues', dialogueIndex, 'characterId'],
            `Dialogue references unknown character: ${dialogue.characterId}`,
          );
        }
        const voiceProfile = voiceProfiles.get(dialogue.voiceProfileId ?? '');
        if (
          !voiceProfile ||
          voiceProfile.characterId !== dialogue.characterId
        ) {
          addIssue(
            context,
            ['shots', shotIndex, 'dialogues', dialogueIndex, 'voiceProfileId'],
            `Dialogue references an unknown or foreign voice profile: ${dialogue.voiceProfileId}`,
          );
        }
      }
      if (
        dialogue.audioClipId !== undefined &&
        !audioClips.has(dialogue.audioClipId)
      ) {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'audioClipId'],
          `Dialogue references unknown audio clip: ${dialogue.audioClipId}`,
        );
      }
      const boundClip = dialogue.audioClipId === undefined
        ? undefined : audioClips.get(dialogue.audioClipId);
      if (boundClip && boundClip.role !== 'dialogue') {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'audioClipId'],
          'Dialogue must reference a dialogue-role audio clip.',
        );
      }
      if (!subtitleStyles.has(dialogue.subtitleStyleId)) {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'subtitleStyleId'],
          `Dialogue references unknown subtitle style: ${dialogue.subtitleStyleId}`,
        );
      }
      if (dialogue.endMs > shot.durationMs) {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'endMs'],
          'Dialogue must end within the shot duration.',
        );
      }
    });

    const graphicFrameKeys = new Set<string>();
    const graphicPlaybackRanges = new Map<string, { startMs: number; endMs: number; index: number }[]>();
    shot.timelineEvents.forEach((event, eventIndex) => {
      const layer = layers.get(event.layerId);
      if (!layer) {
        addIssue(
          context,
          ['shots', shotIndex, 'timelineEvents', eventIndex, 'layerId'],
          `Timeline event references unknown layer: ${event.layerId}`,
        );
      }
      if (event.endMs > shot.durationMs) {
        addIssue(
          context,
          ['shots', shotIndex, 'timelineEvents', eventIndex, 'endMs'],
          'Timeline event must end within the shot duration.',
        );
      }
      if (event.type === 'graphic-frame' || event.type === 'graphic-playback') {
        const path = ['shots', shotIndex, 'timelineEvents', eventIndex];
        const definition = animations.get(event.animationId);
        if (layer?.source.kind !== 'animation' || layer.source.animationId !== event.animationId ||
            !definition || !isFlaGraphicDefinition(definition)) {
          addIssue(context, [...path, 'animationId'], 'Graphic event must reference its layer definition.');
        } else {
          const count = resolveFlaGraphicPreviewTimeline(definition, true).totalFrames;
          if (event.type === 'graphic-frame') {
            const offset = event.sourceFrameIndex - definition.source.startFrameIndex;
            if (offset < 0 || offset >= count) {
              addIssue(context, [...path, 'sourceFrameIndex'], 'Graphic frame switch is outside its source timeline.');
            }
          } else if (event.range.lastFrame >= count) {
            addIssue(context, [...path, 'range', 'lastFrame'], 'Graphic playback range is outside its source timeline.');
          }
        }
        if (event.type === 'graphic-frame') {
          const key = `${event.layerId}:${event.startMs}`;
          if (graphicFrameKeys.has(key)) addIssue(context, [...path, 'startMs'], 'Only one Graphic frame switch per layer and time.');
          graphicFrameKeys.add(key);
        } else {
          const ranges = graphicPlaybackRanges.get(event.layerId) ?? [];
          ranges.push({ startMs: event.startMs, endMs: event.endMs, index: eventIndex });
          graphicPlaybackRanges.set(event.layerId, ranges);
        }
      }
      if (event.type === 'expression' && layer) {
        if (layer.source.kind !== 'character') {
          addIssue(
            context,
            [
              'shots',
              shotIndex,
              'timelineEvents',
              eventIndex,
              'expressionId',
            ],
            'Expression events require a character layer.',
          );
        } else {
          const character = characters.get(layer.source.characterId);
          // Adaptive Parts can suspend face playback while unbound. The
          // persisted event still needs a valid expression on its owner.
          if (!(character?.expressions ?? []).some(
            (expression) => expression.id === event.expressionId,
          )) {
            addIssue(
              context,
              ['shots', shotIndex, 'timelineEvents', eventIndex, 'expressionId'],
              `Expression event references unknown expression: ${event.expressionId}`,
            );
          }
        }
      }
      if (event.type === 'mouth-cue' && layer) {
        if (layer.source.kind !== 'character') {
          addIssue(
            context,
            ['shots', shotIndex, 'timelineEvents', eventIndex, 'layerId'],
            'Mouth cue events require a character layer.',
          );
        }
        // Character existence is checked on the layer source above.
        // Authoring still requires a binding and configured mouth visual.
      }
      if (event.type === 'mouth-pose') {
        const path = ['shots', shotIndex, 'timelineEvents', eventIndex];
        const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
        const owner = characterId ? characters.get(characterId) : undefined;
        if (!owner?.mouthPoseSet?.poses.some((pose) => pose.id === event.poseId)) {
          addIssue(context, [...path, 'poseId'], 'Mouth pose is not defined on the instance character.');
        }
        if (event.dialogueId) {
          const dialogue = shot.dialogues.find((item) => item.id === event.dialogueId);
          if (!dialogue || !characterId || dialogue.characterId !== characterId ||
              event.startMs < dialogue.startMs || event.endMs > dialogue.endMs ||
              (event.origin === 'generated' && !dialogue.audioClipId)) {
            addIssue(context, [...path, 'dialogueId'], 'Mouth pose must belong to the same character and fit its dialogue window.');
          }
        }
      }
      if (event.type === 'character-action') {
        const path = ['shots', shotIndex, 'timelineEvents', eventIndex];
        if (layer?.source.kind !== 'character') {
          addIssue(context, [...path, 'layerId'], 'Character actions require a character layer.');
        } else {
          const owner = characters.get(layer.source.characterId);
          if (!owner?.actions?.some((action) => action.id === event.actionId)) {
            addIssue(context, [...path, 'actionId'], 'Character action is not defined on the instance character.');
          }
        }
        const overlap = shot.timelineEvents.find((candidate, candidateIndex) =>
          candidateIndex !== eventIndex &&
          candidate.type === 'character-action' &&
          candidate.layerId === event.layerId &&
          candidate.startMs < event.endMs &&
          event.startMs < candidate.endMs,
        );
        if (overlap) {
          addIssue(context, [...path, 'startMs'], 'Character action events on one layer must not overlap.');
        }
      }
    });
    for (const ranges of graphicPlaybackRanges.values()) {
      let previousEnd = 0;
      for (const range of ranges.sort((left, right) => left.startMs - right.startMs)) {
        if (range.startMs < previousEnd) {
          addIssue(context, ['shots', shotIndex, 'timelineEvents', range.index, 'startMs'], 'Graphic playback ranges on one layer cannot overlap.');
        }
        previousEnd = Math.max(previousEnd, range.endMs);
      }
    }
  });
}
