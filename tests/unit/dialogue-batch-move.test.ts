import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  DialogueServiceError,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type AudioClip,
  type Dialogue,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const AUDIO_A = '10000000-0000-4000-8000-000000000201';
const AUDIO_B = '10000000-0000-4000-8000-000000000202';
const CLIP_A = '90000000-0000-4000-8000-000000000001';
const CLIP_B = '90000000-0000-4000-8000-000000000002';
const CLIP_SHARED = '90000000-0000-4000-8000-000000000003';
const D_ZHANG = '70000000-0000-4000-8000-000000000001';
const D_LI = '70000000-0000-4000-8000-000000000002';
const D_ELDER = '70000000-0000-4000-8000-000000000003';
const D_OTHER = '70000000-0000-4000-8000-000000000004';
const D_UNTIMED = '70000000-0000-4000-8000-000000000005';
const SHOT_DURATION_MS = 10_000;

function audioAsset(id: string, name: string, durationMs = 5_000) {
  return {
    id,
    kind: 'audio' as const,
    name,
    relativePath: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: 'b'.repeat(64),
    durationMs,
  };
}

function dialogue(
  id: string,
  startMs: number,
  endMs: number,
  audioClipId?: string,
): Dialogue {
  return {
    id,
    characterId: IDS.character,
    voiceProfileId: IDS.voiceProfile,
    subtitleStyleId: IDS.subtitle,
    startMs,
    endMs,
    text: `对白 ${startMs}`,
    ...(audioClipId ? { audioClipId } : {}),
  };
}

/**
 * Three timed 对白: 张三 1.0–2.0s with voice, 李四 2.5–3.2s with voice,
 * 长老 4.0–5.0s without voice; plus one unselected 对白 at 6.0–7.0s.
 */
function fixture(options: {
  readonly sharedClip?: boolean;
  readonly untimedSelected?: boolean;
} = {}): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const dialogues: Dialogue[] = [
    dialogue(D_ZHANG, 1_000, 2_000, CLIP_A),
    dialogue(D_LI, 2_500, 3_200, CLIP_B),
    dialogue(D_ELDER, 4_000, 5_000),
    dialogue(D_OTHER, 6_000, 7_000),
  ];
  if (options.untimedSelected) {
    dialogues.push(dialogue(D_UNTIMED, 5_200, 5_200));
  }
  const sharedDialogue = options.sharedClip
    ? dialogue(D_OTHER, 6_000, 7_000, CLIP_A)
    : null;
  const audioClips: AudioClip[] = [
    {
      id: CLIP_A,
      role: 'dialogue',
      name: '张三配音',
      assetId: AUDIO_A,
      startMs: 1_000,
      endMs: 1_800,
      offsetMs: 0,
      volume: 0.8,
    },
    {
      id: CLIP_B,
      role: 'dialogue',
      name: '李四配音',
      assetId: AUDIO_B,
      startMs: 2_500,
      endMs: 3_100,
      offsetMs: 120,
      volume: 1,
    },
  ];
  if (options.sharedClip) {
    audioClips.push({
      id: CLIP_SHARED,
      role: 'bgm',
      name: '背景音乐',
      assetId: AUDIO_A,
      startMs: 0,
      endMs: 4_000,
      offsetMs: 0,
      volume: 0.4,
    });
  }
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [...base.assets, audioAsset(AUDIO_A, '张三音'), audioAsset(AUDIO_B, '李四音')],
    shots: [
      {
        ...shot,
        durationMs: SHOT_DURATION_MS,
        dialogues: sharedDialogue
          ? dialogues.map((candidate) =>
              candidate.id === D_OTHER ? sharedDialogue : candidate,
            )
          : dialogues,
        audioClips,
      },
    ],
  });
}

function service(): DialogueService {
  let counter = 0;
  return new DialogueService({
    createId: () => `c1000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-07T10:00:00.000Z'),
  });
}

function shotOf(project: Project) {
  return project.shots[0]!;
}

function dialoguesById(project: Project): Map<string, Dialogue> {
  return new Map(shotOf(project).dialogues.map((item) => [item.id, item]));
}

const THREE = [D_ZHANG, D_LI, D_ELDER];

describe('AUTO-02 V0 batch dialogue move domain', () => {
  it('shifts three dialogues by +500ms while keeping durations and spacing', () => {
    const project = fixture();
    const next = service().moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: THREE,
      deltaMs: 500,
    });
    const after = dialoguesById(next);

    expect(after.get(D_ZHANG)).toMatchObject({ startMs: 1_500, endMs: 2_500 });
    expect(after.get(D_LI)).toMatchObject({ startMs: 3_000, endMs: 3_700 });
    expect(after.get(D_ELDER)).toMatchObject({ startMs: 4_500, endMs: 5_500 });
    for (const id of THREE) {
      const before = dialoguesById(project).get(id)!;
      const moved = after.get(id)!;
      expect(moved.endMs - moved.startMs).toBe(before.endMs - before.startMs);
      expect(moved.startMs - before.startMs).toBe(500);
    }
    // Spacing inside the group is untouched.
    expect(after.get(D_LI)!.startMs - after.get(D_ZHANG)!.startMs).toBe(
      1_500,
    );
  });

  it('moves every bound voice clip by the same delta without touching its shape', () => {
    const project = fixture();
    const next = service().moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: THREE,
      deltaMs: 500,
    });
    const clips = new Map(
      shotOf(next).audioClips.map((clip) => [clip.id, clip]),
    );

    expect(clips.get(CLIP_A)).toMatchObject({
      startMs: 1_500,
      endMs: 2_300,
      offsetMs: 0,
      volume: 0.8,
      assetId: AUDIO_A,
    });
    expect(clips.get(CLIP_B)).toMatchObject({
      startMs: 3_000,
      endMs: 3_600,
      offsetMs: 120,
      volume: 1,
      assetId: AUDIO_B,
    });
    expect(clips.get(CLIP_A)!.endMs - clips.get(CLIP_A)!.startMs).toBe(800);
    // The voice-less Dialogue still moves.
    expect(dialoguesById(next).get(D_ELDER)).toMatchObject({
      startMs: 4_500,
      endMs: 5_500,
    });
  });

  it('leaves every unselected Dialogue, BGM clip and TimelineEvent untouched', () => {
    const project = fixture({ sharedClip: true });
    const next = service().moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: THREE,
      deltaMs: -500,
    });
    const before = dialoguesById(project);
    const after = dialoguesById(next);

    expect(after.get(D_OTHER)).toEqual(before.get(D_OTHER));
    const bgm = shotOf(next).audioClips.find((clip) => clip.id === CLIP_SHARED)!;
    expect(bgm).toMatchObject({ startMs: 0, endMs: 4_000, volume: 0.4 });
    expect(shotOf(next).timelineEvents).toEqual(shotOf(project).timelineEvents);
  });

  it('rejects the whole batch when a candidate would overlap an unselected Dialogue', () => {
    const project = fixture();
    expect(() =>
      service().moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: [D_ZHANG, D_LI],
        deltaMs: 1_500,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'DIALOGUE_OVERLAP' }),
    );
    expect(dialoguesById(project).get(D_LI)).toMatchObject({
      startMs: 2_500,
      endMs: 3_200,
    });
  });

  it('refuses to move past the shot start instead of clamping one row', () => {
    const project = fixture();
    const call = () =>
      service().moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: THREE,
        deltaMs: -1_500,
      });

    expect(call).toThrowError(
      expect.objectContaining({ code: 'DIALOGUE_BATCH_OUT_OF_RANGE' }),
    );
    expect(call).toThrowError(/再向前移动 1.5 秒会超出镜头开头/u);
    // Zero side effects: the original Project is untouched.
    expect(shotOf(project).dialogues).toHaveLength(4);
    expect(dialoguesById(project).get(D_ZHANG)).toMatchObject({
      startMs: 1_000,
      endMs: 2_000,
    });
  });

  it('refuses to move past the shot end', () => {
    const project = fixture();
    const call = () =>
      service().moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: [D_ELDER, D_ZHANG],
        deltaMs: 5_100,
      });

    expect(call).toThrowError(
      expect.objectContaining({ code: 'DIALOGUE_BATCH_OUT_OF_RANGE' }),
    );
    expect(call).toThrowError(/再向后移动 5\.1 秒会超出镜头结尾/u);
  });

  it('rejects an untimed Dialogue and a single-item selection', () => {
    const project = fixture({ untimedSelected: true });
    expect(() =>
      service().moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: [D_ZHANG, D_UNTIMED],
        deltaMs: 100,
      }),
    ).toThrowError(expect.objectContaining({ code: 'DIALOGUE_NOT_TIMED' }));
    expect(() =>
      service().moveMany(project, {
        shotId: IDS.shot,
        dialogueIds: [D_ZHANG],
        deltaMs: 100,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'DIALOGUE_BATCH_TOO_SMALL' }),
    );
  });

  it('is a no-op at a zero delta and never invents a revision', () => {
    const project = fixture();
    const next = service().moveMany(project, {
      shotId: IDS.shot,
      dialogueIds: THREE,
      deltaMs: 0,
    });

    expect(next).toBe(project);
  });

  it('copies a legacy shared clip so an unselected Dialogue keeps its own voice', () => {
    // D_ZHANG and D_OTHER share CLIP_A; only D_ZHANG is in the batch.
    const project = fixture();
    const shared = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shotOf(project),
          dialogues: shotOf(project).dialogues.map((candidate) =>
            candidate.id === D_OTHER
              ? { ...candidate, audioClipId: CLIP_A }
              : candidate,
          ),
        },
      ],
    });
    const next = service().moveMany(shared, {
      shotId: IDS.shot,
      dialogueIds: [D_ZHANG, D_LI],
      deltaMs: 500,
    });

    const original = shotOf(next).audioClips.find((clip) => clip.id === CLIP_A)!;
    // The untouched legacy clip keeps its timing…
    expect(original).toMatchObject({ startMs: 1_000, endMs: 1_800 });
    // …and the moved Dialogue references a fresh copy at the new time.
    const zhang = dialoguesById(next).get(D_ZHANG)!;
    const other = dialoguesById(next).get(D_OTHER)!;
    expect(other.audioClipId).toBe(CLIP_A);
    expect(zhang.audioClipId).not.toBe(CLIP_A);
    const copy = shotOf(next).audioClips.find(
      (clip) => clip.id === zhang.audioClipId,
    )!;
    expect(copy).toMatchObject({
      startMs: 1_500,
      endMs: 2_300,
      offsetMs: 0,
      volume: 0.8,
      assetId: AUDIO_A,
    });
  });

  it('describes the candidate plan without writing the Project', () => {
    const project = fixture();
    const before = JSON.stringify(project);
    const plan = service().planMoveMany(project, {
      shotId: IDS.shot,
      dialogueIds: THREE,
      deltaMs: 500,
    });

    expect(plan.entries).toHaveLength(3);
    expect(plan.audioClipCount).toBe(2);
    expect(plan.earliestStartMs).toBe(1_500);
    expect(plan.latestEndMs).toBe(5_500);
    expect(plan.entries.map((entry) => entry.dialogueId)).toEqual(THREE);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('surfaces the same error codes through the store-facing service surface', () => {
    const project = fixture();
    const error = (() => {
      try {
        service().moveMany(project, {
          shotId: IDS.shot,
          dialogueIds: THREE,
          deltaMs: -1_500,
        });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(DialogueServiceError);
  });
});
