import type { z } from 'zod';
import type { ProjectData } from '../models/project';

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

type ReferenceTables = {
  readonly assets: ReadonlyMap<string, ProjectData['assets'][number]>;
  readonly animations: ReadonlyMap<string, ProjectData['animations'][number]>;
  readonly characters: ReadonlyMap<string, ProjectData['characters'][number]>;
  readonly subtitleStyles: ReadonlySet<string>;
};

/**
 * Scene structure shared by a Shot and a project-local ShotTemplate: stage
 * Layers, the background identity and the timeline. Keeping one validator for
 * both means a template can never persist a structure a Shot could not.
 */
type ShotStructureLike = {
  readonly durationMs: number;
  readonly defaultSubtitleStyleId: string;
  readonly layers: ProjectData['shots'][number]['layers'];
  readonly backgroundLayerId: string | null;
  readonly timelineEvents: ProjectData['shots'][number]['timelineEvents'];
};

function validateShotStructure(
  structure: ShotStructureLike,
  path: PropertyKey[],
  context: z.RefinementCtx,
  references: ReferenceTables,
): void {
  const { assets, animations, characters, subtitleStyles } = references;
  validateUniqueIds(structure.layers, [...path, 'layers'], context);
  validateUniqueIds(structure.timelineEvents, [...path, 'timelineEvents'], context);
  if (!subtitleStyles.has(structure.defaultSubtitleStyleId)) {
    addIssue(
      context,
      [...path, 'defaultSubtitleStyleId'],
      `Shot references unknown subtitle style: ${structure.defaultSubtitleStyleId}`,
    );
  }

  const layers = new Map(structure.layers.map((layer) => [layer.id, layer]));
  if (structure.backgroundLayerId !== null) {
    const background = layers.get(structure.backgroundLayerId);
    if (!background) {
      addIssue(
        context,
        [...path, 'backgroundLayerId'],
        `Shot references unknown background layer: ${structure.backgroundLayerId}`,
      );
    } else if (background.source.kind !== 'asset') {
      addIssue(
        context,
        [...path, 'backgroundLayerId'],
        'Shot background layer must directly reference an image asset.',
      );
    }
  }

  structure.layers.forEach((layer, layerIndex) => {
    if (layer.source.kind === 'asset') {
      const asset = assets.get(layer.source.assetId);
      if (!asset || asset.kind !== 'image') {
        addIssue(
          context,
          [...path, 'layers', layerIndex, 'source', 'assetId'],
          `Layer references unknown or non-image asset: ${layer.source.assetId}`,
        );
      }
      return;
    }
    if (layer.source.kind === 'animation') {
      if (!animations.has(layer.source.animationId)) {
        addIssue(
          context,
          [...path, 'layers', layerIndex, 'source', 'animationId'],
          `Layer references unknown animation: ${layer.source.animationId}`,
        );
      }
      if (
        layer.startTimeMs === undefined ||
        layer.startTimeMs > structure.durationMs
      ) {
        addIssue(
          context,
          [...path, 'layers', layerIndex, 'startTimeMs'],
          'Animation start time must be within the shot duration.',
        );
      }
      return;
    }
    const characterSource = layer.source;
    const character = characters.get(characterSource.characterId);
    if (!character) {
      addIssue(
        context,
        [...path, 'layers', layerIndex, 'source', 'characterId'],
        `Layer references unknown character: ${characterSource.characterId}`,
      );
    } else if (character.mode === 'adaptive-parts') {
      if (characterSource.expressionId !== undefined) {
        addIssue(
          context,
          [...path, 'layers', layerIndex, 'source', 'expressionId'],
          `Adaptive Parts Layer ${layer.id} must not reference an Expression.`,
        );
      }
    } else if (
      !characterSource.expressionId ||
      !character.expressions.some(
        (expression) => expression.id === characterSource.expressionId,
      )
    ) {
      addIssue(
        context,
        [...path, 'layers', layerIndex, 'source', 'expressionId'],
        `Layer references unknown character expression: ${characterSource.expressionId ?? '(missing)'}`,
      );
    }
  });

  structure.timelineEvents.forEach((event, eventIndex) => {
    const layer = layers.get(event.layerId);
    if (!layer) {
      addIssue(
        context,
        [...path, 'timelineEvents', eventIndex, 'layerId'],
        `Timeline event references unknown layer: ${event.layerId}`,
      );
    }
    if (event.endMs > structure.durationMs) {
      addIssue(
        context,
        [...path, 'timelineEvents', eventIndex, 'endMs'],
        'Timeline event must end within the shot duration.',
      );
    }
    if (event.type === 'expression' && layer) {
      if (layer.source.kind !== 'character') {
        addIssue(
          context,
          [...path, 'timelineEvents', eventIndex, 'expressionId'],
          'Expression events require a character layer.',
        );
      } else {
        const character = characters.get(layer.source.characterId);
        if (
          !character ||
          character.mode === 'adaptive-parts' ||
          !character.expressions.some(
            (expression) => expression.id === event.expressionId,
          )
        ) {
          addIssue(
            context,
            [...path, 'timelineEvents', eventIndex, 'expressionId'],
            `Expression event references unknown expression: ${event.expressionId}`,
          );
        }
      }
    }
  });
}


export function validateProjectReferences(
  project: ProjectData,
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
  validateUniqueIds(project.shotTemplates, ['shotTemplates'], context);

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const animations = new Map(
    project.animations.map((animation) => [animation.id, animation]),
  );
  const characters = new Map(
    project.characters.map((character) => [character.id, character]),
  );
  const voiceProfiles = new Map(
    project.voiceProfiles.map((profile) => [profile.id, profile]),
  );
  const subtitleStyles = new Set(
    project.subtitleStyles.map((style) => style.id),
  );
  const references: ReferenceTables = {
    assets,
    animations,
    characters,
    subtitleStyles,
  };

  project.animations.forEach((animation, animationIndex) => {
    animation.frames.forEach((frame, frameIndex) => {
      const asset = assets.get(frame.assetId);
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
    });
  });

  project.characters.forEach((character, characterIndex) => {
    if (character.mode === 'adaptive-parts') {
      character.parts.forEach((part, partIndex) => {
        const partAsset = assets.get(part.assetId);
        if (!partAsset || partAsset.kind !== 'image') {
          addIssue(
            context,
            ['characters', characterIndex, 'parts', partIndex, 'assetId'],
            `Part references unknown or non-image asset: ${part.assetId}`,
          );
          return;
        }
        const expectedWidth = Math.round(
          part.imageMapping.crop.width * part.imageMapping.exportScale,
        );
        const expectedHeight = Math.round(
          part.imageMapping.crop.height * part.imageMapping.exportScale,
        );
        if (
          partAsset.width !== expectedWidth ||
          partAsset.height !== expectedHeight
        ) {
          addIssue(
            context,
            ['characters', characterIndex, 'parts', partIndex, 'imageMapping'],
            `Part crop mapping resolves to ${expectedWidth}×${expectedHeight}, but asset ${partAsset.id} is ${partAsset.width}×${partAsset.height}.`,
          );
        }
      });
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
      const baseAsset = assets.get(character.baseAssetId);
      if (!baseAsset || baseAsset.kind !== 'image') {
        addIssue(
          context,
          ['characters', characterIndex, 'baseAssetId'],
          `Character references unknown or non-image base asset: ${character.baseAssetId}`,
        );
      }
      character.expressions.forEach((expression, expressionIndex) => {
        const expressionAsset = assets.get(expression.assetId);
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

  (project.partPosePresets ?? []).forEach((preset, presetIndex) => {
    const character = characters.get(preset.characterId);
    if (!character) {
      addIssue(
        context,
        ['partPosePresets', presetIndex, 'characterId'],
        `Action preset references unknown character: ${preset.characterId}`,
      );
    } else if (character.mode !== 'adaptive-parts') {
      addIssue(
        context,
        ['partPosePresets', presetIndex, 'characterId'],
        'Action presets require an Adaptive Parts Character.',
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
    const path = ['shots', shotIndex];
    validateShotStructure(shot, path, context, references);
    validateUniqueIds(shot.dialogues, [...path, 'dialogues'], context);
    validateUniqueIds(shot.audioClips, [...path, 'audioClips'], context);

    const audioClips = new Map(
      shot.audioClips.map((clip) => [clip.id, clip]),
    );
    shot.layers.forEach((layer, layerIndex) => {
      if (layer.poseAnimation) {
        const poseAnimation = layer.poseAnimation;
        const sourceCharacterId =
          layer.source.kind === 'character' ? layer.source.characterId : null;
        const poseCharacter = sourceCharacterId
          ? characters.get(sourceCharacterId)
          : null;
        if (
          !poseCharacter ||
          poseCharacter.mode !== 'adaptive-parts' ||
          poseAnimation.characterId !== sourceCharacterId
        ) {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'poseAnimation'],
            'Part pose animation requires a matching Adaptive Parts Character Layer.',
          );
        }
        poseAnimation.tracks.forEach((track, trackIndex) => {
          const partAsset = assets.get(track.assetId);
          if (!partAsset || partAsset.kind !== 'image') {
            addIssue(
              context,
              [
                'shots',
                shotIndex,
                'layers',
                layerIndex,
                'poseAnimation',
                'tracks',
                trackIndex,
                'assetId',
              ],
              `Part pose snapshot references unknown or non-image asset: ${track.assetId}`,
            );
          } else {
            const expectedWidth = Math.round(
              track.imageMapping.crop.width * track.imageMapping.exportScale,
            );
            const expectedHeight = Math.round(
              track.imageMapping.crop.height * track.imageMapping.exportScale,
            );
            if (
              partAsset.width !== expectedWidth ||
              partAsset.height !== expectedHeight
            ) {
              addIssue(
                context,
                [
                  'shots',
                  shotIndex,
                  'layers',
                  layerIndex,
                  'poseAnimation',
                  'tracks',
                  trackIndex,
                  'imageMapping',
                ],
                `Part pose snapshot crop resolves to ${expectedWidth}x${expectedHeight}, but asset ${partAsset.id} is ${partAsset.width}x${partAsset.height}.`,
              );
            }
          }
          const root = poseAnimation.sourceRootTransform;
          const rest = track.restTransform;
          const rootDeterminant = root.a * root.d - root.b * root.c;
          const restDeterminant = rest.a * rest.d - rest.b * rest.c;
          const exportScale = track.imageMapping.exportScale;
          const sourceDeterminant =
            (rootDeterminant * restDeterminant) /
            (exportScale * exportScale);
          track.keys.forEach((key, keyIndex) => {
            if (key.timeMs > shot.durationMs) {
              addIssue(
                context,
                [
                  'shots',
                  shotIndex,
                  'layers',
                  layerIndex,
                  'poseAnimation',
                  'tracks',
                  trackIndex,
                  'keys',
                  keyIndex,
                  'timeMs',
                ],
                'Part pose keyframe must be within the Shot duration.',
              );
            }
            const posedDeterminant = sourceDeterminant * key.scale * key.scale;
            if (
              !Number.isFinite(posedDeterminant) ||
              Math.abs(posedDeterminant) < 1e-12
            ) {
              addIssue(
                context,
                [
                  'shots',
                  shotIndex,
                  'layers',
                  layerIndex,
                  'poseAnimation',
                  'tracks',
                  trackIndex,
                  'keys',
                  keyIndex,
                  'scale',
                ],
                'Part pose keyframe produces a degenerate affine transform.',
              );
            }
          });
        });
      }
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
      if (layer.source.kind === 'animation') {
        if (!animations.has(layer.source.animationId)) {
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'source', 'animationId'],
            `Layer references unknown animation: ${layer.source.animationId}`,
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
          addIssue(
            context,
            ['shots', shotIndex, 'layers', layerIndex, 'source', 'expressionId'],
            `Adaptive Parts Layer ${layer.id} must not reference an Expression.`,
          );
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
      const character = characters.get(dialogue.characterId);
      if (!character) {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'characterId'],
          `Dialogue references unknown character: ${dialogue.characterId}`,
        );
      }
      const voiceProfile = voiceProfiles.get(dialogue.voiceProfileId);
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
  });

  project.shotTemplates.forEach((template, templateIndex) => {
    validateShotStructure(
      template,
      ['shotTemplates', templateIndex],
      context,
      references,
    );
  });
}
