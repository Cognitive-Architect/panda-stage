import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerVisualParts,
  resolveSpeakerFocusCamera,
  resolveTalkingHeadMotionTransform,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import {
  buildDialogueSubtitleCues,
} from '../../src/shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import {
  projectProductPreviewDialogue,
} from '../../src/renderer/shell/productPreviewModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

const BODY_ID = '10000000-0000-4000-8000-000000000004';
const HEAD_ID = '10000000-0000-4000-8000-000000000009';
const FACE_NORMAL_ID = '10000000-0000-4000-8000-000000000005';
const FACE_ANGRY_ID = '10000000-0000-4000-8000-000000000006';
const MOUTH_ID = '10000000-0000-4000-8000-000000000007';
const AUDIO_ID = '10000000-0000-4000-8000-000000000008';
const B_CHARACTER_ID = '20000000-0000-4000-8000-000000000010';
const B_EXPRESSION_NORMAL_ID = '20000000-0000-4000-8000-000000000011';
const B_EXPRESSION_ANGRY_ID = '20000000-0000-4000-8000-000000000012';
const B_VOICE_PROFILE_ID = '30000000-0000-4000-8000-000000000002';
const B_LAYER_ID = '60000000-0000-4000-8000-000000000004';
const DUPLICATE_A_LAYER_ID = '60000000-0000-4000-8000-000000000005';
const A_DIALOGUE_ID = '80000000-0000-4000-8000-000000000004';
const B_DIALOGUE_ID = '80000000-0000-4000-8000-000000000005';
const A_AGAIN_DIALOGUE_ID = '80000000-0000-4000-8000-000000000006';
const DIALOGUE_CLIP_ID = '70000000-0000-4000-8000-000000000004';
const BGM_CLIP_ID = '70000000-0000-4000-8000-000000000005';
const SFX_CLIP_ID = '70000000-0000-4000-8000-000000000006';
const POSITION_EVENT_ID = '90000000-0000-4000-8000-000000000014';
const SHAKE_EVENT_ID = '90000000-0000-4000-8000-000000000015';

function imageAsset(
  id: string,
  name: string,
  width: number,
  height: number,
): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
  };
}

function talkingProject(options: { head?: boolean } = {}): Project {
  const base = buildProject();
  const withHead = options.head ?? true;
  const sourceCharacter = base.characters[0]!;
  const sourceLayer = base.shots[0]!.layers.find(
    (layer) => layer.id === IDS.layerChar,
  )!;
  const expressionNormal = {
    id: IDS.expressionNormal,
    name: 'normal-face',
    assetId: FACE_NORMAL_ID,
  };
  const expressionAngry = {
    id: IDS.expressionAngry,
    name: 'angry-face',
    assetId: FACE_ANGRY_ID,
  };
  const characterA = {
    ...sourceCharacter,
    mode: 'composite' as const,
    baseAssetId: FACE_NORMAL_ID,
    expressions: [expressionNormal, expressionAngry],
    defaultExpressionId: IDS.expressionNormal,
    bodyAssetId: BODY_ID,
    facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
    ...(withHead
      ? {
          head: {
            assetId: HEAD_ID,
            placement: { offsetX: 20, offsetY: -360, scale: 0.8 },
            pivot: { x: 15, y: -320 },
          },
        }
      : {}),
    mouthOpenAssetId: MOUTH_ID,
  };
  const characterB = {
    ...characterA,
    id: B_CHARACTER_ID,
    name: 'B',
    defaultVoiceProfileId: B_VOICE_PROFILE_ID,
    expressions: [
      { ...expressionNormal, id: B_EXPRESSION_NORMAL_ID },
      { ...expressionAngry, id: B_EXPRESSION_ANGRY_ID },
    ],
    defaultExpressionId: B_EXPRESSION_NORMAL_ID,
  };
  const audioAsset = {
    id: AUDIO_ID,
    kind: 'audio' as const,
    name: 'voice-and-controls',
    relativePath: 'assets/voice-and-controls.wav',
    mimeType: 'audio/wav',
    durationMs: 4_000,
  };

  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(BODY_ID, 'body', 800, 1_000),
      ...(withHead ? [imageAsset(HEAD_ID, 'head', 500, 650)] : []),
      imageAsset(FACE_NORMAL_ID, 'face-normal', 200, 100),
      imageAsset(FACE_ANGRY_ID, 'face-angry', 300, 200),
      imageAsset(MOUTH_ID, 'mouth-open', 400, 300),
      audioAsset,
    ],
    characters: [characterA, characterB],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        ...base.voiceProfiles[0]!,
        id: B_VOICE_PROFILE_ID,
        name: 'voice B',
        characterId: B_CHARACTER_ID,
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 4_000,
      layers: [
        ...shot.layers.map((layer) =>
          layer.id === IDS.layerChar
            ? {
                ...layer,
                source: {
                  kind: 'character' as const,
                  characterId: IDS.character,
                  expressionId: IDS.expressionNormal,
                },
              }
            : layer,
        ),
        {
          ...sourceLayer,
          id: B_LAYER_ID,
          name: 'character B',
          x: 900,
          zIndex: 3,
          source: {
            kind: 'character' as const,
            characterId: B_CHARACTER_ID,
            expressionId: B_EXPRESSION_NORMAL_ID,
          },
        },
      ],
      dialogues: [
        {
          id: A_DIALOGUE_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          audioClipId: DIALOGUE_CLIP_ID,
          subtitleStyleId: IDS.subtitle,
          startMs: 100,
          endMs: 1_100,
          text: 'A',
        },
        {
          id: B_DIALOGUE_ID,
          characterId: B_CHARACTER_ID,
          voiceProfileId: B_VOICE_PROFILE_ID,
          subtitleStyleId: IDS.subtitle,
          startMs: 1_100,
          endMs: 2_100,
          text: 'B',
        },
        {
          id: A_AGAIN_DIALOGUE_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          startMs: 2_100,
          endMs: 3_100,
          text: 'A again',
        },
      ],
      audioClips: [
        {
          id: DIALOGUE_CLIP_ID,
          role: 'dialogue',
          name: 'A voice',
          assetId: AUDIO_ID,
          startMs: 100,
          endMs: 1_100,
          offsetMs: 0,
          volume: 1,
        },
        {
          id: BGM_CLIP_ID,
          role: 'bgm',
          name: 'background music control',
          assetId: AUDIO_ID,
          startMs: 0,
          endMs: 4_000,
          offsetMs: 0,
          volume: 1,
        },
        {
          id: SFX_CLIP_ID,
          role: 'sfx',
          name: 'sound effect control',
          assetId: AUDIO_ID,
          startMs: 3_000,
          endMs: 4_000,
          offsetMs: 0,
          volume: 1,
        },
      ],
    })),
  });
}

function singleImageTalkingProject(): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 4_000,
      dialogues: [
        {
          id: A_DIALOGUE_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          startMs: 0,
          endMs: 1_000,
          text: 'single image',
        },
      ],
    })),
  });
}

function visualFor(project: Project, timeMs: number, layerId: string) {
  const shot = project.shots[0]!;
  const evaluated = projectShotDialogueVisual(
    project,
    shot,
    evaluateShotAtTime(shot, timeMs, project),
  );
  const layer = evaluated.layers.find((candidate) => candidate.id === layerId)!;
  return { evaluated, layer, visual: resolveLayerVisualParts(project, shot, layer) };
}

function activeDialogueId(project: Project, timeMs: number): string | null {
  const shot = project.shots[0]!;
  return evaluateSubtitleAtTime(
    buildDialogueSubtitleCues(shot.dialogues),
    timeMs,
  )?.id ?? null;
}

describe('Issue #669 requested-time Talking Head Motion', () => {
  it('uses a deterministic 2 Hz wave with bounded 120 ms ease envelopes', () => {
    const start = resolveTalkingHeadMotionTransform(0, 1_000);
    const peak = resolveTalkingHeadMotionTransform(375, 1_000);
    const end = resolveTalkingHeadMotionTransform(1_000, 1_000);
    const before = resolveTalkingHeadMotionTransform(-1, 1_000);
    const approachEnd = resolveTalkingHeadMotionTransform(940, 1_000);

    expect(start).toEqual({
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
    });
    expect(peak.translateY).toBeCloseTo(-4, 10);
    expect(peak.rotationDeg).toBe(0);
    expect(
      [0, 60, 125, 250, 375, 500, 940, 1_000].map(
        (timeMs) => resolveTalkingHeadMotionTransform(timeMs, 1_000).rotationDeg,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Math.abs(resolveTalkingHeadMotionTransform(60, 1_000).translateY)).toBeLessThan(2);
    expect(Math.abs(approachEnd.translateY)).toBeLessThanOrEqual(2);
    expect(end.translateY).toBe(0);
    expect(before.translateY).toBe(0);
    expect(resolveTalkingHeadMotionTransform(375, 1_000)).toEqual(peak);
  });

  it('follows A → B → A, starts each phase at neutral, and returns non-speakers to neutral', () => {
    const project = talkingProject();
    const shot = project.shots[0]!;
    const beforeDialogue = visualFor(project, 50, IDS.layerChar);
    const atFirstStart = visualFor(project, 100, IDS.layerChar);
    const aSpeaking = visualFor(project, 475, IDS.layerChar);
    const aNonSpeaker = visualFor(project, 475, B_LAYER_ID);
    const bSpeaking = visualFor(project, 1_475, B_LAYER_ID);
    const bNonSpeaker = visualFor(project, 1_475, IDS.layerChar);
    const atAAgainStart = visualFor(project, 2_100, IDS.layerChar);
    const aSpeakingAgain = visualFor(project, 2_475, IDS.layerChar);
    const atBStart = visualFor(project, 1_100, B_LAYER_ID);
    const atDialogueEnd = visualFor(project, 3_100, IDS.layerChar);
    const afterDialogue = visualFor(project, 3_500, IDS.layerChar);

    expect(shot.dialogues.find((dialogue) => dialogue.id === B_DIALOGUE_ID)?.audioClipId)
      .toBeUndefined();
    expect(activeDialogueId(project, 50)).toBeNull();
    expect(activeDialogueId(project, 100)).toBe(A_DIALOGUE_ID);
    expect(activeDialogueId(project, 1_100)).toBe(B_DIALOGUE_ID);
    expect(activeDialogueId(project, 2_100)).toBe(A_AGAIN_DIALOGUE_ID);
    expect(beforeDialogue.visual.headGroup?.transform.translateY).toBe(0);
    expect(atFirstStart.visual.headGroup?.transform.translateY).toBe(0);
    expect(aSpeaking.visual.headGroup?.transform.translateY).toBeCloseTo(-4, 10);
    expect(bSpeaking.visual.headGroup?.transform.translateY).toBeCloseTo(-4, 10);
    expect(aSpeakingAgain.visual.headGroup?.transform.translateY).toBeCloseTo(-4, 10);
    expect(aNonSpeaker.visual.headGroup?.transform.translateY).toBe(0);
    expect(bNonSpeaker.visual.headGroup?.transform.translateY).toBe(0);
    expect(atAAgainStart.visual.headGroup?.transform.translateY).toBe(0);
    expect(atBStart.visual.headGroup?.transform.translateY).toBe(0);
    expect(atDialogueEnd.visual.headGroup?.transform.translateY).toBe(0);
    expect(afterDialogue.visual.headGroup?.transform.translateY).toBe(0);
    expect(shot.audioClips.some((clip) => clip.role === 'bgm' && clip.startMs <= 3_500 && clip.endMs > 3_500)).toBe(true);
    expect(shot.audioClips.some((clip) => clip.role === 'sfx' && clip.startMs <= 3_500 && clip.endMs > 3_500)).toBe(true);
  });

  it('moves Head + Face/Mouth while preserving Body and the evaluated Position/Shake root', () => {
    const base = talkingProject();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          {
            id: POSITION_EVENT_ID,
            type: 'move' as const,
            layerId: IDS.layerChar,
            startMs: 100,
            endMs: 1_100,
            from: { x: 500, y: 600 },
            to: { x: 700, y: 650 },
            easing: 'linear' as const,
          },
          {
            id: SHAKE_EVENT_ID,
            type: 'shake' as const,
            layerId: IDS.layerChar,
            startMs: 100,
            endMs: 1_100,
            amplitudeX: 10,
            amplitudeY: 4,
            frequencyHz: 8,
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    const before = JSON.stringify(project);
    const atSpeech = visualFor(project, 200, IDS.layerChar);
    const formal = evaluateShotAtTime(shot, 200, project);
    const root = atSpeech.evaluated.layers.find((layer) => layer.id === IDS.layerChar)!;
    const formalRoot = formal.layers.find((layer) => layer.id === IDS.layerChar)!;
    const stage = buildStageRenderModel(
      project,
      atSpeech.evaluated,
      Object.fromEntries(
        project.assets
          .filter((asset) => asset.kind === 'image')
          .map((asset) => [asset.id, `blob:${asset.id}`]),
      ),
    );
    const stageLayer = stage.layers.find((layer) => layer.id === IDS.layerChar)!;
    const body = stageLayer.parts.find((part) => part.slot === 'body')!;

    expect(atSpeech.visual.activeFace?.source).toBe('mouth');
    expect(atSpeech.visual.headGroup?.partIds).toEqual([
      `${IDS.layerChar}:head`,
      `${IDS.layerChar}:face`,
    ]);
    expect(atSpeech.visual.headGroup?.partIds).not.toContain(`${IDS.layerChar}:body`);
    expect(atSpeech.visual.headGroup?.transform.translateY).not.toBe(0);
    expect(stageLayer.visual?.headGroup?.transform).toEqual(atSpeech.visual.headGroup?.transform);
    expect(body.render).toMatchObject({ x: -400, y: -500, rotationDeg: 0 });
    expect(root).toMatchObject({
      x: formalRoot.x,
      y: formalRoot.y,
      scaleX: formalRoot.scaleX,
      scaleY: formalRoot.scaleY,
      flipX: formalRoot.flipX,
      rotationDeg: formalRoot.rotationDeg,
      opacity: formalRoot.opacity,
      zIndex: formalRoot.zIndex,
    });
    expect(stageLayer.render).toMatchObject({ x: root.x, y: root.y, rotationDeg: root.rotationDeg });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('keeps headless composite and single-image Characters on their incumbent paths', () => {
    const headless = talkingProject({ head: false });
    const headlessVisual = visualFor(headless, 375, IDS.layerChar).visual;
    const singleImage = singleImageTalkingProject();
    const singleImageVisual = visualFor(singleImage, 375, IDS.layerChar).visual;

    expect(headlessVisual.kind).toBe('composite-character');
    expect(headlessVisual.headGroup).toBeNull();
    expect(singleImageVisual.kind).toBe('single-image-character');
    expect(singleImageVisual.headGroup).toBeNull();
  });

  it('does not guess which duplicate visible Character occurrence represents the speaker', () => {
    const original = talkingProject();
    const baseShot = original.shots[0]!;
    const sourceLayer = baseShot.layers.find((layer) => layer.id === IDS.layerChar)!;
    const project = ProjectSchema.parse({
      ...original,
      shots: original.shots.map((shot) => ({
        ...shot,
        layers: [
          ...shot.layers,
          {
            ...sourceLayer,
            id: DUPLICATE_A_LAYER_ID,
            name: 'ambiguous duplicate A',
            x: 720,
            zIndex: 4,
          },
        ],
      })),
    });
    const originalVisual = visualFor(project, 475, IDS.layerChar).visual;
    const duplicateVisual = visualFor(project, 475, DUPLICATE_A_LAYER_ID).visual;

    expect(originalVisual.headGroup?.transform.translateY).toBe(0);
    expect(duplicateVisual.headGroup?.transform.translateY).toBe(0);
  });

  it('produces the same requested-time Head Group in editor, Product Preview, and Export', () => {
    const project = talkingProject();
    const shot = project.shots[0]!;
    const timeMs = 475;
    const activeId = activeDialogueId(project, timeMs);
    const readyAssetIds = new Set(
      project.assets
        .filter((asset) => asset.kind === 'image')
        .map((asset) => asset.id),
    );
    const editorStore = new EditorProjectStore();
    editorStore.open('D:\\Issue669.pandastage', project);
    const opened = editorStore.getSnapshot()!;
    const history = editorStore.history.getSnapshot();
    const editor = buildEditorTemporalCanvasModel({
      project: opened.project,
      shot,
      currentTimeMs: timeMs,
      activeDialogueId: activeId,
      readyAssetIds,
      previousVisuals: new Map(),
    });
    const previewShot = projectProductPreviewDialogue(
      project,
      shot,
      evaluateShotAtTime(shot, timeMs, project),
      activeId,
    );
    const preview = buildStageRenderModel(
      project,
      previewShot,
      Object.fromEntries([...readyAssetIds].map((assetId) => [assetId, `blob:${assetId}`])),
    );
    const exportShot = evaluateExportShotAtTime(project, shot, timeMs);
    const exported = buildStageRenderModel(
      project,
      exportShot,
      Object.fromEntries([...readyAssetIds].map((assetId) => [assetId, `blob:${assetId}`])),
    );
    const editorLayer = editor.stageModel.layers.find(({ layer }) => layer.id === IDS.layerChar)!;
    const previewLayer = preview.layers.find((layer) => layer.id === IDS.layerChar)!;
    const exportLayer = exported.layers.find((layer) => layer.id === IDS.layerChar)!;

    expect(editorLayer.visual.headGroup?.transform).toEqual(previewLayer.visual?.headGroup?.transform);
    expect(previewLayer.visual?.headGroup?.transform).toEqual(exportLayer.visual?.headGroup?.transform);
    expect(exported.timeMs).toBe(timeMs);
    expect(editorStore.getSnapshot()).toBe(opened);
    expect(editorStore.history.getSnapshot()).toBe(history);
    expect(opened).toMatchObject({ dirty: false, revision: 0 });
    expect(resolveSpeakerFocusCamera(project, shot, timeMs).centerX).toBe(640);
    expect(resolveSpeakerFocusCamera(project, shot, 1_475).centerX).toBe(900);
  });

  it('freezes on the same requested time, resumes from that phase, and is reproducible on replay', () => {
    const project = talkingProject();
    const shot = project.shots[0]!;
    const paused = projectShotDialogueVisual(
      project,
      shot,
      evaluateShotAtTime(shot, 475, project),
    );
    const resumed = projectShotDialogueVisual(
      project,
      shot,
      evaluateShotAtTime(shot, 650, project),
    );
    const replayed = projectShotDialogueVisual(
      project,
      shot,
      evaluateShotAtTime(shot, 475, project),
    );

    expect(paused).toEqual(replayed);
    expect(paused.layers.find((layer) => layer.id === IDS.layerChar)?.headGroupTransform)
      .toEqual(replayed.layers.find((layer) => layer.id === IDS.layerChar)?.headGroupTransform);
    expect(
      resumed.layers.find((layer) => layer.id === IDS.layerChar)?.headGroupTransform?.translateY ?? 0,
    )
      .toBeGreaterThan(0);
  });
});
