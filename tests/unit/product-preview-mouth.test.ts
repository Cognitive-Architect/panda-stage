import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  evaluateShotAtTime,
  type Project,
} from '../../src/domain';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import {
  buildProductPreviewCues,
  listProductPreviewAssetIds,
  projectProductPreviewMouth,
} from '../../src/renderer/shell/productPreviewModel';
import { buildProject, IDS } from './domain/testProject';

const MOUTH_A_ID = '10000000-0000-4000-8000-000000000301';
const MOUTH_B_ID = '10000000-0000-4000-8000-000000000302';
const AUDIO_ID = '10000000-0000-4000-8000-000000000303';
const CLIP_A_ID = '70000000-0000-4000-8000-000000000301';
const CLIP_B_ID = '70000000-0000-4000-8000-000000000302';
const DIALOGUE_A_ID = '80000000-0000-4000-8000-000000000301';
const DIALOGUE_B_ID = '80000000-0000-4000-8000-000000000302';
const CHARACTER_B_ID = '20000000-0000-4000-8000-000000000004';
const EXPRESSION_B_ID = '20000000-0000-4000-8000-000000000005';
const VOICE_B_ID = '30000000-0000-4000-8000-000000000002';
const LAYER_B_ID = '60000000-0000-4000-8000-000000000004';

function imageAsset(id: string, name: string): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width: 640,
    height: 640,
  };
}

function buildMouthProject(twoCharacters = false): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(MOUTH_A_ID, 'mouth-a'),
      ...(twoCharacters ? [imageAsset(MOUTH_B_ID, 'mouth-b')] : []),
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: 'voice',
        relativePath: 'assets/voice.wav',
        mimeType: 'audio/wav',
        durationMs: 2_000,
      },
    ],
    characters: [
      ...base.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: MOUTH_A_ID,
      })),
      ...(twoCharacters
        ? [
            {
              id: CHARACTER_B_ID,
              name: 'character-b',
              baseAssetId: IDS.assetChar2,
              defaultVoiceProfileId: VOICE_B_ID,
              expressions: [
                {
                  id: EXPRESSION_B_ID,
                  name: 'normal-b',
                  assetId: IDS.assetChar2,
                },
              ],
              defaultExpressionId: EXPRESSION_B_ID,
              defaultScale: 1,
              defaultFlipX: false,
              mouthOpenAssetId: MOUTH_B_ID,
            },
          ]
        : []),
    ],
    voiceProfiles: [
      ...base.voiceProfiles,
      ...(twoCharacters
        ? [
            {
              id: VOICE_B_ID,
              name: 'voice-b',
              characterId: CHARACTER_B_ID,
              locale: 'zh-CN',
              rate: 1,
              pitch: 0,
            },
          ]
        : []),
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [
        {
          id: DIALOGUE_A_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: CLIP_A_ID,
          startMs: 0,
          endMs: 1_500,
          text: 'A speaks',
        },
        ...(twoCharacters
          ? [
              {
                id: DIALOGUE_B_ID,
                characterId: CHARACTER_B_ID,
                voiceProfileId: VOICE_B_ID,
                subtitleStyleId: IDS.subtitle,
                audioClipId: CLIP_B_ID,
                startMs: 700,
                endMs: 1_300,
                text: 'B speaks',
              },
            ]
          : []),
      ],
      audioClips: [
        {
          id: CLIP_A_ID,
          name: 'voice-a',
          assetId: AUDIO_ID,
          startMs: 0,
          endMs: 900,
          offsetMs: 0,
          volume: 1,
        },
        ...(twoCharacters
          ? [
              {
                id: CLIP_B_ID,
                name: 'voice-b',
                assetId: AUDIO_ID,
                startMs: 700,
                endMs: 1_200,
                offsetMs: 0,
                volume: 1,
              },
            ]
          : []),
      ],
      layers: [
        ...shot.layers,
        ...(twoCharacters
          ? [
              {
                id: LAYER_B_ID,
                name: 'character-b-layer',
                source: {
                  kind: 'character' as const,
                  characterId: CHARACTER_B_ID,
                  expressionId: EXPRESSION_B_ID,
                },
                anchor: 'center' as const,
                x: 1_000,
                y: 600,
                scaleX: 0.5,
                scaleY: 0.5,
                rotationDeg: 0,
                opacity: 1,
                visible: true,
                zIndex: 3,
                locked: false,
                flipX: false,
              },
            ]
          : []),
      ],
    })),
  });
}

function layerAsset(project: Project, timeMs: number, dialogueId: string) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project);
  return projectProductPreviewMouth(
    project,
    shot,
    evaluated,
    dialogueId,
  );
}

describe('Product Preview mouth preload - Phase 3 A', () => {
  it('preloads valid mouth images once and ignores invalid mouth refs safely', () => {
    const project = buildMouthProject(true);
    const shot = project.shots[0]!;
    const ids = listProductPreviewAssetIds(project, shot);

    expect(ids).toEqual(expect.arrayContaining([MOUTH_A_ID, MOUTH_B_ID]));
    expect(ids.filter((id) => id === MOUTH_A_ID)).toHaveLength(1);
    expect(ids).toEqual(
      expect.arrayContaining([IDS.assetBg, IDS.assetChar, IDS.assetChar2]),
    );

    const invalid = {
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: character.id === IDS.character ? AUDIO_ID : 'missing',
      })),
    } as Project;
    expect(listProductPreviewAssetIds(invalid, shot)).not.toContain(AUDIO_ID);
  });
});

describe('Product Preview mouth projection - Phase 3 B', () => {
  it('uses the bound AudioClip half-open interval, not the subtitle tail', () => {
    const project = buildMouthProject();

    expect(
      layerAsset(project, 0, DIALOGUE_A_ID).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(MOUTH_A_ID);
    expect(
      layerAsset(project, 899, DIALOGUE_A_ID).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(MOUTH_A_ID);
    expect(
      layerAsset(project, 900, DIALOGUE_A_ID).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(IDS.assetChar);
    expect(evaluateSubtitleAtTime(buildProductPreviewCues(project.shots[0]!), 900)?.id)
      .toBe(DIALOGUE_A_ID);
  });

  it('changes only the speaking character asset and preserves formal state', () => {
    const project = buildMouthProject(true);
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 800, project);
    const snapshot = structuredClone(evaluated);
    const projectedA = projectProductPreviewMouth(
      project,
      shot,
      evaluated,
      DIALOGUE_A_ID,
    );

    expect(projectedA.layers.find((layer) => layer.id === IDS.layerChar)?.assetId)
      .toBe(MOUTH_A_ID);
    expect(projectedA.layers.find((layer) => layer.id === LAYER_B_ID))
      .toEqual(evaluated.layers.find((layer) => layer.id === LAYER_B_ID));
    expect(evaluated).toEqual(snapshot);

    const projectedB = projectProductPreviewMouth(
      project,
      shot,
      evaluated,
      DIALOGUE_B_ID,
    );
    expect(projectedB.layers.find((layer) => layer.id === IDS.layerChar))
      .toEqual(evaluated.layers.find((layer) => layer.id === IDS.layerChar));
    expect(projectedB.layers.find((layer) => layer.id === LAYER_B_ID)?.assetId)
      .toBe(MOUTH_B_ID);
  });

  it('falls back to the exact formal result for missing or invalid inputs', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 500, project);

    expect(projectProductPreviewMouth(project, shot, evaluated, null)).toBe(evaluated);
    expect(
      projectProductPreviewMouth(
        project,
        { ...shot, audioClips: [] },
        evaluated,
        DIALOGUE_A_ID,
      ),
    ).toBe(evaluated);

    const noMouth = {
      ...project,
      characters: project.characters.map((character) => {
        const next = { ...character };
        delete next.mouthOpenAssetId;
        return next;
      }),
    } as Project;
    expect(
      projectProductPreviewMouth(
        noMouth,
        shot,
        evaluated,
        DIALOGUE_A_ID,
      ),
    ).toBe(evaluated);

    const nonImageMouth = {
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: AUDIO_ID,
      })),
    } as Project;
    expect(
      projectProductPreviewMouth(
        nonImageMouth,
        shot,
        evaluated,
        DIALOGUE_A_ID,
      ),
    ).toBe(evaluated);

    const missingAudioAsset = {
      ...project,
      assets: project.assets.filter((asset) => asset.id !== AUDIO_ID),
    } as Project;
    expect(
      projectProductPreviewMouth(
        missingAudioAsset,
        shot,
        evaluated,
        DIALOGUE_A_ID,
      ),
    ).toBe(evaluated);

    expect(
      projectProductPreviewMouth(
        project,
        { ...shot, layers: [] },
        evaluated,
        DIALOGUE_A_ID,
      ),
    ).toBe(evaluated);
  });

  it('follows the shared subtitle winner during overlap', () => {
    const project = buildMouthProject(true);
    const shot = project.shots[0]!;
    const cues = buildProductPreviewCues(shot);
    const winnerA = evaluateSubtitleAtTime(cues, 600);
    const winnerB = evaluateSubtitleAtTime(cues, 800);

    expect(winnerA?.id).toBe(DIALOGUE_A_ID);
    expect(winnerB?.id).toBe(DIALOGUE_B_ID);
    expect(
      layerAsset(project, 600, winnerA!.id).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(MOUTH_A_ID);
    expect(
      layerAsset(project, 800, winnerB!.id).layers.find(
        (layer) => layer.id === LAYER_B_ID,
      )?.assetId,
    ).toBe(MOUTH_B_ID);
  });
});

describe('Product Preview mouth integration - Phase 3 C', () => {
  it('projects between the formal evaluator and CanvasStage using the shared clock', () => {
    const overlay = readFileSync(
      'src/renderer/shell/ProductPreviewOverlay.tsx',
      'utf8',
    );

    expect(overlay).toContain('evaluateShotAtTime(');
    expect(overlay).toContain('evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)');
    expect(overlay).toContain('projectProductPreviewMouth(');
    expect(overlay).toContain('activeCue?.id ?? null');
    expect(overlay).toContain('evaluatedShot={renderedShot}');
    expect(overlay).not.toContain('mouthTime');
    expect(overlay).not.toContain('mouthStore');
  });
});
