import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  applyMouthPoseDraft,
  characterHasMouthOpenVisual,
  CharacterNodeMotionService,
  deleteMouthCueEvent,
  DialogueService,
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  migrateProject,
  MouthCueEventSchema,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  ProjectV26Schema,
  ProjectV22Schema,
  resolveEffectiveMouthCue,
  resolveLayerVisualParts,
  resolveMouthPoseEvent,
  selectMouthPoseGeneration,
  setManualMouthPose,
  ShotV20Schema,
  ShotV21Schema,
  ShotV22Schema,
  TimelineEventV22Schema,
  upsertMouthCueEventAtTime,
  type Project,
} from '../../../src/domain';
import { collectExportPreparationMedia } from '../../../src/domain/export-preparation';
import { evaluateExportShotAtTime } from '../../../src/export-renderer/evaluateExportShotAtTime';
import { buildEditorTemporalCanvasModel } from '../../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../../src/renderer/shell/productPreviewModel';
import { iterateFormalProjectFrameSchedule } from '../../../src/shared/export-types';
import { firstExportFrameTimeAtOrAfter, exportFrameTimeMs } from '../../../src/domain/timeline/frame-grid';
import { FACE_GRAPHIC_ID, faceSource, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { buildProject, IDS } from './testProject';

const MOUTH_ASSET_ID = '10000000-0000-4000-8000-000000000098';
const AUDIO_ASSET_ID = '10000000-0000-4000-8000-000000000096';
const HEAD_ASSET_ID = '10000000-0000-4000-8000-000000000097';
const AUDIO_CLIP_ID = '83000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = '82000000-0000-4000-8000-000000000001';

function buildMouthProject(options: {
  mode?: 'single-image' | 'composite';
  mouthKind?: 'image' | 'graphic' | 'none';
  withDialogue?: boolean;
  locked?: boolean;
} = {}): Project {
  const mode = options.mode ?? 'composite';
  const mouthKind = options.mouthKind ?? 'image';
  const base = mouthKind === 'graphic' ? graphicFaceProject() : buildProject();
  const assets = [
    ...base.assets,
    {
      id: MOUTH_ASSET_ID,
      kind: 'image' as const,
      name: '张嘴',
      relativePath: 'mouth.png',
      mimeType: 'image/png',
      width: 120,
      height: 80,
      usage: 'character' as const,
      keywords: [],
    },
    ...(mode === 'composite'
      ? [
          {
            id: HEAD_ASSET_ID,
            kind: 'image' as const,
            name: '头部',
            relativePath: 'head.png',
            mimeType: 'image/png',
            width: 300,
            height: 280,
            usage: 'character' as const,
            keywords: [],
          },
        ]
      : []),
    ...(options.withDialogue
      ? [
          {
            id: AUDIO_ASSET_ID,
            kind: 'audio' as const,
            name: '对白音频',
            relativePath: 'voice.wav',
            mimeType: 'audio/wav',
            durationMs: 900,
          },
        ]
      : []),
  ];

  return ProjectSchema.parse({
    ...base,
    assets,
    characters: base.characters.map((character) => {
      if (character.id !== IDS.character || character.mode === 'adaptive-parts') return character;
      const mouthFields =
        mouthKind === 'graphic'
          ? { mouthOpenVisualSource: faceSource(3) }
          : mouthKind === 'image'
            ? { mouthOpenAssetId: MOUTH_ASSET_ID }
            : {};
      if (mode === 'single-image') {
        return {
          ...character,
          mode: 'single-image' as const,
          ...mouthFields,
          ...(mouthKind === 'graphic'
            ? {
                baseAssetId: undefined,
                expressions: [
                  { id: IDS.expressionNormal, name: '平静', visualSource: faceSource(0) },
                  { id: IDS.expressionAngry, name: '生气', visualSource: faceSource(2) },
                ],
              }
            : {}),
        };
      }
      return {
        id: character.id,
        name: character.name,
        mode: 'composite' as const,
        ...(mouthKind === 'graphic'
          ? { baseAssetId: undefined }
          : { baseAssetId: character.baseAssetId }),
        bodyAssetId: IDS.assetChar2,
        bodyPlacement: { offsetX: 0, offsetY: 40, scale: 1 },
        facePlacement: { offsetX: 12, offsetY: -8, scale: 1.2, rotationDeg: 15, flipX: false },
        head: {
          assetId: HEAD_ASSET_ID,
          placement: { offsetX: 0, offsetY: -50, scale: 1, rotationDeg: 0, flipX: false },
          pivot: { x: 0, y: 15 },
        },
        defaultVoiceProfileId: character.defaultVoiceProfileId,
        ...mouthFields,
        defaultExpressionId: IDS.expressionNormal,
        expressions:
          mouthKind === 'graphic'
            ? [
                { id: IDS.expressionNormal, name: '平静', visualSource: faceSource(0) },
                { id: IDS.expressionAngry, name: '生气', visualSource: faceSource(2) },
              ]
            : character.expressions,
        defaultScale: character.defaultScale,
        defaultFlipX: character.defaultFlipX,
      };
    }),
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 2_000,
      layers: shot.layers.map((layer) =>
        layer.id === IDS.layerChar ? { ...layer, locked: options.locked ?? false } : layer,
      ),
      // Audio starts at 340ms -> Simple Mouth cycle (open 0..159, closed 160..319):
      // 400ms (60=open), 500ms (160=closed), 650ms (310=closed), 800ms (140=open), 900ms (240=closed), 1000ms (20=open)
      ...(options.withDialogue
        ? {
            audioClips: [
              {
                id: AUDIO_CLIP_ID,
                name: '对白',
                assetId: AUDIO_ASSET_ID,
                role: 'dialogue' as const,
                startMs: 340,
                endMs: 1_240,
                offsetMs: 0,
                volume: 1,
              },
            ],
            dialogues: [
              {
                id: DIALOGUE_ID,
                characterId: IDS.character,
                voiceProfileId: IDS.voiceProfile,
                subtitleStyleId: IDS.subtitle,
                audioClipId: AUDIO_CLIP_ID,
                text: '口型测试',
                startMs: 340,
                endMs: 1_240,
              },
            ],
          }
        : {}),
    })),
  });
}

describe('Editable mouth poses (#1226)', () => {
  const selection = { shotId: IDS.shot, layerId: IDS.layerChar, dialogueId: DIALOGUE_ID, startMs: 440, endMs: 960 };
  const rest = randomUUID();
  const pose = randomUUID();
  const other = randomUUID();
  const draft = [{ startMs: 440, endMs: 960, category: 'open' as const }];

  function projectWithPoses() {
    const base = buildMouthProject({ mouthKind: 'graphic', withDialogue: true });
    return ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) => asset.id === AUDIO_ASSET_ID ? { ...asset, sha256: 'a'.repeat(64) } : asset),
      characters: base.characters.map((character) => character.id === IDS.character ? {
        ...character, mouthPoseSet: {
          poses: [
            { id: rest, name: '静止', source: faceSource(0), target: { kind: 'face' } },
            { id: pose, name: '圆嘴', source: faceSource(3), target: { kind: 'face' } },
          ], restPoseId: rest, driveMode: 'mouth-poses',
          analyzerMapping: { rest, closed: rest, open: pose, round: pose, wide: pose },
        },
      } : character),
      shots: base.shots.map((shot) => ({ ...shot, durationMs: 3_000,
        layers: [...shot.layers, { ...shot.layers.find((layer) => layer.id === IDS.layerChar), id: other, zIndex: 99 }],
        audioClips: shot.audioClips.map((clip) => ({ ...clip, endMs: 1_140, offsetMs: 100 })),
      })),
    });
  }

  it('uses the trimmed source clock, preserves other instances and manual intervals, and migrates the frozen old shape', () => {
    let project = projectWithPoses();
    expect(selectMouthPoseGeneration(project, selection)).toMatchObject({ sourceStartMs: 200, audio: { startMs: 440, endMs: 960 } });
    project = applyMouthPoseDraft(project, selection, draft, randomUUID);
    project = applyMouthPoseDraft(project, { ...selection, layerId: other }, draft, randomUUID);
    const otherEvent = resolveMouthPoseEvent(project.shots[0]!, other, 600);
    const manualId = randomUUID();
    project = setManualMouthPose(project, IDS.shot, IDS.layerChar, manualId,
      { startMs: 540, endMs: 720, poseId: rest, dialogueId: DIALOGUE_ID });
    const range = { ...selection, startMs: 490, endMs: 830 };
    project = applyMouthPoseDraft(project, range, [{ ...range, category: 'open' }], randomUUID);
    const shot = project.shots[0]!;
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 539)?.poseId).toBe(pose);
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 540)).toMatchObject({ id: manualId, poseId: rest, origin: 'manual', startMs: 540, endMs: 720 });
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 720)?.poseId).toBe(pose);
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 959)?.poseId).toBe(pose);
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 960)).toBeUndefined();
    expect(resolveMouthPoseEvent(shot, other, 600)).toEqual(otherEvent);
    expect(ProjectV26Schema.safeParse({ ...project, schemaVersion: 26 }).success).toBe(false);
    const legacy = { ...buildMouthProject(), schemaVersion: 26 };
    expect(ProjectV26Schema.safeParse(legacy).success).toBe(true);
    expect(migrateProject(legacy).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('resolves the same frozen Graphic pose in Stage, Preview, and Export with old cue and manual priority', () => {
    let project = applyMouthPoseDraft(projectWithPoses(), selection, draft, randomUUID);
    project = upsertMouthCueEventAtTime(project, IDS.shot, IDS.layerChar, 'rest', 490);
    project = setManualMouthPose(project, IDS.shot, IDS.layerChar, randomUUID(),
      { startMs: 550, endMs: 730, poseId: pose, dialogueId: DIALOGUE_ID });
    const shot = project.shots[0]!;
    for (const [time, firstFrame] of [[730, 0], [600, 3], [500, 0], [450, 3]] as const) {
      const stage = buildEditorTemporalCanvasModel({ project, shot, currentTimeMs: time, activeDialogueId: DIALOGUE_ID,
        readyAssetIds: new Set(project.assets.map((asset) => asset.id)), missingAssetIds: new Set(), previousVisuals: new Map() });
      const preview = projectProductPreviewDialogue(project, shot, evaluateShotAtTime(shot, time, project), DIALOGUE_ID);
      const exported = evaluateExportShotAtTime(project, shot, time, DIALOGUE_ID);
      const visual = resolveLayerVisualParts(project, shot, exported.layers.find((layer) => layer.id === IDS.layerChar)!, time);
      expect(stage.visualsByLayer.get(IDS.layerChar)).toEqual(visual);
      expect(resolveLayerVisualParts(project, shot, preview.layers.find((layer) => layer.id === IDS.layerChar)!, time)).toEqual(visual);
      expect(visual.parts.find((part) => part.slot === 'face')?.source).toMatchObject({ firstFrame });
    }
  });

  it('keeps a manual pose at zero and during playback in both modes with only its needed resources', () => {
    const base = projectWithPoses();
    const configured = ProjectSchema.parse({
      ...base,
      characters: base.characters.map(character => character.id === IDS.character ? {
        ...character,
        mouthPoseSet: { ...character.mouthPoseSet!, poses: character.mouthPoseSet!.poses.map(item =>
          item.id === rest ? { ...item, source: { kind: 'image', assetId: MOUTH_ASSET_ID } } : item) },
      } : character),
    });
    const drafted = applyMouthPoseDraft(configured, selection, draft, randomUUID);
    const manual = setManualMouthPose(drafted, IDS.shot, IDS.layerChar, randomUUID(),
      { startMs: 0, endMs: 200, poseId: rest });
    for (const mode of ['asset-loop', 'mouth-poses'] as const) {
      const project = ProjectSchema.parse(JSON.parse(JSON.stringify({
        ...manual,
        characters: manual.characters.map(character => character.id === IDS.character
          ? { ...character, mouthPoseSet: { ...character.mouthPoseSet, driveMode: mode } } : character),
      })));
      const shot = project.shots[0]!;
      expect(listShotRuntimeImageAssets(project, shot).some(asset => asset.id === MOUTH_ASSET_ID)).toBe(true);
      expect(collectExportPreparationMedia(project).some(({ asset }) => asset.id === MOUTH_ASSET_ID)).toBe(true);
      const readyAssetIds = new Set(project.assets.map(asset => asset.id));
      for (const [time, expected] of [[550, mode === 'asset-loop' ? undefined : pose], [0, rest], [160, rest],
        [250, mode === 'asset-loop' ? undefined : rest]] as const) {
        const stage = buildEditorTemporalCanvasModel({ project, shot, currentTimeMs: time, readyAssetIds,
          missingAssetIds: new Set(), previousVisuals: new Map() });
        const preview = projectProductPreviewDialogue(project, shot, evaluateShotAtTime(shot, time, project));
        const exported = evaluateExportShotAtTime(project, shot, time);
        const expectedLayer = exported.layers.find(layer => layer.id === IDS.layerChar)!;
        expect(expectedLayer.mouthPose?.id).toBe(expected);
        expect(preview.layers.find(layer => layer.id === IDS.layerChar)?.mouthPose?.id).toBe(expected);
        expect(stage.visualsByLayer.get(IDS.layerChar)).toEqual(resolveLayerVisualParts(project, shot, expectedLayer, time));
        expect(exported.layers.find(layer => layer.id === other)?.mouthPose?.id).toBe(mode === 'mouth-poses' ? rest : undefined);
      }
    }
  });

  it('assigns the 960–1000 ms pulse to an actual export frame and drops fragments hidden by a manual pose', () => {
    const range = { ...selection, startMs: 920, endMs: 1_040 };
    const pulse = [
      { startMs: 920, endMs: 960, category: 'rest' },
      { startMs: 960, endMs: 1_000, category: 'open' },
      { startMs: 1_000, endMs: 1_040, category: 'rest' },
    ] as const;
    const original = projectWithPoses();
    const project = applyMouthPoseDraft(original, range, pulse, randomUUID);
    expect(original.shots[0]!.timelineEvents).toEqual([]);
    const shot = project.shots[0]!;
    const sampleTimes = [...iterateFormalProjectFrameSchedule(project)].map(frame => frame.shotLocalTimeMs);
    expect(resolveMouthPoseEvent(shot, IDS.layerChar, 958)).toMatchObject({ startMs: 958, endMs: 1_000, poseId: pose });
    for (const event of shot.timelineEvents) {
      if (event.type === 'mouth-pose') expect(sampleTimes.some(time => event.startMs <= time && time < event.endMs)).toBe(true);
    }
    expect(() => applyMouthPoseDraft(original, { ...range, startMs: 960, endMs: 1_000 }, [pulse[1]], randomUUID)).toThrow(/没有可显示/u);
    const id = randomUUID();
    const saved = setManualMouthPose(original, IDS.shot, IDS.layerChar, id, { startMs: 958, endMs: 970, poseId: rest });
    const reapplied = applyMouthPoseDraft(saved, range, pulse, randomUUID);
    const events = reapplied.shots[0]!.timelineEvents.filter(event => event.type === 'mouth-pose');
    expect(events.find(event => event.id === id)).toMatchObject({ startMs: 958, endMs: 970, origin: 'manual' });
    expect(events.some(event => event.origin === 'generated' && event.poseId === pose)).toBe(false);
  });

  it('aligns generated events for a Shot after an off-grid cut and honors export sampling at 30 fps', () => {
    const base = projectWithPoses();
    const shot = base.shots[0]!;
    const leadBackground = { ...shot.layers[0]!, id: randomUUID() };
    const previous = { ...shot, id: randomUUID(), name: 'Lead-in', durationMs: 517,
      layers: [leadBackground], backgroundLayerId: leadBackground.id, timelineEvents: [], dialogues: [], audioClips: [] };
    const project = applyMouthPoseDraft(ProjectSchema.parse({ ...base, shots: [previous, shot] }), selection, [
      { startMs: 440, endMs: 541, category: 'rest' },
      { startMs: 541, endMs: 581, category: 'open' },
      { startMs: 581, endMs: 960, category: 'rest' },
    ], randomUUID);
    const stamps = [...iterateFormalProjectFrameSchedule(project)]
      .filter(frame => frame.shotId === shot.id).map(frame => frame.shotLocalTimeMs);
    const events = project.shots[1]!.timelineEvents.filter(event => event.type === 'mouth-pose');
    const open = events.find(event => event.poseId === pose)!;
    expect(open.startMs).toBe(524); // Project frame 25 at 1041 ms, less the lead-in.
    expect(stamps).toContain(open.startMs);
    expect(events.every(event => stamps.some(time => event.startMs <= time && time < event.endMs))).toBe(true);
    expect(exportFrameTimeMs(29, 30)).toBe(966);
    expect(firstExportFrameTimeAtOrAfter(966, 30)).toBe(966);
    expect(firstExportFrameTimeAtOrAfter(967, 30)).toBe(1_000);
    expect(firstExportFrameTimeAtOrAfter(965, 30)).toBe(966);
  });

  it('waits for the resolved pose image and keeps the second instance at rest under a targeted draft', () => {
    const base = projectWithPoses();
    const configured = ProjectSchema.parse({
      ...base,
      characters: base.characters.map(character => character.id === IDS.character ? {
        ...character, mouthPoseSet: {
          ...character.mouthPoseSet,
          poses: character.mouthPoseSet!.poses.map(item => item.id === pose
            ? { ...item, source: { kind: 'image', assetId: MOUTH_ASSET_ID } } : item),
        },
      } : character),
    });
    const project = applyMouthPoseDraft(configured, selection, draft, randomUUID);
    const shot = project.shots[0]!;
    expect(listShotRuntimeImageAssets(project, shot).map(asset => asset.id)).toContain(MOUTH_ASSET_ID);
    expect(collectExportPreparationMedia(project).map(({ asset }) => asset.id)).toContain(MOUTH_ASSET_ID);
    const time = 450;
    const context = { project, shot, currentTimeMs: time, activeDialogueId: DIALOGUE_ID,
      missingAssetIds: new Set<string>(), previousVisuals: new Map() };
    const readyIds = new Set(project.assets.map(asset => asset.id));
    readyIds.delete(MOUTH_ASSET_ID);
    expect(buildEditorTemporalCanvasModel({ ...context, readyAssetIds: readyIds }).targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    readyIds.add(MOUTH_ASSET_ID);
    const editor = buildEditorTemporalCanvasModel({ ...context, readyAssetIds: readyIds });
    expect(editor.targetReadyLayerIds.has(IDS.layerChar)).toBe(true);
    expect(editor.visualsByLayer.get(IDS.layerChar)?.activeFace?.assetId).toBe(MOUTH_ASSET_ID);
    expect(editor.visualsByLayer.get(other)?.activeFace?.visualSource).toMatchObject({ firstFrame: 0 });
  });

  it('keeps manual edits through a dialogue move, trim and audio unbind, and copies then removes associations', () => {
    const dialogue = new DialogueService();
    let project = applyMouthPoseDraft(projectWithPoses(), selection, draft, randomUUID);
    const manualId = randomUUID();
    project = setManualMouthPose(project, IDS.shot, IDS.layerChar, manualId,
      { startMs: 540, endMs: 720, poseId: rest, dialogueId: DIALOGUE_ID });
    project = dialogue.move(project, { shotId: IDS.shot, dialogueId: DIALOGUE_ID, deltaMs: 120 });
    expect(resolveMouthPoseEvent(project.shots[0]!, IDS.layerChar, 660)?.id).toBe(manualId);
    project = dialogue.resize(project, { shotId: IDS.shot, dialogueId: DIALOGUE_ID, edge: 'start', timeMs: 690 });
    expect(resolveMouthPoseEvent(project.shots[0]!, IDS.layerChar, 690)).toMatchObject({ id: manualId, startMs: 690, endMs: 840 });
    project = dialogue.unbindAudio(project, IDS.shot, DIALOGUE_ID);
    expect(project.shots[0]!.timelineEvents.filter((event) => event.type === 'mouth-pose').map((event) => event.id)).toEqual([manualId]);
    const copy = dialogue.duplicate(project, IDS.shot, DIALOGUE_ID);
    expect(copy.project.shots[0]!.timelineEvents.some((event) => event.type === 'mouth-pose' && event.dialogueId === copy.dialogueId)).toBe(true);
    project = dialogue.remove(copy.project, IDS.shot, DIALOGUE_ID);
    expect(project.shots[0]!.timelineEvents.some((event) => event.id === manualId)).toBe(false);
  });
});

describe('Mouth Cue rest/open domain & evaluator (#1159)', () => {
  it('accepts mouth-cue in v23 ProjectSchema while frozen v20/v21/v22 readers strictly reject it', () => {
    const project = buildMouthProject();
    const event = MouthCueEventSchema.parse({
      id: '95000000-0000-4000-8000-000000000001',
      type: 'mouth-cue',
      layerId: IDS.layerChar,
      startMs: 500,
      endMs: 500,
      state: 'open',
    });

    const v23WithCue = ProjectSchema.parse({
      ...project,
      shots: [{ ...project.shots[0]!, timelineEvents: [event] }],
    });
    expect(v23WithCue.shots[0]!.timelineEvents).toEqual([event]);

    expect(() => TimelineEventV22Schema.parse(event)).toThrow();
    expect(() =>
      ShotV22Schema.parse({ ...v23WithCue.shots[0]!, layers: [] }),
    ).toThrow();
    expect(() =>
      ShotV21Schema.parse({ ...v23WithCue.shots[0]!, layers: [] }),
    ).toThrow();
    expect(() =>
      ShotV20Schema.parse({ ...v23WithCue.shots[0]!, layers: [] }),
    ).toThrow();
    expect(() =>
      ProjectV22Schema.parse({ ...v23WithCue, schemaVersion: 22 }),
    ).toThrow();

    // Invalid state, span endMs !== startMs, and non-character layer are rejected.
    expect(() =>
      MouthCueEventSchema.parse({ ...event, endMs: 600 }),
    ).toThrow();
    expect(() =>
      MouthCueEventSchema.parse({ ...event, state: 'phoneme-a' }),
    ).toThrow();
    expect(() =>
      ProjectSchema.parse({
        ...project,
        shots: [{ ...project.shots[0]!, timelineEvents: [{ ...event, layerId: IDS.layerAsset }] }],
      }),
    ).toThrow('Mouth cue events require a character layer.');
    expect(() =>
      ProjectSchema.parse({
        ...project,
        shots: [{ ...project.shots[0]!, timelineEvents: [{ ...event, startMs: 2_500, endMs: 2_500 }] }],
      }),
    ).toThrow('Timeline event must end within the shot duration.');
  });

  it('does not synthesize mouth cues during v22 -> v23 migration', () => {
    const v22 = ProjectV22Schema.parse({ ...buildProject(), schemaVersion: 22 });
    const migrated = migrateProject(v22);
    expect(migrated.shots[0]!.timelineEvents).toEqual([]);
  });

  it('authors, snaps, updates same-time, deletes, and guards MouthCueEventService', () => {
    const base = buildMouthProject();
    expect(characterHasMouthOpenVisual(base, base.characters[0])).toBe(true);

    // 500ms open (exact 24fps frame) -> 800ms rest (snapped to 792ms frame)
    let current = upsertMouthCueEventAtTime(base, IDS.shot, IDS.layerChar, 'open', 500);
    expect(current.shots[0]!.timelineEvents).toHaveLength(1);
    expect(resolveEffectiveMouthCue(current.shots[0]!, IDS.layerChar, 499)).toBe('none');
    expect(resolveEffectiveMouthCue(current.shots[0]!, IDS.layerChar, 500)).toBe('open');
    expect(resolveEffectiveMouthCue(current.shots[0]!, IDS.layerChar, 791)).toBe('open');

    current = upsertMouthCueEventAtTime(current, IDS.shot, IDS.layerChar, 'rest', 800);
    expect(current.shots[0]!.timelineEvents).toHaveLength(2);
    expect(resolveEffectiveMouthCue(current.shots[0]!, IDS.layerChar, 800)).toBe('rest');
    expect(resolveEffectiveMouthCue(current.shots[0]!, IDS.layerChar, 900)).toBe('rest');

    // Same-effective state at a later time does not duplicate, whereas explicit 'rest' when 'none' DOES author.
    expect(upsertMouthCueEventAtTime(current, IDS.shot, IDS.layerChar, 'rest', 900)).toBe(current);
    const explicitRestFromStart = upsertMouthCueEventAtTime(base, IDS.shot, IDS.layerChar, 'rest', 0);
    expect(explicitRestFromStart.shots[0]!.timelineEvents).toHaveLength(1);
    expect(resolveEffectiveMouthCue(explicitRestFromStart.shots[0]!, IDS.layerChar, 0)).toBe('rest');

    // Same-time update mutates the existing cue in place; re-applying same state returns identical ref.
    const toggledAt500 = upsertMouthCueEventAtTime(current, IDS.shot, IDS.layerChar, 'rest', 500);
    expect(toggledAt500.shots[0]!.timelineEvents).toHaveLength(2);
    expect(resolveEffectiveMouthCue(toggledAt500.shots[0]!, IDS.layerChar, 500)).toBe('rest');
    expect(upsertMouthCueEventAtTime(toggledAt500, IDS.shot, IDS.layerChar, 'rest', 500)).toBe(toggledAt500);

    // Delete restores prior state naturally.
    const restId = current.shots[0]!.timelineEvents.find((e) => e.type === 'mouth-cue' && e.startMs === 792)!.id;
    const afterDelete = deleteMouthCueEvent(current, IDS.shot, IDS.layerChar, restId);
    expect(resolveEffectiveMouthCue(afterDelete.shots[0]!, IDS.layerChar, 900)).toBe('open');

    // Guards: locked layer, missing mouth-open visual, invalid time, background/asset layer.
    const locked = buildMouthProject({ locked: true });
    expect(() => upsertMouthCueEventAtTime(locked, IDS.shot, IDS.layerChar, 'open', 500)).toThrow('锁定');
    const noMouth = buildMouthProject({ mouthKind: 'none' });
    expect(characterHasMouthOpenVisual(noMouth, noMouth.characters[0])).toBe(false);
    expect(() => upsertMouthCueEventAtTime(noMouth, IDS.shot, IDS.layerChar, 'open', 500)).toThrow('张嘴视觉');
    expect(() => upsertMouthCueEventAtTime(base, IDS.shot, IDS.layerChar, 'open', 2_000)).toThrow('有效时间');
    expect(() => upsertMouthCueEventAtTime(base, IDS.shot, IDS.layerBg, 'open', 500)).toThrow('角色');
  });

  it.each([
    { mode: 'single-image' as const, mouthKind: 'image' as const },
    { mode: 'composite' as const, mouthKind: 'image' as const },
    { mode: 'composite' as const, mouthKind: 'graphic' as const },
  ])(
    'enforces priority Authored Cue > Simple Mouth > Expression across Editor, Preview, Export & reverse seeks ($mode / $mouthKind)',
    ({ mode, mouthKind }) => {
      let project = buildMouthProject({ mode, mouthKind, withDialogue: true });
      if (mode === 'composite') {
        project = new CharacterNodeMotionService().apply(
          project,
          { shotId: IDS.shot, layerId: IDS.layerChar, nodeId: 'face', timeMs: 500, autoKey: true },
          { 'transform.offsetX': 48, 'transform.rotationDeg': 35, 'transform.scaleX': 1.8, 'transform.scaleY': 1.8 },
        );
      }
      project = upsertMouthCueEventAtTime(project, IDS.shot, IDS.layerChar, 'open', 500);
      project = upsertMouthCueEventAtTime(project, IDS.shot, IDS.layerChar, 'rest', 800);
      const shot = project.shots[0]!;
      const readyIds = new Set(project.assets.map((asset) => asset.id));

      const expectedAt = new Map<number, 'mouth' | 'expression'>([
        [400, 'mouth'],      // none -> Simple Mouth active (open)
        [500, 'mouth'],      // authored open > Simple Mouth (closed phase)
        [650, 'mouth'],      // authored open > Simple Mouth (closed phase)
        [800, 'expression'], // authored rest > Simple Mouth (open phase)
        [900, 'expression'], // authored rest holds
        [1_000, 'expression'], // authored rest > Simple Mouth (open phase)
      ]);

      // Seek in reverse order AND forward order to verify playback-direction independence.
      for (const sampleMs of [1_000, 900, 800, 650, 500, 400]) {
        const editorModel = buildEditorTemporalCanvasModel({
          project,
          shot,
          currentTimeMs: sampleMs,
          activeDialogueId: DIALOGUE_ID,
          readyAssetIds: readyIds,
          missingAssetIds: new Set(),
          previousVisuals: new Map(),
        });
        const editorVisual = editorModel.visualsByLayer.get(IDS.layerChar)!;

        const previewShot = projectProductPreviewDialogue(
          project,
          shot,
          evaluateShotAtTime(shot, sampleMs, project),
          DIALOGUE_ID,
        );
        const previewVisual = resolveLayerVisualParts(
          project,
          shot,
          previewShot.layers.find((l) => l.id === IDS.layerChar)!,
          sampleMs,
        );

        const exportShot = evaluateExportShotAtTime(project, shot, sampleMs, DIALOGUE_ID);
        const exportVisual = resolveLayerVisualParts(
          project,
          shot,
          exportShot.layers.find((l) => l.id === IDS.layerChar)!,
          sampleMs,
        );

        expect(previewVisual).toEqual(exportVisual);
        expect(editorVisual).toEqual(exportVisual);
        expect(exportVisual.activeFace?.source).toBe(expectedAt.get(sampleMs));

        const facePart = exportVisual.parts.find((part) => part.slot === 'face' || part.slot === 'single')!;
        if (expectedAt.get(sampleMs) === 'mouth') {
          if (mouthKind === 'graphic') {
            expect(facePart.source).toEqual({
              kind: 'character-face-fla-graphic',
              animationId: FACE_GRAPHIC_ID,
              firstFrame: 3,
            });
          } else {
            expect(facePart.source).toEqual({
              kind: 'character-mouth',
              assetId: MOUTH_ASSET_ID,
            });
          }
        }
        if (mode === 'composite') {
          expect(exportVisual.headGroup?.partIds).toContain(facePart.partId);
          if (sampleMs === 650 || sampleMs === 800) {
            expect(exportVisual.facePlacement).toMatchObject({
              offsetX: 48,
              offsetY: -8,
              rotationDeg: 35,
              flipX: false,
            });
            expect(exportVisual.facePlacement?.scale).toBeCloseTo(1.8, 10);
          }
        }
      }

      // ExportPreparation includes mouth-open assets for authored open cues even with ZERO dialogues!
      const noDialogueProject = ProjectSchema.parse({
        ...project,
        shots: [{ ...shot, dialogues: [], audioClips: [] }],
      });
      const mediaSources = collectExportPreparationMedia(noDialogueProject);
      if (mouthKind === 'image') {
        expect(mediaSources.some((entry) => entry.asset.id === MOUTH_ASSET_ID)).toBe(true);
      } else {
        expect(mediaSources.some((entry) => entry.asset.id === IDS.assetChar2)).toBe(true);
      }
    },
  );
});
