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

export function validateProjectReferences(
  project: ProjectData,
  context: z.RefinementCtx,
): void {
  validateUniqueIds(project.assets, ['assets'], context);
  validateUniqueIds(project.characters, ['characters'], context);
  validateUniqueIds(project.voiceProfiles, ['voiceProfiles'], context);
  validateUniqueIds(project.subtitleStyles, ['subtitleStyles'], context);
  validateUniqueIds(project.shots, ['shots'], context);

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const characters = new Map(
    project.characters.map((character) => [character.id, character]),
  );
  const voiceProfiles = new Map(
    project.voiceProfiles.map((profile) => [profile.id, profile]),
  );
  const subtitleStyles = new Set(
    project.subtitleStyles.map((style) => style.id),
  );

  project.characters.forEach((character, characterIndex) => {
    validateUniqueIds(
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
      const characterSource = layer.source;
      const character = characters.get(characterSource.characterId);
      if (!character) {
        addIssue(
          context,
          ['shots', shotIndex, 'layers', layerIndex, 'source', 'characterId'],
          `Layer references unknown character: ${characterSource.characterId}`,
        );
      } else if (
        !character.expressions.some(
          (expression) => expression.id === characterSource.expressionId,
        )
      ) {
        addIssue(
          context,
          ['shots', shotIndex, 'layers', layerIndex, 'source', 'expressionId'],
          `Layer references unknown character expression: ${characterSource.expressionId}`,
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
      if (!audioClips.has(dialogue.audioClipId)) {
        addIssue(
          context,
          ['shots', shotIndex, 'dialogues', dialogueIndex, 'audioClipId'],
          `Dialogue references unknown audio clip: ${dialogue.audioClipId}`,
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
          if (
            !character?.expressions.some(
              (expression) => expression.id === event.expressionId,
            )
          ) {
            addIssue(
              context,
              [
                'shots',
                shotIndex,
                'timelineEvents',
                eventIndex,
                'expressionId',
              ],
              `Expression event references unknown expression: ${event.expressionId}`,
            );
          }
        }
      }
    });
  });
}
