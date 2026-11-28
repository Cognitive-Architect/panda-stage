import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  applyScriptPerformancePlan,
  createDraftRowIdGenerator,
  dialogueDraftSpeakerKey,
  isScriptPerformancePlanStale,
  planScriptPerformance,
  saveActionRecipe,
  type AudioAsset,
  type Character,
  type Project,
} from '../../src/domain';
import { IDS } from './domain/testProject';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';

const AUDIO_IDS = {
  a1: '14140000-0000-4000-8000-000000000001',
  a2: '14140000-0000-4000-8000-000000000002',
  a3: '14140000-0000-4000-8000-000000000003',
  a4: '14140000-0000-4000-8000-000000000004',
  a5: '14140000-0000-4000-8000-000000000005',
  a6: '14140000-0000-4000-8000-000000000006',
  a7: '14140000-0000-4000-8000-000000000007',
  a8: '14140000-0000-4000-8000-000000000008',
};

const CHAR2_ID = '14140000-0000-4000-8000-000000000101';
const CHAR2_EXPR_NORMAL = '14140000-0000-4000-8000-000000000102';
const CHAR2_EXPR_ANGRY = '14140000-0000-4000-8000-000000000103';
const CHAR2_VOICE_ID = '14140000-0000-4000-8000-000000000104';
const RECIPE_STEP_ID = '14140000-0000-4000-8000-000000000301';

function makeAudioAsset(
  id: string,
  name: string,
  durationMs: number,
): AudioAsset {
  return {
    id,
    kind: 'audio',
    name,
    relativePath: `assets/audio/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: id.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
    durationMs,
  };
}

function buildWf04Project(): Project {
  const base = characterActionGraphicFixture(false);
  const baseChar = base.characters[0]!;
  const char1: Character = {
    ...baseChar,
    name: '师兄',
  };

  const char2: Character = {
    id: CHAR2_ID,
    name: '小师妹',
    mode: 'single-image',
    baseAssetId: IDS.assetChar,
    defaultVoiceProfileId: CHAR2_VOICE_ID,
    defaultScale: 1,
    defaultFlipX: false,
    defaultExpressionId: CHAR2_EXPR_NORMAL,
    expressions: [
      {
        id: CHAR2_EXPR_NORMAL,
        name: '开心',
        assetId: IDS.assetChar,
      },
      {
        id: CHAR2_EXPR_ANGRY,
        name: '生气',
        assetId: IDS.assetChar2,
      },
    ],
  };

  const audioAssets: AudioAsset[] = [
    makeAudioAsset(AUDIO_IDS.a1, '1_师兄', 1_800),
    makeAudioAsset(AUDIO_IDS.a2, '2_小师妹', 2_400),
    makeAudioAsset(AUDIO_IDS.a3, '3_小师妹', 1_600),
    makeAudioAsset(AUDIO_IDS.a4, '4_师兄', 1_500),
    makeAudioAsset(AUDIO_IDS.a5, '5_师兄', 1_200),
    makeAudioAsset(AUDIO_IDS.a6, '6_小师妹', 1_200),
    makeAudioAsset(AUDIO_IDS.a7, '7_师兄', 1_200),
    makeAudioAsset(AUDIO_IDS.a8, '8_小师妹', 1_200),
  ];

  const withAssets = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...audioAssets],
    characters: [char1, char2],
    voiceProfiles: [
      ...base.voiceProfiles,
      {
        id: CHAR2_VOICE_ID,
        name: '小师妹配音',
        characterId: CHAR2_ID,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
  });

  return saveActionRecipe(withAssets, {
    name: '强调登场',
    steps: [
      {
        id: RECIPE_STEP_ID,
        kind: 'preset',
        presetId: 'scale-emphasis',
        offsetMs: 0,
        durationMs: 500,
        parameters: { scaleFactor: 1.25 },
      },
    ],
  });
}

function buildMotionRecipeProject(): Project {
  const base = buildWf04Project();
  const presetId = crypto.randomUUID();
  return saveActionRecipe(ProjectSchema.parse({
    ...base,
    assets: base.assets.map((asset) => asset.id === AUDIO_IDS.a1 ? { ...asset, durationMs: 800 } : asset),
    userMotionPresets: [{
      id: presetId, name: '长位移', durationFrames: 48,
      tracks: [{
        property: 'transform.offsetX',
        keys: [
          { frameOffset: 0, value: 0, interpolationToNext: 'linear' },
          { frameOffset: 48, value: 100, interpolationToNext: 'step' },
        ],
      }],
    }],
  }), {
    name: '移动配方',
    steps: [{ id: crypto.randomUUID(), kind: 'motion', presetId, offsetMs: 0 }],
  });
}

const MOTION_RECIPE_SCRIPT = [
  '镜头：运动配方', '时长：1500ms', '出场：师兄', '对白：',
  '师兄：第一句。', '表演：', '1｜配方｜移动配方',
].join('\n');

describe('WF-04 shared script & performance planner and applier', () => {
  it('extends a 1500ms shot only to a 48-frame recipe motion end and persists the same preview keys', () => {
    const project = buildMotionRecipeProject();
    const script = MOTION_RECIPE_SCRIPT;
    const bounded = planScriptPerformance(project, script);
    expect(bounded.performances[0]).toMatchObject({
      issueCode: 'OUT_OF_SHOT_BOUNDS', startMs: 0, endMs: 2_000, requiredShotDurationMs: 2_000,
    });
    expect(bounded.blocks[0]!.finalDurationMs).toBe(1_500);
    const plan = planScriptPerformance(project, script, { extendShotForPerformance: true });
    expect(plan.performances[0]).toMatchObject({ status: 'ready', startMs: 0, endMs: 2_000 });
    expect(plan.performances[0]!.motionKeyTimes?.length).toBeGreaterThan(0);
    const applied = applyScriptPerformancePlan(project, plan, { allowPartialConfirm: false });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.message);
    const shot = applied.project.shots.at(-1)!;
    expect(shot).toEqual(plan.candidateProject!.shots.at(-1));
    expect(shot.durationMs).toBe(2_000);
    expect(shot.layers[0]!.layerMotionTracks?.[0]?.keys.map((key) => key.timeMs)).toEqual([0, 2_000]);
  });

  it('reports actual offset and restore frames in motion-only and mixed recipes', () => {
    const project = buildMotionRecipeProject();
    const recipe = project.actionRecipes!.at(-1)!;
    const motion = { ...recipe.steps[0]!, offsetMs: 100 };
    const fade = {
      id: crypto.randomUUID(), kind: 'preset', presetId: 'fade-in',
      offsetMs: 300, durationMs: 500,
    } as const;
    const script = MOTION_RECIPE_SCRIPT.replace('1500ms', '3000ms') + '｜偏移=+60ms';
    for (const steps of [[motion], [motion, fade]]) {
      const library = saveActionRecipe(project, { name: recipe.name, steps }, recipe.id);
      const plan = planScriptPerformance(library, script);
      const shot = plan.candidateProject!.shots.at(-1)!;
      const layer = shot.layers[0]!;
      expect(shot.durationMs).toBe(3_000);
      // 160ms rounds to frame 4; the 48-frame segment ends at frame 52.
      expect(layer.layerMotionTracks?.[0]?.keys.map((key) => key.timeMs)).toEqual([0, 167, 2167, 2208]);
      expect(plan.performances[0]).toMatchObject({ status: 'ready', startMs: 167, endMs: 2208 });
      expect(shot.timelineEvents).toHaveLength(steps.length - 1);
    }

    const offsetRecipe = saveActionRecipe(project, {
      name: recipe.name, steps: [{ ...motion, offsetMs: 1_600 }],
    }, recipe.id);
    const late = planScriptPerformance(offsetRecipe, MOTION_RECIPE_SCRIPT + '｜偏移=+60ms', {
      extendShotForPerformance: true,
    });
    const shot = late.candidateProject!.shots.at(-1)!;
    expect(late.performances[0]).toMatchObject({ status: 'ready', startMs: 1667, endMs: 3667 });
    expect(shot.durationMs).toBe(3667);
    expect(shot.layers[0]!.layerMotionTracks?.[0]?.keys.map((key) => key.timeMs)).toEqual([0, 1667, 3667]);
  });

  it('skips bound-out motion, rejects missing or overlapping steps atomically, and catches preset changes', () => {
    const project = buildMotionRecipeProject();
    const recipe = project.actionRecipes!.at(-1)!;
    const motion = recipe.steps[0]!;
    const script = MOTION_RECIPE_SCRIPT + '\n1｜抖动｜时长=300ms';
    const plan = planScriptPerformance(project, script, { extendShotForPerformance: true });
    const preset = project.userMotionPresets![0]!;
    const updated = ProjectSchema.parse({
      ...project,
      userMotionPresets: [{
        ...preset,
        tracks: preset.tracks.map((track) => ({
          ...track, keys: track.keys.map((key, index) => index === 1 ? { ...key, value: 120 } : key),
        })),
      }],
    });
    expect(applyScriptPerformancePlan(updated, plan)).toMatchObject({ ok: false, errorCode: 'STALE_PLAN' });

    const skipped = planScriptPerformance(project, script, {
      overrides: { recipeBindingsByDirectiveId: { [plan.performances[0]!.directiveId]: { [motion.id]: null } } },
      extendShotForPerformance: true,
    });
    expect(skipped.performances[0]).toMatchObject({ status: 'ready', endMs: 0 });
    expect(skipped.blocks[0]!.finalDurationMs).toBe(1_500);
    expect(skipped.candidateProject!.shots.at(-1)!.layers[0]!.layerMotionTracks).toBeUndefined();
    expect(isScriptPerformancePlanStale(updated, skipped).stale).toBe(false);

    const conflict = saveActionRecipe(project, {
      name: recipe.name, steps: [motion, { ...motion, id: crypto.randomUUID(), offsetMs: 100 }],
    }, recipe.id);
    const missing = ProjectSchema.parse({ ...project, userMotionPresets: [] });
    for (const [input, message] of [[conflict, '重叠'], [missing, '找不到选择的运动预设']] as const) {
      const rejected = planScriptPerformance(input, script, { extendShotForPerformance: true });
      expect(rejected.performances[0]).toMatchObject({ issueCode: 'VALIDATION_FAILED', issueMessage: expect.stringContaining(message) });
      expect(rejected.performances[1]!.status).toBe('ready');
      expect(applyScriptPerformancePlan(input, rejected, { allowPartialConfirm: false }).ok).toBe(false);
      const result = applyScriptPerformancePlan(input, rejected, { allowPartialConfirm: true });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      const shot = result.project.shots.at(-1)!;
      expect(shot.durationMs).toBe(1_500);
      expect(shot.layers[0]!.layerMotionTracks).toBeUndefined();
      expect(shot.timelineEvents.map((event) => event.type)).toEqual(['shake']);
    }
  });

  it('U3 diagnoses recipe duration overrides and uses the authored range for extension and apply', () => {
    const project = saveActionRecipe(buildWf04Project(), {
      name: '长淡入',
      steps: [{
        id: crypto.randomUUID(), kind: 'preset', presetId: 'fade-in',
        offsetMs: 0, durationMs: 2_000, parameters: {},
      }],
    });
    const script = [
      '镜头：配方长度', '时长：1900ms', '出场：师兄',
      '对白：', '师兄：第一句。', '表演：',
      '1｜配方｜长淡入', '1｜抖动｜时长=300ms',
    ].join('\n');
    const overridden = planScriptPerformance(project, script.replace('｜长淡入', '｜长淡入｜时长=500ms'),
      { extendShotForPerformance: true });
    expect(overridden.performances[0]).toMatchObject({
      status: 'issue', issueCode: 'RECIPE_DURATION_OVERRIDE_UNSUPPORTED',
      startMs: 0, endMs: 2_000, eventIds: [],
    });
    expect(overridden.blocks[0]).toMatchObject({ finalDurationMs: 1900, extendedForPerformance: false });
    expect(overridden.readyPerformanceCount).toBe(1);
    expect(applyScriptPerformancePlan(project, overridden, { allowPartialConfirm: false }).ok).toBe(false);
    const partial = applyScriptPerformancePlan(project, overridden, { allowPartialConfirm: true });
    expect(partial.ok).toBe(true);
    if (!partial.ok) throw new Error('Could not apply the valid subset');
    expect(partial.project.shots.at(-1)!.timelineEvents.map((event) => event.type)).toEqual(['shake']);

    const bounded = planScriptPerformance(project, script);
    expect(bounded.performances[0]).toMatchObject({ issueCode: 'OUT_OF_SHOT_BOUNDS', requiredShotDurationMs: 2_000 });
    const extended = planScriptPerformance(project, script, { extendShotForPerformance: true });
    expect(extended.performances[0]).toMatchObject({ status: 'ready', startMs: 0, endMs: 2_000 });
    const applied = applyScriptPerformancePlan(project, extended);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('Could not apply the authored recipe');
    const shot = applied.project.shots.at(-1)!;
    expect(shot).toEqual(extended.candidateProject!.shots.at(-1));
    expect(shot.durationMs).toBe(2_000);
    expect(shot.timelineEvents.find((event) => event.type === 'opacity')).toMatchObject({ startMs: 0, endMs: 2_000 });
  });

  it('plans and applies 2 shots with 4 real-audio lines, auto-extending shot without clipping, and >=3 editable actions in one commit', () => {
    const project = buildWf04Project();
    const script = [
      '镜头：宗门大厅',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '师兄：听我解释。',
      '小师妹：你又偷懒了！',
      '表演：',
      '1｜抖动',
      '2｜表情｜生气',
      '---',
      '镜头：花园',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '小师妹：快去修炼。',
      '师兄：知道了。',
      '表演：',
      '3｜淡入',
      '4｜移动｜x=1260｜y=760',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.applicableBlockCount).toBe(2);
    expect(plan.scheduledDialogueCount).toBe(4);
    expect(plan.readyPerformanceCount).toBe(4);
    expect(plan.issuePerformanceCount).toBe(0);
    expect(plan.hasIssues).toBe(false);

    // Shot 1 total real audio = 1800 + 2400 = 4200ms > default 3000ms -> extended cleanly!
    expect(plan.blocks[0]!.extendedForAudio).toBe(true);
    expect(plan.blocks[0]!.finalDurationMs).toBe(4_200);
    // Shot 2 total real audio = 1600 + 1500 = 3100ms > default 3000ms -> extended cleanly!
    expect(plan.blocks[1]!.extendedForAudio).toBe(true);
    expect(plan.blocks[1]!.finalDurationMs).toBe(3_100);

    // Dialogue ordinal -> draftRowId -> formal Dialogue.id mapping
    for (const perf of plan.performances) {
      expect(perf.status).toBe('ready');
      expect(perf.draftRowId).toBeTruthy();
      expect(perf.dialogueId).toBe(plan.dialogueIdByDraftRowId[perf.draftRowId!]);
      expect(perf.eventIds.length).toBeGreaterThanOrEqual(1);
    }

    const applied = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: false,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    // Input project was never mutated
    expect(project.shots).toHaveLength(1);

    const shot1 = applied.project.shots.find((s) => s.name === '宗门大厅')!;
    const shot2 = applied.project.shots.find((s) => s.name === '花园')!;
    expect(shot1.durationMs).toBe(4_200);
    expect(shot1.dialogues).toHaveLength(2);
    expect(shot1.audioClips).toHaveLength(2);
    expect(shot1.dialogues[0]).toMatchObject({ startMs: 0, endMs: 1_800 });
    expect(shot1.dialogues[1]).toMatchObject({ startMs: 1_800, endMs: 4_200 });
    expect(shot1.timelineEvents.map((e) => e.type)).toEqual(['shake', 'expression']);

    expect(shot2.durationMs).toBe(3_100);
    expect(shot2.dialogues).toHaveLength(2);
    expect(shot2.audioClips).toHaveLength(2);
    expect(shot2.timelineEvents.map((e) => e.type)).toEqual(['opacity', 'move']);
    const moveEvt = shot2.timelineEvents.find((e) => e.type === 'move');
    expect(moveEvt?.type === 'move' && moveEvt.to).toEqual({ x: 1260, y: 760 });
  });

  it('supports all 8 basic performance directives plus official CharacterActionEvent and ActionRecipe', () => {
    const project = buildWf04Project();
    const script = [
      '镜头：全动作验证一',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '师兄：第一句。',
      '小师妹：第二句。',
      '小师妹：第三句。',
      '师兄：第四句。',
      '表演：',
      '1｜左入场',
      '1｜角色动作｜挥手',
      '2｜右入场',
      '2｜配方｜强调登场',
      '3｜淡入',
      '4｜淡出',
      '---',
      '镜头：全动作验证二',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '师兄：第五句。',
      '小师妹：第六句。',
      '师兄：第七句。',
      '小师妹：第八句。',
      '表演：',
      '5｜移动｜x=900｜y=640',
      '6｜放大｜1.4',
      '7｜抖动',
      '8｜表情｜生气',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.hasIssues).toBe(false);
    expect(plan.scheduledDialogueCount).toBe(8);
    expect(plan.readyPerformanceCount).toBe(10);

    const shot1 = plan.candidateProject!.shots.find((s) => s.name === '全动作验证一')!;
    const shot2 = plan.candidateProject!.shots.find((s) => s.name === '全动作验证二')!;

    expect(shot1.timelineEvents.map((e) => e.type)).toEqual([
      'move',
      'character-action',
      'move',
      'scale',
      'opacity',
      'opacity',
    ]);
    expect(shot2.timelineEvents.map((e) => e.type)).toEqual([
      'move',
      'scale',
      'shake',
      'expression',
    ]);
  });

  it('preserves stable draftRowId across dialogue edits/inserts and supports anchor offset/end timing', () => {
    const project = buildWf04Project();
    const initialScript = [
      '镜头：锚点测试',
      '出场：师兄、小师妹',
      '对白：',
      '师兄：听我解释。',
      '小师妹：你又偷懒了！',
      '表演：',
      '1｜抖动｜偏移=+200ms｜时长=400ms',
      '2｜淡出｜锚点=结尾｜偏移=-300ms｜时长=300ms',
    ].join('\n');

    const firstPlan = planScriptPerformance(project, initialScript);
    expect(firstPlan.hasIssues).toBe(false);
    expect(firstPlan.performances[0]).toMatchObject({ startMs: 200, endMs: 600 });
    expect(firstPlan.performances[1]).toMatchObject({ startMs: 3_900, endMs: 4_200 });

    const originalRow1Id = firstPlan.dialogues[0]!.draftRowId;
    const originalRow2Id = firstPlan.dialogues[1]!.draftRowId;

    // Insert a new line before row 2 and re-plan with previousDialogueRows
    const editedScript = [
      '镜头：锚点测试',
      '出场：师兄、小师妹',
      '对白：',
      '师兄：听我解释。',
      '师兄：新增的一句。',
      '小师妹：你又偷懒了！',
      '表演：',
      '1｜抖动',
    ].join('\n');

    const secondPlan = planScriptPerformance(project, editedScript, {
      previousDialogueRows: firstPlan.dialogueDraftRows,
    });
    expect(secondPlan.dialogues[0]!.draftRowId).toBe(originalRow1Id);
    expect(secondPlan.dialogues[2]!.draftRowId).toBe(originalRow2Id);
    expect(secondPlan.dialogues[1]!.draftRowId).not.toBe(originalRow1Id);
    expect(secondPlan.dialogues[1]!.draftRowId).not.toBe(originalRow2Id);
  });

  it('reports row-level feedback for missing actions, same-property conflicts, and shot-bounds overflow while allowing valid subset confirmation', () => {
    const project = buildWf04Project();
    const script = [
      '镜头：冲突与反馈',
      '背景：背景',
      '出场：师兄、小师妹',
      '站位：双人对话',
      '对白：',
      '师兄：第一句。',
      '小师妹：第二句。',
      '表演：',
      '1｜左入场',
      '1｜抖动',
      '1｜瞬移',
      '2｜表情｜不存在的表情',
      '2｜淡出｜锚点=结尾｜时长=500ms',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.hasIssues).toBe(true);
    expect(plan.readyPerformanceCount).toBe(1); // 1｜左入场 succeeds
    expect(plan.issuePerformanceCount).toBe(4);

    // 1｜抖动 conflicts on `position` with 1｜左入场
    expect(plan.performances[1]).toMatchObject({
      status: 'issue',
      issueCode: 'PROPERTY_CONFLICT',
    });
    // 1｜瞬移 is unknown action
    expect(plan.performances[2]).toMatchObject({
      status: 'issue',
      issueCode: 'PARSE_ISSUE',
    });
    // 2｜表情｜不存在的表情
    expect(plan.performances[3]).toMatchObject({
      status: 'issue',
      issueCode: 'EXPRESSION_NOT_FOUND',
    });
    // 2｜淡出 at endMs (4200..4700) overflows 4200ms shot
    expect(plan.performances[4]).toMatchObject({
      status: 'issue',
      issueCode: 'OUT_OF_SHOT_BOUNDS',
      requiredShotDurationMs: 4_700,
    });

    // Strict confirmation refuses without writing Project
    const refused = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: false,
    });
    expect(refused).toMatchObject({ ok: false, errorCode: 'HAS_ISSUES' });

    // Explicit partial confirmation commits valid subset
    const partial = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: true,
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      const shot = partial.project.shots.find((s) => s.name === '冲突与反馈')!;
      expect(shot.timelineEvents).toHaveLength(1);
      expect(shot.timelineEvents[0]!.type).toBe('move');
    }

    // Opting in to extendShotForPerformance resolves the overflow row cleanly
    const extendedPlan = planScriptPerformance(project, script, {
      extendShotForPerformance: true,
    });
    expect(extendedPlan.performances[4]).toMatchObject({
      status: 'ready',
      startMs: 4_200,
      endMs: 4_700,
    });
    expect(extendedPlan.blocks[0]!.finalDurationMs).toBe(4_700);
    expect(extendedPlan.blocks[0]!.extendedForPerformance).toBe(true);

    // Stale check detects audio deletion before apply
    const mutatedProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.filter((a) => a.id !== AUDIO_IDS.a1),
    });
    expect(isScriptPerformancePlanStale(mutatedProject, plan).stale).toBe(true);
    expect(applyScriptPerformancePlan(mutatedProject, plan)).toMatchObject({
      ok: false,
      errorCode: 'STALE_PLAN',
    });
  });

  it('R3: preserves deterministic audioAssetId and source ranges across same-speaker swap/insert, speaker change, manual swap/clear, and delete->add', () => {
    const base = buildWf04Project();
    // Give 师兄 two distinct numbered audio files: 1_师兄 (1800ms) and 2_师兄 (2200ms)
    const audio1 = makeAudioAsset(AUDIO_IDS.a1, '1_师兄', 1_800);
    const audio2 = makeAudioAsset(AUDIO_IDS.a2, '2_师兄', 2_200);
    const audioAlt = makeAudioAsset(AUDIO_IDS.a5, '5_师兄', 1_400);
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets.filter((a) => a.kind !== 'audio'),
        audio1,
        audio2,
        audioAlt,
      ],
    });

    const nextDraftId = createDraftRowIdGenerator();
    const initialScript = [
      '镜头：同角色对白',
      '背景：背景',
      '出场：师兄、小师妹',
      '对白：',
      '师兄：先说第一句。',
      '师兄：再说第二句。',
    ].join('\n');

    const plan1 = planScriptPerformance(project, initialScript, {
      createDraftRowId: nextDraftId,
    });
    const rowA = plan1.dialogues[0]!;
    const rowB = plan1.dialogues[1]!;
    expect(rowA.audioMatch?.audioAssetId).toBe(audio1.id);
    expect(rowB.audioMatch?.audioAssetId).toBe(audio2.id);

    // Apply explicit source range on rowA via manual override
    const plan1WithRange = planScriptPerformance(project, initialScript, {
      previousDialogueRows: plan1.dialogueDraftRows,
      createDraftRowId: nextDraftId,
      overrides: {
        audioByDraftRowId: {
          [rowA.draftRowId]: {
            audioAssetId: audio1.id,
            sourceStartMs: 200,
            sourceEndMs: 1_200,
            speakerKey: dialogueDraftSpeakerKey({
              speakerType: 'character',
              characterId: project.characters[0]!.id,
            }),
          },
        },
      },
    });
    expect(plan1WithRange.dialogues[0]).toMatchObject({
      startMs: 0,
      endMs: 1_000,
    });
    expect(plan1WithRange.dialogueDraftRows[0]).toMatchObject({
      draftRowId: rowA.draftRowId,
      confirmedAudioAssetId: audio1.id,
      sourceStartMs: 200,
      sourceEndMs: 1_200,
    });

    // Swap the two lines of the same character AND insert a new line at the top!
    const swappedAndInserted = [
      '镜头：同角色对白',
      '背景：背景',
      '出场：师兄、小师妹',
      '对白：',
      '师兄：新插入的台词。',
      '师兄：再说第二句。',
      '师兄：先说第一句。',
    ].join('\n');

    const plan2 = planScriptPerformance(project, swappedAndInserted, {
      previousDialogueRows: plan1WithRange.dialogueDraftRows,
      createDraftRowId: nextDraftId,
    });
    // Row 2 (再说第二句) kept audio2; Row 3 (先说第一句) kept audio1 + source range [200, 1200)!
    expect(plan2.dialogues[1]!.draftRowId).toBe(rowB.draftRowId);
    expect(plan2.dialogues[1]!.audioMatch?.audioAssetId).toBe(audio2.id);
    expect(plan2.dialogues[2]!.draftRowId).toBe(rowA.draftRowId);
    expect(plan2.dialogues[2]!.audioMatch?.audioAssetId).toBe(audio1.id);
    expect(plan2.dialogues[2]!.audioMatch?.sourceStartMs).toBe(200);
    expect(plan2.dialogues[2]!.audioMatch?.sourceEndMs).toBe(1_200);
    // Newly inserted line at ordinal 1 must NOT steal audio1 (`1_师兄`)!
    expect(plan2.dialogues[0]!.draftRowId).not.toBe(rowA.draftRowId);
    expect(plan2.dialogues[0]!.draftRowId).not.toBe(rowB.draftRowId);
    expect(plan2.dialogues[0]!.status).toBe('draft-unready');
    expect(plan2.dialogues[0]!.issueCode).toBe('AUDIO_AMBIGUOUS');

    // Manual audio swap onto a different asset resets old source range, and explicit clear drops binding
    const plan3 = planScriptPerformance(project, swappedAndInserted, {
      previousDialogueRows: plan2.dialogueDraftRows,
      createDraftRowId: nextDraftId,
      overrides: {
        audioByDraftRowId: {
          [rowA.draftRowId]: {
            audioAssetId: audioAlt.id,
            speakerKey: dialogueDraftSpeakerKey({
              speakerType: 'character',
              characterId: project.characters[0]!.id,
            }),
          },
          [rowB.draftRowId]: {
            audioAssetId: null,
            speakerKey: dialogueDraftSpeakerKey({
              speakerType: 'character',
              characterId: project.characters[0]!.id,
            }),
          },
        },
      },
    });
    expect(plan3.dialogues[2]!.audioMatch).toMatchObject({
      audioAssetId: audioAlt.id,
      sourceStartMs: 0,
      sourceEndMs: 1_400,
    });
    expect(plan3.dialogues[1]!.status).toBe('draft-unready');
    expect(plan3.dialogueDraftRows[1]!.confirmedAudioAssetId).toBeUndefined();

    // Changing speaker on an existing line must NOT inherit old character's audio or manual override
    const speakerChanged = [
      '镜头：同角色对白',
      '背景：背景',
      '出场：师兄、小师妹',
      '对白：',
      '小师妹：先说第一句。',
    ].join('\n');
    const plan4 = planScriptPerformance(project, speakerChanged, {
      previousDialogueRows: plan3.dialogueDraftRows,
      createDraftRowId: nextDraftId,
      overrides: {
        audioByDraftRowId: {
          [rowA.draftRowId]: {
            audioAssetId: audioAlt.id,
            speakerKey: dialogueDraftSpeakerKey({
              speakerType: 'character',
              characterId: project.characters[0]!.id,
            }),
          },
        },
      },
    });
    expect(plan4.dialogues[0]!.draftRowId).not.toBe(rowA.draftRowId);
    expect(plan4.dialogues[0]!.audioMatch?.audioAssetId).toBeNull();
  });

  it('stale-plan audit: detects same-ID ActionRecipe content edits and refuses bypassing allowPartialConfirm', () => {
    const project = buildWf04Project();
    const script = [
      '镜头：配方校验',
      '背景：背景',
      '出场：师兄、小师妹',
      '对白：',
      '师兄：第一句。',
      '小师妹：第二句。',
      '表演：',
      '2｜配方｜强调登场',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.hasIssues).toBe(false);
    expect(plan.readyPerformanceCount).toBe(1);

    // Mutate the SAME-ID recipe's step duration so it now overflows the 4200ms shot!
    const mutatedRecipeProject = ProjectSchema.parse({
      ...project,
      actionRecipes: (project.actionRecipes ?? []).map((recipe) => ({
        ...recipe,
        steps: recipe.steps.map((step) =>
          step.kind === 'preset' ? { ...step, durationMs: 5_000 } : step,
        ),
      })),
    });

    const stale = isScriptPerformancePlanStale(mutatedRecipeProject, plan);
    expect(stale.stale).toBe(true);
    const applied = applyScriptPerformancePlan(mutatedRecipeProject, plan, {
      allowPartialConfirm: false,
    });
    expect(applied).toMatchObject({ ok: false, errorCode: 'STALE_PLAN' });
  });

  it('applies one existing camera preset from the script and reports real camera key times', () => {
    const base = buildWf04Project();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        camera: { mode: 'manual' as const, keys: [] },
      })),
    });
    const script = [
      '镜头：运镜测试',
      '时长：3000ms',
      '出场：师兄',
      '对白：',
      '师兄：第一句。',
      '表演：',
      '1｜运镜｜预设=推近｜时长=600ms',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.performances[0]).toMatchObject({
      status: 'ready',
      property: 'camera',
      startMs: 0,
      // 600ms snaps to the 583ms frame boundary; the report follows the real key.
      endMs: 583,
      cameraPreset: 'push-in',
    });
    expect(plan.performances[0]!.cameraKeyTimes).toEqual([0, 583]);

    const applied = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: false,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.message);
    const shot = applied.project.shots.at(-1)!;
    expect(shot.camera?.mode).toBe('manual');
    expect(shot.camera?.keys.length).toBeGreaterThan(0);
    expect(shot.timelineEvents).toHaveLength(0);
  });

  it('reports the snapped camera keys for a non-frame-aligned anchor', () => {
    const base = buildWf04Project();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        camera: { mode: 'manual' as const, keys: [] },
      })),
    });
    const script = [
      '镜头：运镜测试',
      '时长：3000ms',
      '出场：师兄',
      '对白：',
      '师兄：第一句。',
      '表演：',
      '1｜运镜｜预设=推近｜时长=500ms｜偏移=100ms',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    expect(plan.performances[0]).toMatchObject({
      status: 'ready',
      property: 'camera',
      // 100ms snaps to 83ms on the 24fps grid; the un-snapped 600ms end is not
      // the real range end either.
      startMs: 83,
      endMs: 583,
    });
    expect(plan.performances[0]!.cameraKeyTimes).toEqual([83, 583]);

    const applied = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: false,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.message);
    const shot = applied.project.shots.at(-1)!;
    expect(
      [...(shot.camera?.keys ?? [])].map((key) => key.timeMs).sort((a, b) => a - b),
    ).toEqual([83, 583]);
  });

  it('refuses an overflowing camera directive without authorization and keeps the shot intact', () => {
    const base = buildWf04Project();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        camera: { mode: 'manual' as const, keys: [] },
      })),
    });
    const script = [
      '镜头：运镜测试',
      '时长：3000ms',
      '出场：师兄',
      '对白：',
      '师兄：第一句。',
      '表演：',
      '1｜运镜｜预设=推近｜时长=600ms｜偏移=2800ms',
    ].join('\n');

    const plan = planScriptPerformance(project, script);
    const row = plan.performances[0]!;
    expect(row.status).toBe('issue');
    expect(row.issueCode).toBe('OUT_OF_SHOT_BOUNDS');
    expect(row.requiredShotDurationMs).toBe(row.endMs);

    const applied = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: true,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.message);
    // Unauthorized overflow never grows the shot.
    expect(applied.project.shots.at(-1)!.durationMs).toBe(3_000);
    expect(applied.project.shots.at(-1)!.camera?.keys ?? []).toHaveLength(0);
  });

  it('extends the shot for an authorized camera directive using the real snapped range', () => {
    const base = buildWf04Project();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        camera: { mode: 'manual' as const, keys: [] },
      })),
    });
    const script = [
      '镜头：运镜测试',
      '时长：3000ms',
      '出场：师兄',
      '对白：',
      '师兄：第一句。',
      '表演：',
      '1｜运镜｜预设=推近｜时长=600ms｜偏移=2800ms',
    ].join('\n');

    const plan = planScriptPerformance({
      ...project,
    }, script, { extendShotForPerformance: true });
    const row = plan.performances[0]!;
    expect(row.status).toBe('ready');
    expect(row.requiredShotDurationMs).toBeGreaterThan(3_000);
    expect(row.requiredShotDurationMs).toBe(row.endMs);
    expect(row.cameraKeyTimes).toEqual([row.startMs, row.endMs]);

    const applied = applyScriptPerformancePlan(project, plan, {
      allowPartialConfirm: false,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.message);
    const shot = applied.project.shots.at(-1)!;
    // The extension equals the preset plan's real (snapped) end, not the raw
    // 3400ms request.
    expect(shot.durationMs).toBe(row.requiredShotDurationMs);
    expect(
      [...(shot.camera?.keys ?? [])].map((key) => key.timeMs).sort((a, b) => a - b),
    ).toEqual([row.startMs, row.endMs]);
  });

  it('reports an unsupported camera parameter locally without blocking other directives', () => {
    const base = buildWf04Project();
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        camera: { mode: 'manual' as const, keys: [] },
      })),
    });
    const script = [
      '镜头：运镜测试',
      '时长：3000ms',
      '出场：师兄',
      '对白：',
      '师兄：第一句。',
      '表演：',
      '1｜运镜｜乱写=1',
    ].join('\n');
    const plan = planScriptPerformance(project, script);
    expect(plan.performances[0]).toMatchObject({
      status: 'issue',
      issueCode: 'PARSE_ISSUE',
    });
  });
});
