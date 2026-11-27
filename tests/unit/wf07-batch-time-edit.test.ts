import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  DialogueServiceError,
  LayerMotionService,
  ProjectSchema,
  ShotService,
  TimelineEventBatchService,
  TimelineEventBatchError,
  frameTimeMs,
  layerCompositeKeyTimes,
  reconcileDialogueMouthPoses,
  resolveLayerAnimationTimeLink,
  type AudioAsset,
  type AudioClip,
  type CharacterActionEvent,
  type Dialogue,
  type ExpressionEvent,
  type GraphicPlaybackEvent,
  type MouthPoseEvent,
  type MoveEvent,
  type OpacityEvent,
  type Project,
  type ScaleEvent,
  type ShakeEvent,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { TimelineBatchStore } from '../../src/renderer/stores/timelineBatchStore';
import { buildProject, IDS } from './domain/testProject';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';

const AUDIO_ASSET_1 = '80000000-0000-4000-8000-000000000001';
const AUDIO_ASSET_2 = '80000000-0000-4000-8000-000000000002';
const AUDIO_ASSET_3 = '80000000-0000-4000-8000-000000000003';
const CLIP_1 = '81000000-0000-4000-8000-000000000001';
const CLIP_2 = '81000000-0000-4000-8000-000000000002';
const CLIP_3 = '81000000-0000-4000-8000-000000000003';
const DLG_1 = '82000000-0000-4000-8000-000000000001';
const DLG_2 = '82000000-0000-4000-8000-000000000002';
const DLG_3 = '82000000-0000-4000-8000-000000000003';
const DLG_4 = '82000000-0000-4000-8000-000000000004';
const DLG_5 = '82000000-0000-4000-8000-000000000005';
const POSE_GEN_1 = '83000000-0000-4000-8000-000000000001';
const POSE_GEN_2 = '83000000-0000-4000-8000-000000000002';
const POSE_MAN_3 = '83000000-0000-4000-8000-000000000003';
const POSE_UNSEL = '83000000-0000-4000-8000-000000000004';
const GEN_ID_1 = '84000000-0000-4000-8000-000000000001';
const GEN_ID_2 = '84000000-0000-4000-8000-000000000002';
const POSE_OPEN = '85000000-0000-4000-8000-000000000001';
const ACTION_ID = '86000000-0000-4000-8000-000000000001';
const EV_MOVE = '87000000-0000-4000-8000-000000000001';
const EV_SCALE = '87000000-0000-4000-8000-000000000002';
const EV_OPACITY = '87000000-0000-4000-8000-000000000003';
const EV_SHAKE = '87000000-0000-4000-8000-000000000004';
const EV_CHAR_ACT = '87000000-0000-4000-8000-000000000005';
const EV_EXPR = '87000000-0000-4000-8000-000000000006';
const EV_GRAPHIC = '87000000-0000-4000-8000-000000000007';

function makeIds() {
  let counter = 0;
  return () =>
    `99000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

function makeAudioAsset(id: string, name: string, durationMs = 5000): AudioAsset {
  return {
    id,
    kind: 'audio',
    name,
    relativePath: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    durationMs,
    sha256: 'a'.repeat(64),
  };
}

function buildVoicedDialogueProject(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;

  const audioAssets: AudioAsset[] = [
    makeAudioAsset(AUDIO_ASSET_1, 'line1', 4000),
    makeAudioAsset(AUDIO_ASSET_2, 'line2', 4000),
    makeAudioAsset(AUDIO_ASSET_3, 'line3', 4000),
  ];

  const clips: AudioClip[] = [
    {
      id: CLIP_1,
      role: 'dialogue',
      name: 'line1',
      assetId: AUDIO_ASSET_1,
      startMs: 200,
      endMs: 1200,
      offsetMs: 150,
      volume: 0.85,
    },
    {
      id: CLIP_2,
      role: 'dialogue',
      name: 'line2',
      assetId: AUDIO_ASSET_2,
      startMs: 1200,
      endMs: 2200,
      offsetMs: 300,
      volume: 0.9,
    },
    {
      id: CLIP_3,
      role: 'dialogue',
      name: 'line3',
      assetId: AUDIO_ASSET_3,
      startMs: 2200,
      endMs: 3200,
      offsetMs: 50,
      volume: 0.75,
    },
  ];

  const dialogues: Dialogue[] = [
    {
      id: DLG_1,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 200,
      endMs: 1200,
      text: '第一句相邻对白',
      audioClipId: CLIP_1,
    },
    {
      id: DLG_2,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 1200,
      endMs: 2200,
      text: '第二句相邻对白',
      audioClipId: CLIP_2,
    },
    {
      id: DLG_3,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 2200,
      endMs: 3200,
      text: '第三句带口型对白',
      audioClipId: CLIP_3,
    },
    {
      id: DLG_4,
      speakerType: 'narrator',
      subtitleStyleId: IDS.subtitle,
      startMs: 3400,
      endMs: 4200,
      text: '第四句无配音旁白',
    },
    {
      id: DLG_5,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 6500,
      endMs: 7500,
      text: '未选中的远端对白',
    },
  ];

  const mouthPoses: MouthPoseEvent[] = [
    {
      id: POSE_GEN_1,
      type: 'mouth-pose',
      layerId: IDS.layerChar,
      startMs: 300,
      endMs: 900,
      poseId: POSE_OPEN,
      origin: 'generated',
      dialogueId: DLG_1,
      generationId: GEN_ID_1,
    },
    {
      id: POSE_GEN_2,
      type: 'mouth-pose',
      layerId: IDS.layerChar,
      startMs: 1300,
      endMs: 1900,
      poseId: POSE_OPEN,
      origin: 'generated',
      dialogueId: DLG_2,
      generationId: GEN_ID_2,
    },
    {
      id: POSE_MAN_3,
      type: 'mouth-pose',
      layerId: IDS.layerChar,
      startMs: 2300,
      endMs: 2900,
      poseId: POSE_OPEN,
      origin: 'manual',
      dialogueId: DLG_3,
    },
    {
      id: POSE_UNSEL,
      type: 'mouth-pose',
      layerId: IDS.layerChar,
      startMs: 6600,
      endMs: 7100,
      poseId: POSE_OPEN,
      origin: 'manual',
      dialogueId: DLG_5,
    },
  ];

  const baseChar = base.characters[0]!;
  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...audioAssets],
    characters: [
      {
        ...baseChar,
        mouthPoseSet: {
          poses: [
            {
              id: POSE_OPEN,
              name: '张口',
              source: { kind: 'image', assetId: IDS.assetChar2 },
              target: { kind: 'face' },
            },
          ],
          restPoseId: POSE_OPEN,
          analyzerMapping: {
            rest: POSE_OPEN,
            open: POSE_OPEN,
            wide: POSE_OPEN,
            round: POSE_OPEN,
            closed: POSE_OPEN,
          },
          driveMode: 'mouth-poses',
        },
      },
    ],
    shots: [
      {
        ...shot,
        durationMs: 8000,
        dialogues,
        audioClips: clips,
        timelineEvents: mouthPoses,
      },
    ],
  });
}

function buildActionProject(): Project {
  const base = graphicFaceProject(false);
  const shot = base.shots[0]!;
  const char = base.characters[0]!;
  const graphicAnimId = FACE_GRAPHIC_ID;
  const graphicLayerId = IDS.animationLayer;

  const moveEvent: MoveEvent = {
    id: EV_MOVE,
    type: 'move',
    layerId: IDS.layerAsset,
    startMs: 500,
    endMs: 1500,
    from: { x: 400, y: 500 },
    to: { x: 800, y: 500 },
    easing: 'ease-in-out',
  };
  const scaleEvent: ScaleEvent = {
    id: EV_SCALE,
    type: 'scale',
    layerId: IDS.layerAsset,
    startMs: 600,
    endMs: 1800,
    from: { x: 1, y: 1 },
    to: { x: 1.4, y: 1.4 },
    easing: 'linear',
  };
  const opacityEvent: OpacityEvent = {
    id: EV_OPACITY,
    type: 'opacity',
    layerId: IDS.layerAsset,
    startMs: 800,
    endMs: 1600,
    from: 1,
    to: 0.4,
    easing: 'ease-in-out',
  };
  const shakeEvent: ShakeEvent = {
    id: EV_SHAKE,
    type: 'shake',
    layerId: IDS.layerChar,
    startMs: 1000,
    endMs: 1800,
    amplitudeX: 12,
    amplitudeY: 8,
    frequencyHz: 15,
  };
  const charActionEvent: CharacterActionEvent = {
    id: EV_CHAR_ACT,
    type: 'character-action',
    layerId: IDS.layerChar,
    startMs: 1200,
    endMs: 2400,
    actionId: ACTION_ID,
  };
  const exprEvent: ExpressionEvent = {
    id: EV_EXPR,
    type: 'expression',
    layerId: IDS.layerChar,
    startMs: 1200,
    endMs: 1200,
    expressionId: IDS.expressionAngry,
  };
  const graphicPlaybackEvent: GraphicPlaybackEvent = {
    id: EV_GRAPHIC,
    type: 'graphic-playback',
    layerId: graphicLayerId,
    startMs: 1000,
    endMs: 2000,
    animationId: graphicAnimId,
    playbackStartMs: 800,
    firstFrame: 0,
    range: { firstFrame: 0, lastFrame: 1 },
    playback: { mode: 'loop', endBehavior: 'hold' },
  };

  return ProjectSchema.parse({
    ...base,
    characters: [
      {
        ...char,
        actions: [
          {
            id: ACTION_ID,
            name: '挥手',
            animationId: graphicAnimId,
            placement: { offsetX: 0, offsetY: 0, scale: 1 },
          },
        ],
      },
    ],
    shots: [
      {
        ...shot,
        durationMs: 6000,
        layers: [
          ...shot.layers,
          {
            id: graphicLayerId,
            name: '联动特效',
            source: { kind: 'animation', animationId: graphicAnimId },
            anchor: 'center',
            x: 900,
            y: 500,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 3,
            locked: false,
            flipX: false,
            startTimeMs: 0,
            animationPlayback: { mode: 'loop', endBehavior: 'hold' },
            animationTimeLink: {
              kind: 'character-action',
              sourceLayerId: IDS.layerChar,
              eventId: EV_CHAR_ACT,
              offsetMs: 125,
            },
          },
        ],
        timelineEvents: [
          moveEvent,
          scaleEvent,
          opacityEvent,
          shakeEvent,
          charActionEvent,
          exprEvent,
          graphicPlaybackEvent,
        ],
      },
    ],
  });
}

describe('WF-07 batch timed-dialogue shift & multi-dialogue mouth-pose reconcile', () => {
  it('shifts 3 adjacent voiced dialogues (with offset/volume/mouth-poses) + 1 unvoiced dialogue together without false collision', () => {
    const service = new DialogueService({ createId: makeIds() });
    const project = buildVoicedDialogueProject();

    const moved = service.moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2, DLG_3, DLG_4],
      deltaMs: 500,
    });
    const shot = moved.shots[0]!;

    // All 4 shifted by +500ms, preserving exact durations & gaps; DLG_5 untouched.
    expect(shot.dialogues.map((d) => [d.id, d.startMs, d.endMs])).toEqual([
      [DLG_1, 700, 1700],
      [DLG_2, 1700, 2700],
      [DLG_3, 2700, 3700],
      [DLG_4, 3900, 4700],
      [DLG_5, 6500, 7500],
    ]);

    // Bound audio clips shifted by +500ms preserving offsetMs & volume.
    expect(
      shot.audioClips.map((c) => [c.id, c.startMs, c.endMs, c.offsetMs, c.volume]),
    ).toEqual([
      [CLIP_1, 700, 1700, 150, 0.85],
      [CLIP_2, 1700, 2700, 300, 0.9],
      [CLIP_3, 2700, 3700, 50, 0.75],
    ]);

    // Generated & manual mouth poses reconciled once for all moved dialogues;
    // unselected DLG_5 mouth pose stays at [6600, 7100].
    const poses = shot.timelineEvents.filter((e) => e.type === 'mouth-pose');
    expect(poses.map((p) => [p.id, p.startMs, p.endMs])).toEqual([
      [POSE_GEN_1, 800, 1400],
      [POSE_GEN_2, 1800, 2400],
      [POSE_MAN_3, 2800, 3400],
      [POSE_UNSEL, 6600, 7100],
    ]);
  });

  it('clamps unified delta for the entire group without per-item clamping when boundaryMode=clamp, and rejects when boundaryMode=reject', () => {
    const service = new DialogueService({ createId: makeIds() });
    const project = buildVoicedDialogueProject();

    // Earliest start is 200ms -> moving -500ms rejects by default.
    expect(() =>
      service.moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: [DLG_1, DLG_2],
        deltaMs: -500,
      }),
    ).toThrow(DialogueServiceError);

    // With boundaryMode='clamp', whole group shifts by -200ms (preserving 0ms gap).
    const plan = service.planMoveMany(project, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: -500,
      boundaryMode: 'clamp',
    });
    expect(plan.clamped).toBe(true);
    expect(plan.deltaMs).toBe(-200);
    expect(plan.allowedDeltaRange.minDeltaMs).toBe(-200);

    const moved = service.moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: -500,
      boundaryMode: 'clamp',
    });
    const d1 = moved.shots[0]!.dialogues.find((d) => d.id === DLG_1)!;
    const d2 = moved.shots[0]!.dialogues.find((d) => d.id === DLG_2)!;
    expect([d1.startMs, d1.endMs]).toEqual([0, 1000]);
    expect([d2.startMs, d2.endMs]).toEqual([1000, 2000]);
  });

  it('handles shared AudioClip once when all referencing dialogues are selected, and respects split vs include when an unselected dialogue shares the clip', () => {
    const service = new DialogueService({ createId: makeIds() });
    const base = buildVoicedDialogueProject();
    // Make DLG_1, DLG_2, and DLG_5 share CLIP_1, and keep DLG_3 far enough away so +400ms is valid.
    const sharedProject = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...base.shots[0]!,
          dialogues: base.shots[0]!.dialogues
            .filter((d) => d.id !== DLG_3 && d.id !== DLG_4)
            .map((d) =>
              d.id === DLG_2 || d.id === DLG_5 ? { ...d, audioClipId: CLIP_1 } : d,
            ),
          timelineEvents: base.shots[0]!.timelineEvents.filter(
            (e) => e.type !== 'mouth-pose' || (e.dialogueId !== DLG_3 && e.dialogueId !== DLG_4),
          ),
        },
      ],
    });

    // 1. Default policy ('split'): DLG_1 + DLG_2 selected, DLG_5 unselected.
    // Original CLIP_1 stays at [200, 1200] for DLG_5; ONE new shifted copy [600, 1600] is created for DLG_1 & DLG_2.
    const splitPlan = service.planMoveMany(sharedProject, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: 400,
      sharedClipPolicy: 'split',
    });
    expect(splitPlan.splitAudioClipIds).toEqual([CLIP_1]);
    expect(splitPlan.includedDialogueIds).toEqual([]);

    const splitResult = service.moveMany(sharedProject, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: 400,
      sharedClipPolicy: 'split',
    });
    const splitShot = splitResult.shots[0]!;
    const origClip = splitShot.audioClips.find((c) => c.id === CLIP_1)!;
    expect([origClip.startMs, origClip.endMs]).toEqual([200, 1200]);

    const movedD1 = splitShot.dialogues.find((d) => d.id === DLG_1)!;
    const movedD2 = splitShot.dialogues.find((d) => d.id === DLG_2)!;
    const unselD5 = splitShot.dialogues.find((d) => d.id === DLG_5)!;
    expect(unselD5.audioClipId).toBe(CLIP_1);
    expect([unselD5.startMs, unselD5.endMs]).toEqual([6500, 7500]);
    expect(movedD1.audioClipId).toBeDefined();
    expect(movedD1.audioClipId).not.toBe(CLIP_1);
    expect(movedD2.audioClipId).toBe(movedD1.audioClipId);
    const copyClip = splitShot.audioClips.find((c) => c.id === movedD1.audioClipId)!;
    expect([copyClip.startMs, copyClip.endMs, copyClip.offsetMs]).toEqual([
      600, 1600, 150,
    ]);

    // 2. Explicit 'include' policy: DLG_5 is included in the shift and CLIP_1 shifts in-place ONCE.
    const includePlan = service.planMoveMany(sharedProject, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: 400,
      sharedClipPolicy: 'include',
    });
    expect(includePlan.includedDialogueIds).toEqual([DLG_5]);
    expect(includePlan.splitAudioClipIds).toEqual([]);

    const includeResult = service.moveMany(sharedProject, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2],
      deltaMs: 400,
      sharedClipPolicy: 'include',
    });
    const incShot = includeResult.shots[0]!;
    const shiftedClip = incShot.audioClips.find((c) => c.id === CLIP_1)!;
    expect([shiftedClip.startMs, shiftedClip.endMs]).toEqual([600, 1600]);
    const incD5 = incShot.dialogues.find((d) => d.id === DLG_5)!;
    expect([incD5.startMs, incD5.endMs]).toEqual([6900, 7900]);
  });

  it('preserves single-dialogue move and single-dialogue reconcileDialogueMouthPoses compatibility', () => {
    const service = new DialogueService({ createId: makeIds() });
    const project = buildVoicedDialogueProject();
    // Single-dialogue move of DLG_4 (unvoiced) by +200ms still works identically.
    const moved = service.move(project, {
      shotId: IDS.shot,
      dialogueId: DLG_4,
      deltaMs: 200,
    });
    expect(moved.shots[0]!.dialogues.find((d) => d.id === DLG_4)).toMatchObject({
      startMs: 3600,
      endMs: 4400,
    });

    // Direct single-object call to reconcileDialogueMouthPoses remains compatible.
    const beforeShot = project.shots[0]!;
    const afterShot = {
      ...beforeShot,
      dialogues: beforeShot.dialogues.map((d) =>
        d.id === DLG_3 ? { ...d, startMs: d.startMs + 100, endMs: d.endMs + 100 } : d,
      ),
      audioClips: beforeShot.audioClips.map((c) =>
        c.id === CLIP_3 ? { ...c, startMs: c.startMs + 100, endMs: c.endMs + 100 } : c,
      ),
    };
    const reconciled = reconcileDialogueMouthPoses(beforeShot, afterShot, {
      dialogueId: DLG_3,
      deltaMs: 100,
    });
    expect(reconciled.find((e) => e.id === POSE_MAN_3)).toMatchObject({
      startMs: 2400,
      endMs: 3000,
    });
  });
});

describe('WF-07 TimelineEventBatchService: action batch shift, unified duration, keyframe spans & cross-type shift', () => {
  it('shifts move/scale/opacity/shake/character-action/graphic-playback preserving params, animationTimeLink, and skipping unsupported items locally', () => {
    const service = new TimelineEventBatchService();
    const project = buildActionProject();

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [
        EV_MOVE,
        EV_SCALE,
        EV_OPACITY,
        EV_SHAKE,
        EV_CHAR_ACT,
        EV_GRAPHIC,
        EV_EXPR, // unsupported instantaneous switch
      ],
      edit: { action: 'shift', deltaMs: 400 },
    });

    expect(plan.entries).toHaveLength(6);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.itemId).toBe(EV_EXPR);
    expect(plan.skipped[0]!.reasonCode).toBe('UNSUPPORTED_EVENT_TYPE');

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [
        EV_MOVE,
        EV_SCALE,
        EV_OPACITY,
        EV_SHAKE,
        EV_CHAR_ACT,
        EV_GRAPHIC,
        EV_EXPR,
      ],
      edit: { action: 'shift', deltaMs: 400 },
    });
    const shot = shifted.shots[0]!;
    expect(shot.timelineEvents.find((e) => e.id === EV_MOVE)).toMatchObject({
      startMs: 900,
      endMs: 1900,
      from: { x: 400, y: 500 },
      to: { x: 800, y: 500 },
      easing: 'ease-in-out',
    });
    expect(shot.timelineEvents.find((e) => e.id === EV_GRAPHIC)).toMatchObject({
      startMs: 1400,
      endMs: 2400,
      playbackStartMs: 1200,
    });
    // Expression event remained untouched.
    expect(shot.timelineEvents.find((e) => e.id === EV_EXPR)).toMatchObject({
      startMs: 1200,
      endMs: 1200,
    });
    // animationTimeLink on linked animation layer follows shifted character-action!
    const linkedLayer = shot.layers.find((l) => l.id === IDS.animationLayer)!;
    const resolvedLink = resolveLayerAnimationTimeLink(shot, linkedLayer);
    expect(resolvedLink.status).toBe('active');
    if (resolvedLink.status === 'active') {
      expect(resolvedLink.sourceStartMs).toBe(1600);
      expect(resolvedLink.sourceEndMs).toBe(2800);
      expect(resolvedLink.offsetMs).toBe(125);
    }
  });

  it('unifies duration for supported action events and real LayerMotion keyframe spans on the 24fps frame grid', () => {
    const batchService = new TimelineEventBatchService();
    const motionService = new LayerMotionService();
    let project = buildActionProject();

    // Author real keyframe tracks on IDS.animationLayer at frames 6 (250ms), 12 (500ms), 18 (750ms)
    const t1 = frameTimeMs(6);
    const t2 = frameTimeMs(12);
    const t3 = frameTimeMs(18);
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: t1, autoKey: true },
      { x: 950 },
    );
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: t2, autoKey: true },
      { x: 1050 },
    );
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: t3, autoKey: true },
      { x: 1150 },
    );
    project = motionService.setKeyEasing(
      project,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: t1 },
      'ease-in-out',
    );

    const unified = batchService.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_MOVE, EV_SCALE, EV_SHAKE, EV_CHAR_ACT],
      layerMotionSpans: [
        {
          id: 'span-1',
          layerId: IDS.animationLayer,
          startMs: t1,
          endMs: t3,
        },
      ],
      edit: { action: 'unify-duration', durationMs: 1000 },
    });

    const shot = unified.shots[0]!;
    expect(shot.timelineEvents.find((e) => e.id === EV_MOVE)).toMatchObject({
      startMs: 500,
      endMs: 1500,
    });
    expect(shot.timelineEvents.find((e) => e.id === EV_SCALE)).toMatchObject({
      startMs: 600,
      endMs: 1600,
    });
    expect(shot.timelineEvents.find((e) => e.id === EV_SHAKE)).toMatchObject({
      startMs: 1000,
      endMs: 2000,
    });
    expect(shot.timelineEvents.find((e) => e.id === EV_CHAR_ACT)).toMatchObject({
      startMs: 1200,
      endMs: 2200,
    });

    // Real keyframe track was proportionally remapped from [250, 500, 750] to [250, 750, 1250] preserving easing!
    const layer = shot.layers.find((l) => l.id === IDS.animationLayer)!;
    const offsetXTrack = layer.animationClip!.tracks.find(
      (track) => track.property === 'transform.offsetX',
    )!;
    expect(offsetXTrack.keys.map((k) => k.timeMs)).toEqual([
      0,
      frameTimeMs(6),
      frameTimeMs(18),
      frameTimeMs(30),
    ]);
    expect(
      offsetXTrack.keys.find((k) => k.timeMs === frameTimeMs(6))
        ?.interpolationToNext,
    ).toBe('ease-in-out');
  });

  it('rejects all-unsupported batch without mutating project', () => {
    const service = new TimelineEventBatchService();
    const project = buildActionProject();
    expect(() =>
      service.plan(project, {
        shotId: IDS.shot,
        eventIds: [EV_EXPR],
        edit: { action: 'unify-duration', durationMs: 1000 },
      }),
    ).toThrow(TimelineEventBatchError);
  });

  it('executes gap-preserving cross-type shift across dialogues and actions in one commit, with 1 Undo/Redo and save/reopen roundtrip', () => {
    const voiced = buildVoicedDialogueProject();
    const actions = buildActionProject();
    const combined = ProjectSchema.parse({
      ...voiced,
      assets: actions.assets.concat(
        voiced.assets.filter((a) => !actions.assets.some((b) => b.id === a.id)),
      ),
      animations: actions.animations,
      characters: [
        {
          ...voiced.characters[0]!,
          actions: actions.characters[0]!.actions,
        },
      ],
      shots: [
        {
          ...voiced.shots[0]!,
          layers: actions.shots[0]!.layers,
          timelineEvents: [
            ...voiced.shots[0]!.timelineEvents,
            ...actions.shots[0]!.timelineEvents,
          ],
        },
      ],
    });

    const editorStore = new EditorProjectStore();
    editorStore.open('C:\\temp\\wf07-project', combined);
    const shotStore = new ShotStore(editorStore, new ShotService());
    const layerSelection = new LayerSelectionStore(editorStore, shotStore);
    const dialogueSelection = new DialogueSelectionStore(
      editorStore,
      shotStore,
      layerSelection,
    );
    const dialogueStore = new DialogueStore(
      editorStore,
      shotStore,
      new DialogueService({ createId: makeIds() }),
      { getSnapshot: () => ({ currentTimeMs: 0 }) },
      dialogueSelection,
    );
    const batchStore = new TimelineBatchStore(
      editorStore,
      shotStore,
      new TimelineEventBatchService(),
    );

    // Multi-select temporary session state never writes to Project.
    dialogueSelection.select(DLG_1);
    dialogueSelection.toggleInSelection(DLG_2);
    expect(dialogueSelection.getSelectedDialogueIds()).toEqual([DLG_1, DLG_2]);
    expect(editorStore.getSnapshot()!.revision).toBe(0);
    expect(editorStore.getSnapshot()!.dirty).toBe(false);

    // Read-only preview never writes to Project.
    const preview = batchStore.planCrossTypeShift({
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE, EV_SHAKE, EV_EXPR],
      deltaMs: 200,
    });
    expect(preview.dialoguePlan?.entries).toHaveLength(3);
    expect(preview.actionPlan?.entries).toHaveLength(2);
    expect(preview.skipped).toHaveLength(1);
    expect(editorStore.getSnapshot()!.revision).toBe(0);
    expect(editorStore.getSnapshot()!.dirty).toBe(false);

    // Single commit -> revision 1, 1 Undo/Redo entry!
    // Include DLG_3 so DLG_1/DLG_2/DLG_3 shift together without colliding with unselected DLG_3.
    batchStore.applyCrossTypeShift({
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE, EV_SHAKE, EV_EXPR],
      deltaMs: 200,
    });
    const afterCommit = editorStore.getSnapshot()!;
    expect(afterCommit.revision).toBe(1);
    expect(afterCommit.dirty).toBe(true);
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);

    const committedShot = afterCommit.project.shots[0]!;
    expect(committedShot.dialogues.find((d) => d.id === DLG_1)).toMatchObject({
      startMs: 400,
      endMs: 1400,
    });
    expect(committedShot.timelineEvents.find((e) => e.id === EV_MOVE)).toMatchObject({
      startMs: 700,
      endMs: 1700,
    });

    // Save/reopen roundtrip via JSON + ProjectSchema.parse preserves everything and remains editable.
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(afterCommit.project)),
    );
    expect(reopened.shots[0]!.dialogues.find((d) => d.id === DLG_1)).toMatchObject({
      startMs: 400,
      endMs: 1400,
    });
    expect(
      reopened.shots[0]!.timelineEvents.find((e) => e.id === POSE_GEN_1),
    ).toMatchObject({
      startMs: 500,
      endMs: 1100,
    });

    // 1 Undo restores exact original state.
    editorStore.undo();
    const afterUndo = editorStore.getSnapshot()!;
    expect(afterUndo.project.shots[0]!.dialogues.find((d) => d.id === DLG_1)).toMatchObject({
      startMs: 200,
      endMs: 1200,
    });
    expect(
      afterUndo.project.shots[0]!.timelineEvents.find((e) => e.id === EV_MOVE),
    ).toMatchObject({
      startMs: 500,
      endMs: 1500,
    });

    // 1 Redo re-applies exact shifted state.
    editorStore.redo();
    const afterRedo = editorStore.getSnapshot()!;
    expect(afterRedo.project.shots[0]!.dialogues.find((d) => d.id === DLG_1)).toMatchObject({
      startMs: 400,
      endMs: 1400,
    });
    expect(
      afterRedo.project.shots[0]!.timelineEvents.find((e) => e.id === EV_MOVE),
    ).toMatchObject({
      startMs: 700,
      endMs: 1700,
    });

    // Ensure dialogueStore.planMoveMany / moveMany also works cleanly.
    const dlgPlan = dialogueStore.planMoveMany([DLG_4], 200);
    expect(dlgPlan.deltaMs).toBe(200);
    dialogueStore.moveMany([DLG_4], 200);
    expect(
      editorStore.getSnapshot()!.project.shots[0]!.dialogues.find((d) => d.id === DLG_4),
    ).toMatchObject({ startMs: 3600, endMs: 4400 });

    dialogueSelection.dispose();
    layerSelection.dispose();
    shotStore.dispose();
  });

  it('R7: keeps dialogues, audio, mouth poses, timeline events, and LayerMotion keyframes in sync on 24fps grid for non-frame deltas, bounds, negative shifts, and repeated shifts without degrading pure-ms editing', () => {
    const voiced = buildVoicedDialogueProject();
    const actions = buildActionProject();
    const motionService = new LayerMotionService();

    // Combine voiced dialogues + timeline events + LayerMotion keyframes at frame 12 (500ms) and frame 24 (1000ms)
    const mergedAssets = [
      ...voiced.assets,
      ...actions.assets.filter(
        (asset) => !voiced.assets.some((existing) => existing.id === asset.id),
      ),
    ];
    let combined = ProjectSchema.parse({
      ...voiced,
      assets: mergedAssets,
      animations: actions.animations,
      characters: [
        {
          ...voiced.characters[0]!,
          actions: actions.characters[0]!.actions,
        },
      ],
      shots: [
        {
          ...voiced.shots[0]!,
          layers: actions.shots[0]!.layers,
          timelineEvents: [
            ...voiced.shots[0]!.timelineEvents,
            ...actions.shots[0]!.timelineEvents,
          ],
        },
      ],
    });
    const k1 = frameTimeMs(12); // 500ms (aligned with EV_MOVE startMs=500ms)
    const k2 = frameTimeMs(24); // 1000ms
    combined = motionService.applyTransform(
      combined,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: k1, autoKey: true },
      { x: 960 },
    );
    combined = motionService.applyTransform(
      combined,
      { shotId: IDS.shot, layerId: IDS.animationLayer, timeMs: k2, autoKey: true },
      { x: 1120 },
    );

    const batchService = new TimelineEventBatchService();
    const spanRef = {
      id: `span:${IDS.animationLayer}`,
      layerId: IDS.animationLayer,
      startMs: k1,
      endMs: k2,
    };

    // 1. Non-whole-frame input (+100ms = 2.4 frames -> +2 frames = +83ms):
    // preview and applied result must match identically across dialogue, audio, mouth pose, event, and keyframes!
    const preview100 = batchService.planCrossTypeShift(combined, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE],
      layerMotionSpans: [spanRef],
      deltaMs: 100,
    });
    expect(preview100.deltaFrames).toBe(2);
    expect(preview100.frameSnapped).toBe(true);
    expect(preview100.deltaMs).toBe(frameTimeMs(14) - frameTimeMs(12)); // 83ms
    expect(preview100.dialoguePlan?.deltaMs).toBe(83);
    expect(preview100.actionPlan?.entries[0]).toMatchObject({
      nextStartMs: 583,
      nextEndMs: 1_583,
    });
    expect(preview100.actionPlan?.motionSpanEntries[0]).toMatchObject({
      nextStartMs: frameTimeMs(14),
      nextEndMs: frameTimeMs(26),
    });

    // Apply via TimelineBatchStore to also verify single Undo/Redo!
    const editorStore = new EditorProjectStore();
    editorStore.open('C:\\temp\\wf07-r7', combined);
    const localShotStore = new ShotStore(editorStore, new ShotService());
    const localBatchStore = new TimelineBatchStore(
      editorStore,
      localShotStore,
      batchService,
    );
    localBatchStore.applyCrossTypeShift({
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE],
      layerMotionSpans: [spanRef],
      deltaMs: 100,
    });
    expect(editorStore.history.getSnapshot().undoCount).toBe(1);
    const shiftedOnce = editorStore.getSnapshot()!.project;
    const shotAfter1 = shiftedOnce.shots[0]!;
    expect(shotAfter1.dialogues.find((d) => d.id === DLG_1)).toMatchObject({
      startMs: 283,
      endMs: 1_283,
    });
    expect(shotAfter1.audioClips.find((c) => c.id === CLIP_1)).toMatchObject({
      startMs: 283,
      endMs: 1_283,
    });
    expect(
      shotAfter1.timelineEvents.find((e) => e.id === POSE_GEN_1),
    ).toMatchObject({
      startMs: 383,
      endMs: 983,
    });
    expect(shotAfter1.timelineEvents.find((e) => e.id === EV_MOVE)).toMatchObject({
      startMs: 583,
      endMs: 1_583,
    });
    // Unselected dialogue & mouth pose remain untouched!
    expect(shotAfter1.dialogues.find((d) => d.id === DLG_5)).toMatchObject({
      startMs: 6_500,
      endMs: 7_500,
    });
    const animLayer1 = shotAfter1.layers.find((l) => l.id === IDS.animationLayer)!;
    const movedKeys1 = layerCompositeKeyTimes(animLayer1);
    expect(movedKeys1).toEqual([0, frameTimeMs(14), frameTimeMs(26)]);
    // Exact 0ms relative offset between EV_MOVE and LayerMotion span start!
    expect(shotAfter1.timelineEvents.find((e) => e.id === EV_MOVE)!.startMs).toBe(
      movedKeys1[1],
    );

    // 1 Undo restores exact original positions across dialogues, events, and keyframes!
    editorStore.undo();
    const afterUndoShot = editorStore.getSnapshot()!.project.shots[0]!;
    expect(afterUndoShot.dialogues.find((d) => d.id === DLG_1)!.startMs).toBe(200);
    expect(afterUndoShot.timelineEvents.find((e) => e.id === EV_MOVE)!.startMs).toBe(500);
    expect(
      layerCompositeKeyTimes(
        afterUndoShot.layers.find((l) => l.id === IDS.animationLayer)!,
      ),
    ).toEqual([0, 500, 1_000]);
    localShotStore.dispose();

    // 2. Negative shift (-100ms = -2 frames = -83ms) round-trips back to exact original positions!
    const shiftedBack = batchService.applyCrossTypeShift(shiftedOnce, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE],
      layerMotionSpans: [
        {
          id: spanRef.id,
          layerId: IDS.animationLayer,
          startMs: frameTimeMs(14),
          endMs: frameTimeMs(26),
        },
      ],
      deltaMs: -100,
    });
    const shotBack = shiftedBack.shots[0]!;
    expect(shotBack.dialogues.find((d) => d.id === DLG_1)!.startMs).toBe(200);
    expect(shotBack.timelineEvents.find((e) => e.id === EV_MOVE)!.startMs).toBe(500);
    expect(
      layerCompositeKeyTimes(
        shotBack.layers.find((l) => l.id === IDS.animationLayer)!,
      ),
    ).toEqual([0, 500, 1_000]);

    // 3. Repeated +100ms shifts (12 iterations = +24 frames = +1000ms) accumulate ZERO drift!
    let rolling = combined;
    let curStart = k1;
    let curEnd = k2;
    for (let step = 0; step < 12; step += 1) {
      const next = batchService.applyCrossTypeShift(rolling, {
        shotId: IDS.shot,
        dialogueIds: [DLG_1, DLG_2, DLG_3, DLG_4],
        eventIds: [EV_MOVE],
        layerMotionSpans: [
          { id: spanRef.id, layerId: IDS.animationLayer, startMs: curStart, endMs: curEnd },
        ],
        deltaMs: 100,
      });
      const layer = next.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
      const times = layerCompositeKeyTimes(layer);
      curStart = times[1]!;
      curEnd = times[2]!;
      rolling = next;
    }
    const shotAfter12 = rolling.shots[0]!;
    // All three moved by EXACTLY +1000ms (24 frames), zero drift!
    expect(shotAfter12.dialogues.find((d) => d.id === DLG_1)!.startMs).toBe(1_200);
    expect(shotAfter12.timelineEvents.find((e) => e.id === EV_MOVE)!.startMs).toBe(1_500);
    expect(curStart).toBe(1_500);
    expect(curEnd).toBe(2_000);

    // 4. Boundary clamp respects tightest ms bound on 24fps grid without desync (DLG_1 starts at 200ms -> max left shift -200ms -> -4 frames = -167ms)
    const clampedPlan = batchService.planCrossTypeShift(combined, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE],
      layerMotionSpans: [spanRef],
      deltaMs: -500,
      boundaryMode: 'clamp',
    });
    expect(clampedPlan.clamped).toBe(true);
    expect(clampedPlan.deltaFrames).toBe(-4);
    expect(clampedPlan.deltaMs).toBe(frameTimeMs(8) - frameTimeMs(12)); // -167ms >= -200ms
    expect(clampedPlan.dialoguePlan?.entries[0]!.startMs).toBe(33);
    expect(clampedPlan.actionPlan?.entries[0]!.nextStartMs).toBe(333);
    expect(clampedPlan.actionPlan?.motionSpanEntries[0]!.nextStartMs).toBe(333);

    // Reject mode still rejects genuinely out-of-range shift
    expect(() =>
      batchService.planCrossTypeShift(combined, {
        shotId: IDS.shot,
        dialogueIds: [DLG_1, DLG_2, DLG_3],
        eventIds: [EV_MOVE],
        layerMotionSpans: [spanRef],
        deltaMs: -500,
        boundaryMode: 'reject',
      }),
    ).toThrow(TimelineEventBatchError);

    // 5. Pure millisecond batch (NO LayerMotion spans) keeps exact millisecond precision!
    const pureMsPlan = batchService.planCrossTypeShift(combined, {
      shotId: IDS.shot,
      dialogueIds: [DLG_1, DLG_2, DLG_3],
      eventIds: [EV_MOVE],
      deltaMs: 100,
    });
    expect(pureMsPlan.deltaFrames).toBeUndefined();
    expect(pureMsPlan.frameSnapped).toBeUndefined();
    expect(pureMsPlan.deltaMs).toBe(100);
    expect(pureMsPlan.dialoguePlan?.entries[0]!.startMs).toBe(300);
    expect(pureMsPlan.actionPlan?.entries[0]!.nextStartMs).toBe(600);
  });
});
