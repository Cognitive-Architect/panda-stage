import { describe, expect, it } from 'vitest';
import {
  MultiSceneDialogueService,
  MultiScenePerformanceService,
  ProjectSchema,
  TimelineEventSchema,
  parseMultiSceneInput,
  type MultiSceneDialoguePlan,
  type MultiSceneDialoguePlanRow,
  type Project,
} from '../../src/domain';
import {
  PERFORMANCE_THREE_BLOCKS,
  PERFORMANCE_TWO_BLOCKS,
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

function oneDirective(...lines: string[]): string {
  return [
    '镜头：花园相遇',
    '背景：花园',
    '出场：张三、李四',
    '站位：双人对话',
    '对白：',
    '张三：你好。',
    '李四：好久不见。',
    '表演：',
    ...lines,
    '---',
    '镜头：宗门大厅',
    '背景：宗门大厅',
    '出场：张三、大长老',
    '站位：双人对话',
    '对白：',
    '大长老：你可知错？',
    '张三：弟子知错。',
  ].join('\n');
}

let cachedBasePlan: MultiSceneDialoguePlan | null = null;

/** One stable AUTO-05 result: Shot/Layer ids are random on every plan(). */
function basePlan(): MultiSceneDialoguePlan {
  if (cachedBasePlan) return cachedBasePlan;
  const outcome = new MultiSceneDialogueService().plan(
    buildPerformanceProject(),
    parseMultiSceneInput(PERFORMANCE_TWO_BLOCKS),
    [],
  );
  if (!outcome.ok) throw new Error(outcome.message);
  cachedBasePlan = outcome.plan;
  return cachedBasePlan;
}

interface PlanOverrides {
  readonly candidateProject?: Project;
  readonly rows?: readonly MultiSceneDialoguePlanRow[];
}

/** Inject a controlled AUTO-05 result so mapping edges can be isolated. */
function planWith(raw: string, overrides: PlanOverrides = {}) {
  const base = basePlan();
  const candidateProject = overrides.candidateProject ?? base.candidateProject;
  const dialogue = {
    ...base.dialogue,
    rows: overrides.rows ?? base.dialogue.rows,
  };
  const dialogueService = {
    plan: () => ({
      ok: true,
      plan: { ...base, candidateProject, dialogue },
    }),
  } as unknown as MultiSceneDialogueService;
  const service = new MultiScenePerformanceService({
    dialogueService,
    createEventId: sequentialEventIds(),
  });
  return {
    candidateProject,
    outcome: service.plan(
      candidateProject,
      parseMultiSceneInput(raw),
      [],
    ),
  };
}

function editShot(
  project: Project,
  shotId: string,
  edit: (shot: Project['shots'][number]) => Project['shots'][number],
): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId ? edit(shot) : shot,
    ),
  });
}

const FIRST_ROW = (): MultiSceneDialoguePlanRow =>
  basePlan().dialogue.rows[0]!;

describe('AUTO-06 target Layer and expression resolution', () => {
  it('refuses the whole batch when 0 or 2 Character Layers match', () => {
    const row = FIRST_ROW();
    const base = basePlan();
    const shot = base.candidateProject.shots.find(
      (entry) => entry.id === row.shotId,
    )!;
    const target = shot.layers.find(
      (layer) =>
        layer.source.kind === 'character' &&
        layer.source.characterId === row.characterId,
    )!;

    const none = editShot(base.candidateProject, shot.id, (entry) => ({
      ...entry,
      layers: entry.layers.filter((layer) => layer.id !== target.id),
    }));
    const zero = planWith(oneDirective('1｜抖动'), {
      candidateProject: none,
    });
    expect(zero.outcome.ok).toBe(false);
    expect(zero.outcome.ok ? '' : zero.outcome.code).toBe(
      'PERFORMANCE_TARGET_UNRESOLVED',
    );

    const duplicate = editShot(base.candidateProject, shot.id, (entry) => ({
      ...entry,
      layers: [
        ...entry.layers,
        {
          ...target,
          id: 'b0000000-0000-4000-8000-000000000099',
          name: '重复的张三图层',
        },
      ],
    }));
    const two = planWith(oneDirective('1｜抖动'), {
      candidateProject: duplicate,
    });
    expect(two.outcome.ok).toBe(false);
    expect(two.outcome.ok ? '' : two.outcome.code).toBe(
      'PERFORMANCE_TARGET_UNRESOLVED',
    );
    expect(two.outcome.ok ? '' : two.outcome.message).toContain('2 个');
  });

  it('refuses a locked target Layer', () => {
    const row = FIRST_ROW();
    const base = basePlan();
    const locked = editShot(base.candidateProject, row.shotId, (shot) => ({
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.source.kind === 'character' &&
        layer.source.characterId === row.characterId
          ? { ...layer, locked: true }
          : layer,
      ),
    }));
    const outcome = planWith(oneDirective('1｜抖动'), {
      candidateProject: locked,
    }).outcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('PERFORMANCE_LAYER_LOCKED');
  });

  it('refuses ambiguous expressions, and never borrows another Character id', () => {
    const row = FIRST_ROW();
    const base = basePlan();
    // A valid ProjectSchema already rejects duplicate expression names; this
    // dirty fixture exercises the planner's defensive exact-name guard.
    const ambiguous = {
      ...base.candidateProject,
      characters: base.candidateProject.characters.map((character) =>
        character.id === row.characterId &&
        character.mode !== 'adaptive-parts'
          ? {
              ...character,
              expressions: [
                ...character.expressions,
                {
                  id: 'b0000000-0000-4000-8000-000000000098',
                  name: '生气',
                  assetId: character.baseAssetId,
                },
              ],
            }
          : character,
      ),
    } as unknown as Project;
    const outcome = planWith(oneDirective('1｜表情｜生气'), {
      candidateProject: ambiguous,
    }).outcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe(
      'PERFORMANCE_EXPRESSION_UNRESOLVED',
    );
    expect(outcome.ok ? '' : outcome.message).toContain('2 个');
  });

  it('refuses expression directives on adaptive-parts Characters', () => {
    const row = FIRST_ROW();
    const base = basePlan();
    const adaptive = {
      ...base.candidateProject,
      characters: base.candidateProject.characters.map((character) =>
        character.id === row.characterId
          ? { ...character, mode: 'adaptive-parts' }
          : character,
      ),
    } as unknown as Project;
    const outcome = planWith(oneDirective('1｜表情｜生气'), {
      candidateProject: adaptive,
    }).outcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe(
      'PERFORMANCE_EXPRESSION_UNRESOLVED',
    );
    expect(outcome.ok ? '' : outcome.message).toContain('adaptive-parts');
  });

  it('refuses an event that would end past the Shot without clamping or extending', () => {
    const base = basePlan();
    const shifted = base.dialogue.rows.map((row) =>
      row.ordinal === 1 ? { ...row, startMs: 2600 } : row,
    );
    const outcome = planWith(oneDirective('1｜淡入'), {
      rows: shifted,
    }).outcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('PERFORMANCE_OUT_OF_SHOT');
    expect(outcome.ok ? '' : outcome.message).toContain('3400ms');
  });
});

describe('AUTO-06 formal overlap refusal', () => {
  it('keeps an existing TimelineEvent and refuses the whole batch', () => {
    const row = FIRST_ROW();
    const base = basePlan();
    const shot = base.candidateProject.shots.find(
      (entry) => entry.id === row.shotId,
    )!;
    const layer = shot.layers.find(
      (entry) =>
        entry.source.kind === 'character' &&
        entry.source.characterId === row.characterId,
    )!;
    const existing = TimelineEventSchema.parse({
      id: 'b0000000-0000-4000-8000-000000000001',
      type: 'move',
      layerId: layer.id,
      startMs: 0,
      endMs: 800,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      easing: 'ease-in-out',
    });
    const candidateProject = editShot(base.candidateProject, shot.id, (
      entry,
    ) => ({ ...entry, timelineEvents: [...entry.timelineEvents, existing] }));

    const before = JSON.stringify(candidateProject);
    const outcome = planWith(oneDirective('1｜抖动'), {
      candidateProject,
    }).outcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('PERFORMANCE_CONFLICT');
    const message = outcome.ok ? '' : outcome.message;
    expect(message).toContain('花园相遇');
    expect(message).toContain('第 1 句');
    expect(message).toContain('张三');
    expect(message).toContain('位置');
    expect(message).toContain('保留原动作');
    // "保留已有动作，整批不提交": the input candidate is never mutated.
    expect(JSON.stringify(candidateProject)).toBe(before);
  });

  it('refuses move+move, move+shake and fade+fade on the same Layer', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['1｜移动｜x=100｜y=100', '1｜移动｜x=200｜y=200'],
      ['1｜抖动', '1｜右入场'],
      ['1｜淡入', '1｜淡出'],
    ];
    for (const [first, second] of cases) {
      const outcome = planWith(oneDirective(first, second)).outcome;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.code).toBe('PERFORMANCE_CONFLICT');
    }
  });

  it('allows position + expression on one ordinal (different properties)', () => {
    const outcome = planWith(oneDirective('1｜抖动', '1｜表情｜生气'))
      .outcome;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.performance.rows.map((row) => row.property)).toEqual([
      'position',
      'expression',
    ]);
  });

  it('a conflict in the third Shot prevents the first two Shots from landing', () => {
    const raw = PERFORMANCE_THREE_BLOCKS.replace(
      '5｜淡出\n6｜左入场',
      '5｜抖动\n5｜移动｜x=100｜y=100\n6｜左入场',
    );
    const project = buildPerformanceProject();
    const before = JSON.stringify(project);
    const outcome = new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }).plan(project, parseMultiSceneInput(raw), []);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.code).toBe('PERFORMANCE_CONFLICT');
    expect(outcome.ok ? '' : outcome.message).toContain('山门');
    expect(JSON.stringify(project)).toBe(before);
    // No partial plan is returned: 0 formal Shots / Layers / Events.
    expect('plan' in outcome).toBe(false);
  });
});
