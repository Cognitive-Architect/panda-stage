import { describe, expect, it } from 'vitest';
import {
  AutoSubtitleAudioError,
  AutoSubtitleAudioService,
  DialogueService,
  ProjectSchema,
  ShotService,
  buildFormalExportAudioMixPlan,
  evaluateSpeakerFocusCamera,
  integerFrameSpanMs,
  matchDialogueAudioRows,
  prepareSpeakerFocusCamera,
  reconcileDialogueDraftRows,
  selectMouthPoseGeneration,
  type AudioAsset,
  type Character,
  type DialogueAudioMatchRequest,
  type DialogueDraftRowSeed,
  type Project,
} from '../../src/domain';
import { buildProductPreviewCues } from '../../src/renderer/shell/productPreviewModel';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import { buildProject, IDS } from './domain/testProject';

const TIGER_ID = '20000000-0000-4000-8000-000000000099';
const TIGER_EXPR_ID = '20000000-0000-4000-8000-000000000098';
const TIGER_VOICE_ID = '30000000-0000-4000-8000-000000000099';
const TIGER_LAYER_ID = '60000000-0000-4000-8000-000000000099';
const PANDA_LAYER_ID = '60000000-0000-4000-8000-000000000098';
const POSE_REST_ID = '70000000-0000-4000-8000-000000000001';
const POSE_OPEN_ID = '70000000-0000-4000-8000-000000000002';

function makeAudioAsset(
  index: number,
  name: string,
  durationMs: number | undefined,
  options: { status?: 'ready' | 'error'; relativePath?: string } = {},
): AudioAsset {
  return {
    id: `10000000-0000-4000-8000-${String(700 + index).padStart(12, '0')}`,
    kind: 'audio',
    name,
    relativePath: options.relativePath ?? `assets/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: String(index % 10).repeat(64),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(options.status === 'error'
      ? {
          metadata: {
            status: 'error' as const,
            code: 'ASSET_METADATA_INVALID_AUDIO' as const,
            message: '音频无法读取',
          },
        }
      : options.status === 'ready'
        ? {
            metadata: {
              status: 'ready' as const,
              warnings: [],
            },
          }
        : {}),
  };
}

function buildTwoSpeakerProject(
  audioAssets: readonly AudioAsset[],
  shotDurationMs = 30_000,
): Project {
  const base = buildProject();
  const panda: Character = {
    ...base.characters[0]!,
    name: '熊猫',
    mouthPoseSet: {
      restPoseId: POSE_REST_ID,
      driveMode: 'mouth-poses',
      poses: [
        {
          id: POSE_REST_ID,
          name: '闭嘴',
          source: { kind: 'image', assetId: IDS.assetChar },
          target: { kind: 'face' },
        },
        {
          id: POSE_OPEN_ID,
          name: '张嘴',
          source: { kind: 'image', assetId: IDS.assetChar },
          target: { kind: 'face' },
        },
      ],
      analyzerMapping: {
        rest: POSE_REST_ID,
        closed: POSE_REST_ID,
        open: POSE_OPEN_ID,
        wide: POSE_OPEN_ID,
        round: POSE_OPEN_ID,
      },
    },
  };
  const tiger: Character = {
    id: TIGER_ID,
    name: '老虎',
    mode: 'single-image',
    baseAssetId: IDS.assetChar,
    defaultVoiceProfileId: TIGER_VOICE_ID,
    expressions: [
      { id: TIGER_EXPR_ID, name: '正常', assetId: IDS.assetChar },
    ],
    defaultExpressionId: TIGER_EXPR_ID,
    defaultScale: 1,
    defaultFlipX: false,
  };

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...audioAssets],
    characters: [panda, tiger],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        ...base.voiceProfiles[0]!,
        id: TIGER_VOICE_ID,
        characterId: TIGER_ID,
        name: '老虎默认音色',
      },
    ],
    shots: [
      {
        ...base.shots[0]!,
        durationMs: shotDurationMs,
        layers: [
          ...base.shots[0]!.layers.filter(
            (layer) => layer.id === base.shots[0]!.backgroundLayerId,
          ),
          {
            id: PANDA_LAYER_ID,
            name: '熊猫图层',
            source: {
              kind: 'character',
              characterId: panda.id,
              expressionId: panda.defaultExpressionId,
            },
            x: 420,
            y: 620,
            scaleX: 1,
            scaleY: 1,
            flipX: false,
            rotationDeg: 0,
            anchor: 'center',
            opacity: 1,
            zIndex: 1,
            visible: true,
            locked: false,
          },
          {
            id: TIGER_LAYER_ID,
            name: '老虎图层',
            source: {
              kind: 'character',
              characterId: tiger.id,
              expressionId: TIGER_EXPR_ID,
            },
            x: 1480,
            y: 620,
            scaleX: 1,
            scaleY: 1,
            flipX: false,
            rotationDeg: 0,
            anchor: 'center',
            opacity: 1,
            zIndex: 2,
            visible: true,
            locked: false,
          },
        ],
      },
    ],
  });
}

describe('WF-01 shared audio matching & real-duration timing planner', () => {
  it('matches and schedules 2 speakers + 10 lines + narration with exact real durations and downstream consumption', () => {
    const durations = [1800, 2410, 1600, 950, 2125, 1340, 1750, 890, 2200, 1435];
    const lineSpecs: Array<{
      speakerName: string;
      speakerType: 'character' | 'narrator';
      characterId?: string;
      text: string;
    }> = [
      { speakerName: '旁白', speakerType: 'narrator', text: '清晨的竹林格外安静。' },
      { speakerName: '熊猫', speakerType: 'character', characterId: IDS.character, text: '早安，今天去练功吗？' },
      { speakerName: '老虎', speakerType: 'character', characterId: TIGER_ID, text: '当然，我已经热身完了。' },
      { speakerName: '熊猫', speakerType: 'character', characterId: IDS.character, text: '等等我拿上竹杖。' },
      { speakerName: '旁白', speakerType: 'narrator', text: '两人沿着石阶走向演武场。' },
      { speakerName: '老虎', speakerType: 'character', characterId: TIGER_ID, text: '今天先练身法。' },
      { speakerName: '熊猫', speakerType: 'character', characterId: IDS.character, text: '没问题，看招！' },
      { speakerName: '老虎', speakerType: 'character', characterId: TIGER_ID, text: '好快的起手。' },
      { speakerName: '熊猫', speakerType: 'character', characterId: IDS.character, text: '这只是第一式。' },
      { speakerName: '旁白', speakerType: 'narrator', text: '竹叶随风落下，比试正式开始。' },
    ];

    const audioAssets = lineSpecs.map((spec, idx) =>
      makeAudioAsset(idx + 1, `${idx + 1}_${spec.speakerName}`, durations[idx]),
    );
    const project = buildTwoSpeakerProject(audioAssets, 30_000);

    const requests: DialogueAudioMatchRequest[] = lineSpecs.map((spec, idx) => ({
      draftRowId: `row-${idx + 1}`,
      ordinal: idx + 1,
      sourceLineNumber: idx + 1,
      text: spec.text,
      speakerType: spec.speakerType,
      ...(spec.characterId ? { characterId: spec.characterId } : {}),
      speakerName: spec.speakerName,
    }));

    const report = matchDialogueAudioRows(project, requests, { shotId: IDS.shot });
    expect(report.allReady).toBe(true);
    expect(report.readyCount).toBe(10);
    expect(report.draftCount).toBe(0);
    expect(report.totalDurationMs).toBe(durations.reduce((a, b) => a + b, 0));

    const service = new AutoSubtitleAudioService();
    const plan = service.plan(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: report.readyRows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs!,
        sourceEndMs: row.sourceEndMs!,
      })),
    });

    expect(plan.ready).toBe(true);
    expect(plan.needsShotExtension).toBe(false);
    expect(plan.totalDurationMs).toBe(16_500);
    expect(plan.rows[0]).toMatchObject({ startMs: 0, endMs: 1800, durationMs: 1800 });
    expect(plan.rows[1]).toMatchObject({ startMs: 1800, endMs: 4210, durationMs: 2410 });
    expect(plan.rows[9]).toMatchObject({ startMs: 15_065, endMs: 16_500, durationMs: 1435 });

    // Preview must never mutate project.
    expect(project.shots[0]!.dialogues).toHaveLength(0);
    expect(project.shots[0]!.audioClips).toHaveLength(0);

    const applied = service.apply(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: plan.rows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId,
        sourceStartMs: row.sourceStartMs,
        sourceEndMs: row.sourceEndMs,
      })),
    });

    expect(applied.dialogueIds).toHaveLength(10);
    expect(applied.audioClipIds).toHaveLength(10);
    const shot = applied.project.shots[0]!;
    expect(shot.dialogues).toHaveLength(10);
    expect(shot.audioClips).toHaveLength(10);

    // Every formal Dialogue and AudioClip matches preview exactly.
    plan.rows.forEach((plannedRow, idx) => {
      const dialogue = shot.dialogues[idx]!;
      const clip = shot.audioClips.find((c) => c.id === dialogue.audioClipId)!;
      expect(dialogue.startMs).toBe(plannedRow.startMs);
      expect(dialogue.endMs).toBe(plannedRow.endMs);
      expect(clip).toMatchObject({
        role: 'dialogue',
        assetId: plannedRow.audioAssetId,
        startMs: plannedRow.startMs,
        endMs: plannedRow.endMs,
        offsetMs: 0,
      });
    });

    // Narration line has speakerType: 'narrator' and no characterId.
    expect(shot.dialogues[0]!.speakerType).toBe('narrator');
    expect(shot.dialogues[0]!.characterId).toBeUndefined();

    // Downstream consumption: subtitles, export audio mix, speaker focus camera, and mouth pose generation.
    const cues = buildProductPreviewCues(shot);
    expect(evaluateSubtitleAtTime(cues, 2_000)?.text).toBe('早安，今天去练功吗？');
    expect(evaluateSubtitleAtTime(cues, 500)?.text).toBe('清晨的竹林格外安静。');

    const exportPlan = buildFormalExportAudioMixPlan(
      shot.durationMs,
      shot.audioClips.map((clip) => ({
        clipId: clip.id,
        assetId: clip.assetId,
        role: clip.role,
        sourcePath: `D:/project/${audioAssets.find((a) => a.id === clip.assetId)!.relativePath}`,
        startMs: clip.startMs,
        endMs: clip.endMs,
        offsetMs: clip.offsetMs,
        volume: clip.volume,
      })),
    );
    expect(exportPlan.clips).toHaveLength(10);
    expect(exportPlan.clips[1]).toMatchObject({
      startMs: 1800,
      endMs: 4210,
      sourceOffsetMs: 0,
    });

    const cameraPlan = prepareSpeakerFocusCamera(applied.project, shot);
    const pandaCamera = evaluateSpeakerFocusCamera(cameraPlan, 2_500);
    const tigerCamera = evaluateSpeakerFocusCamera(cameraPlan, 5_000);
    expect(pandaCamera.centerX).toBeLessThan(tigerCamera.centerX);

    const pandaDialogue = shot.dialogues[1]!;
    const mouthSelection = selectMouthPoseGeneration(applied.project, {
      shotId: shot.id,
      layerId: PANDA_LAYER_ID,
      dialogueId: pandaDialogue.id,
      startMs: pandaDialogue.startMs,
      endMs: pandaDialogue.endMs,
    });
    expect(mouthSelection.audio).toEqual({
      startMs: pandaDialogue.startMs,
      endMs: pandaDialogue.endMs,
    });
    expect(mouthSelection.sourceStartMs).toBe(0);
  });

  it('preserves stable draft-row identity and confirmed bindings across inserts and reorders, and enforces priority order', () => {
    const audio1 = makeAudioAsset(1, '1_熊猫', 1200);
    const audio2 = makeAudioAsset(2, '2_老虎', 1500);
    const audio3 = makeAudioAsset(3, '3_熊猫', 1100);
    const audioExisting = makeAudioAsset(4, 'existing_custom', 900);
    let project = buildTwoSpeakerProject([audio1, audio2, audio3, audioExisting]);

    // Create an existing formal dialogue bound to audioExisting.
    const dialogues = new DialogueService();
    const existingRes = dialogues.createManyTimedWithAudio(project, {
      shotId: IDS.shot,
      lines: [
        {
          characterId: IDS.character,
          text: '已有句',
          startMs: 5000,
          endMs: 5900,
          audioAssetId: audioExisting.id,
        },
      ],
    });
    project = existingRes.project;
    const existingDialogueId = existingRes.dialogueIds[0]!;

    const initialSeeds: DialogueDraftRowSeed[] = [
      {
        sourceLineNumber: 1,
        text: '第一句',
        speakerType: 'character',
        characterId: IDS.character,
        speakerName: '熊猫',
        confirmedAudioAssetId: audio1.id,
      },
      {
        sourceLineNumber: 2,
        text: '第二句',
        speakerType: 'character',
        characterId: TIGER_ID,
        speakerName: '老虎',
        confirmedAudioAssetId: audio2.id,
      },
    ];
    const stable1 = reconcileDialogueDraftRows([], initialSeeds);
    expect(stable1.map((r) => r.draftRowId)).toEqual(['draft-row-1', 'draft-row-2']);

    // Insert a new line at top and swap the two existing lines.
    const reorderedSeeds: DialogueDraftRowSeed[] = [
      {
        sourceLineNumber: 1,
        text: '新插入的开场',
        speakerType: 'narrator',
        speakerName: '旁白',
      },
      {
        sourceLineNumber: 2,
        text: '第二句',
        speakerType: 'character',
        characterId: TIGER_ID,
        speakerName: '老虎',
      },
      {
        sourceLineNumber: 3,
        text: '第一句',
        speakerType: 'character',
        characterId: IDS.character,
        speakerName: '熊猫',
      },
    ];
    const stable2 = reconcileDialogueDraftRows(stable1, reorderedSeeds);
    expect(stable2[0]!.draftRowId).toBe('draft-row-3');
    expect(stable2[0]!.confirmedAudioAssetId).toBeUndefined();
    expect(stable2[1]!.draftRowId).toBe('draft-row-2');
    expect(stable2[1]!.confirmedAudioAssetId).toBe(audio2.id);
    expect(stable2[2]!.draftRowId).toBe('draft-row-1');
    expect(stable2[2]!.confirmedAudioAssetId).toBe(audio1.id);

    // Priority verification: existingDialogueId > confirmedAudioAssetId > unique ordinal_speaker > manual override.
    const priorityReport = matchDialogueAudioRows(
      project,
      [
        {
          draftRowId: 'p-existing',
          ordinal: 1,
          sourceLineNumber: 1,
          text: '已有句',
          speakerType: 'character',
          characterId: IDS.character,
          speakerName: '熊猫',
          existingDialogueId,
          confirmedAudioAssetId: audio3.id,
        },
        {
          draftRowId: 'p-confirmed',
          ordinal: 2,
          sourceLineNumber: 2,
          text: '已确认句',
          speakerType: 'character',
          characterId: TIGER_ID,
          speakerName: '老虎',
          confirmedAudioAssetId: audio3.id,
        },
        {
          draftRowId: 'p-manual-reuse',
          ordinal: 3,
          sourceLineNumber: 3,
          text: '手动复用同一音频',
          speakerType: 'character',
          characterId: IDS.character,
          speakerName: '熊猫',
          manualAudioAssetId: audio3.id,
        },
      ],
      { shotId: IDS.shot },
    );

    expect(priorityReport.rows[0]).toMatchObject({
      matchSource: 'existing-dialogue',
      audioAssetId: audioExisting.id,
      ready: true,
    });
    expect(priorityReport.rows[1]).toMatchObject({
      matchSource: 'confirmed',
      audioAssetId: audio3.id,
      ready: true,
    });
    // Explicit manual reuse of audio3 is allowed.
    expect(priorityReport.rows[2]).toMatchObject({
      matchSource: 'manual',
      audioAssetId: audio3.id,
      ready: true,
    });
  });

  it('flags ambiguity, role mismatch, and unready audio as draft while allowing valid subset commit', () => {
    const dupe1a = makeAudioAsset(1, '1_熊猫', 1000, { relativePath: 'assets/1_a.wav' });
    const dupe1b = makeAudioAsset(2, '1_熊猫', 1100, { relativePath: 'assets/1_b.wav' });
    const mismatch2 = makeAudioAsset(3, '2_老虎', 1200);
    const ready3 = makeAudioAsset(4, '3_熊猫', 1400);
    const pending4 = makeAudioAsset(5, '4_旁白', undefined);
    const error5 = makeAudioAsset(6, '5_老虎', 900, { status: 'error' });

    const project = buildTwoSpeakerProject([
      dupe1a,
      dupe1b,
      mismatch2,
      ready3,
      pending4,
      error5,
    ]);

    const report = matchDialogueAudioRows(
      project,
      [
        { draftRowId: 'r1', ordinal: 1, sourceLineNumber: 1, text: '歧义句', speakerType: 'character', characterId: IDS.character, speakerName: '熊猫' },
        { draftRowId: 'r2', ordinal: 2, sourceLineNumber: 2, text: '串名句', speakerType: 'character', characterId: IDS.character, speakerName: '熊猫' },
        { draftRowId: 'r3', ordinal: 3, sourceLineNumber: 3, text: '有效句', speakerType: 'character', characterId: IDS.character, speakerName: '熊猫' },
        { draftRowId: 'r4', ordinal: 4, sourceLineNumber: 4, text: '未就绪句', speakerType: 'narrator', speakerName: '旁白' },
        { draftRowId: 'r5', ordinal: 5, sourceLineNumber: 5, text: '损坏句', speakerType: 'character', characterId: TIGER_ID, speakerName: '老虎' },
      ],
      { shotId: IDS.shot },
    );

    expect(report.rows[0]!.issue).toBe('AUDIO_AMBIGUOUS');
    expect(report.rows[0]!.ambiguousCandidates).toHaveLength(2);
    expect(report.rows[1]!.issue).toBe('AUDIO_ROLE_MISMATCH');
    expect(report.rows[2]!.ready).toBe(true);
    expect(report.rows[3]!.issue).toBe('AUDIO_PENDING');
    expect(report.rows[4]!.issue).toBe('AUDIO_ERROR');

    expect(report.readyCount).toBe(1);
    expect(report.draftCount).toBe(4);
    expect(report.hasCommitableSubset).toBe(true);

    // Committing only the ready subset succeeds cleanly.
    const service = new AutoSubtitleAudioService();
    const applied = service.apply(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: report.readyRows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs!,
        sourceEndMs: row.sourceEndMs!,
      })),
    });
    expect(applied.project.shots[0]!.dialogues).toHaveLength(1);
    expect(applied.project.shots[0]!.dialogues[0]!.text).toBe('有效句');
  });

  it('preserves explicit source offset and ultra-short 1-frame audio without placeholder auto-extension', () => {
    const oneFrameMs = integerFrameSpanMs();
    const longAudio = makeAudioAsset(1, '1_熊猫', 4_000);
    const project = buildTwoSpeakerProject([longAudio]);
    const service = new AutoSubtitleAudioService();

    const applied = service.apply(project, {
      shotId: IDS.shot,
      startMs: 100,
      rows: [
        {
          draftRowId: 'short-1',
          sourceLineNumber: 1,
          text: '嗯',
          speakerType: 'character',
          characterId: IDS.character,
          audioAssetId: longAudio.id,
          sourceStartMs: 500,
          sourceEndMs: 500 + oneFrameMs,
        },
        {
          draftRowId: 'slice-2',
          sourceLineNumber: 2,
          text: '继续说下去',
          speakerType: 'character',
          characterId: IDS.character,
          audioAssetId: longAudio.id,
          sourceStartMs: 1_250,
          sourceEndMs: 2_750,
        },
      ],
    });

    const shot = applied.project.shots[0]!;
    expect(shot.dialogues[0]).toMatchObject({
      startMs: 100,
      endMs: 100 + oneFrameMs,
    });
    expect(shot.audioClips[0]).toMatchObject({
      startMs: 100,
      endMs: 100 + oneFrameMs,
      offsetMs: 500,
    });
    expect(shot.dialogues[1]).toMatchObject({
      startMs: 100 + oneFrameMs,
      endMs: 100 + oneFrameMs + 1_500,
    });
    expect(shot.audioClips[1]).toMatchObject({
      startMs: 100 + oneFrameMs,
      endMs: 100 + oneFrameMs + 1_500,
      offsetMs: 1_250,
    });
  });

  it('reports existing subtitle overlaps and enforces explicit shot extension confirmation', () => {
    const a1 = makeAudioAsset(1, '1_熊猫', 2_000);
    const a2 = makeAudioAsset(2, '2_老虎', 2_500);
    let project = buildTwoSpeakerProject([a1, a2], 3_000);
    const service = new AutoSubtitleAudioService();

    // Shot is 3000ms, batch needs 4500ms -> requires explicit confirmation.
    const rows = [
      {
        draftRowId: 'r1',
        sourceLineNumber: 1,
        text: '第一句',
        speakerType: 'character' as const,
        characterId: IDS.character,
        audioAssetId: a1.id,
      },
      {
        draftRowId: 'r2',
        sourceLineNumber: 2,
        text: '第二句',
        speakerType: 'character' as const,
        characterId: TIGER_ID,
        audioAssetId: a2.id,
      },
    ];
    const plan = service.plan(project, { shotId: IDS.shot, startMs: 0, rows });
    expect(plan.ready).toBe(true);
    expect(plan.needsShotExtension).toBe(true);
    expect(plan.extensionToMs).toBe(4_500);

    expect(() =>
      service.apply(project, { shotId: IDS.shot, startMs: 0, rows }),
    ).toThrow(AutoSubtitleAudioError);
    expect(() =>
      service.apply(project, {
        shotId: IDS.shot,
        startMs: 0,
        rows,
        extendShotToMs: 4_000,
      }),
    ).toThrow(/重新确认/);

    const extended = service.apply(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows,
      extendShotToMs: 4_500,
    });
    expect(extended.previousShotDurationMs).toBe(3_000);
    expect(extended.nextShotDurationMs).toBe(4_500);
    expect(extended.project.shots[0]!.durationMs).toBe(4_500);

    // Overlap check against existing timed dialogue at [1000, 2000).
    const dialogues = new DialogueService();
    project = dialogues.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '已存在字幕',
      pointTimeMs: 1_000,
    });
    const existingId = project.shots[0]!.dialogues[0]!.id;
    project = dialogues.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: existingId,
      startMs: 1_000,
      endMs: 2_000,
    });

    const overlapPlan = service.plan(project, { shotId: IDS.shot, startMs: 500, rows });
    expect(overlapPlan.ready).toBe(false);
    expect(overlapPlan.blockers[0]).toMatchObject({
      code: 'DIALOGUE_OVERLAP',
      sourceLineNumber: 1,
      conflictDialogueId: existingId,
      conflictRangeMs: { startMs: 1_000, endMs: 2_000 },
    });
  });

  it('supports WF-04 multi-scene global ordinal matching and per-shot atomic scheduling', () => {
    const assets = [
      makeAudioAsset(1, '1_熊猫', 1_200),
      makeAudioAsset(2, '2_老虎', 1_800),
      makeAudioAsset(3, '3_老虎', 1_500),
      makeAudioAsset(4, '4_旁白', 2_100),
    ];
    let project = buildTwoSpeakerProject(assets, 5_000);
    project = new ShotService().create(project, { name: '镜头 2', durationMs: 3_000 });
    const shot1Id = project.shots[0]!.id;
    const shot2Id = project.shots[1]!.id;

    // Global script match across 2 scenes (WF-04 reuse path).
    const globalMatch = matchDialogueAudioRows(project, [
      { draftRowId: 's1-1', ordinal: 1, sourceLineNumber: 1, text: '镜头一甲', speakerType: 'character', characterId: IDS.character, speakerName: '熊猫' },
      { draftRowId: 's1-2', ordinal: 2, sourceLineNumber: 2, text: '镜头一乙', speakerType: 'character', characterId: TIGER_ID, speakerName: '老虎' },
      { draftRowId: 's2-1', ordinal: 3, sourceLineNumber: 3, text: '镜头二甲', speakerType: 'character', characterId: TIGER_ID, speakerName: '老虎' },
      { draftRowId: 's2-2', ordinal: 4, sourceLineNumber: 4, text: '镜头二旁白', speakerType: 'narrator', speakerName: '旁白' },
    ]);
    expect(globalMatch.allReady).toBe(true);

    const service = new AutoSubtitleAudioService();
    const afterShot1 = service.apply(project, {
      shotId: shot1Id,
      startMs: 0,
      rows: globalMatch.readyRows.slice(0, 2).map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs!,
        sourceEndMs: row.sourceEndMs!,
      })),
    });

    const shot2Plan = service.plan(afterShot1.project, {
      shotId: shot2Id,
      startMs: 0,
      rows: globalMatch.readyRows.slice(2, 4).map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs!,
        sourceEndMs: row.sourceEndMs!,
      })),
    });
    expect(shot2Plan.needsShotExtension).toBe(true);
    expect(shot2Plan.extensionToMs).toBe(3_600);

    const afterShot2 = service.apply(afterShot1.project, {
      shotId: shot2Id,
      startMs: 0,
      rows: shot2Plan.rows.map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        audioAssetId: row.audioAssetId,
        sourceStartMs: row.sourceStartMs,
        sourceEndMs: row.sourceEndMs,
      })),
      extendShotToMs: 3_600,
    });

    expect(afterShot2.project.shots[0]!.dialogues).toHaveLength(2);
    expect(afterShot2.project.shots[1]!.dialogues).toHaveLength(2);
    expect(afterShot2.project.shots[1]!.durationMs).toBe(3_600);
    expect(afterShot2.project.shots[1]!.dialogues[1]).toMatchObject({
      speakerType: 'narrator',
      startMs: 1_500,
      endMs: 3_600,
    });
  });
});
