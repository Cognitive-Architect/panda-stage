import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  TimelineEventBatchError,
  TimelineEventBatchService,
  type AudioAsset,
  type AudioClip,
  type Dialogue,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const CLIP_SHARED = '81000000-0000-4000-8000-000000000301';
const ASSET_SHARED = '10000000-0000-4000-8000-000000000301';
const DLG_STAY = '82000000-0000-4000-8000-000000000301';
const DLG_MOVE = '82000000-0000-4000-8000-000000000302';

function buildSharedClipProject(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const asset: AudioAsset = {
    id: ASSET_SHARED,
    kind: 'audio',
    name: 'shared-line',
    relativePath: 'assets/shared-line.wav',
    mimeType: 'audio/wav',
    durationMs: 4_000,
    sha256: 'b'.repeat(64),
  };
  const clip: AudioClip = {
    id: CLIP_SHARED,
    role: 'dialogue',
    name: 'shared-line',
    assetId: ASSET_SHARED,
    startMs: 200,
    endMs: 2_200,
    offsetMs: 100,
    volume: 0.9,
  };
  const dialogue = (
    id: string,
    startMs: number,
    endMs: number,
    text: string,
  ): Dialogue => ({
    id,
    characterId: IDS.character,
    voiceProfileId: IDS.voiceProfile,
    subtitleStyleId: IDS.subtitle,
    startMs,
    endMs,
    text,
    audioClipId: CLIP_SHARED,
  });

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, asset],
    shots: [
      {
        ...shot,
        durationMs: 5_000,
        audioClips: [clip],
        dialogues: [
          dialogue(DLG_STAY, 200, 1_200, '插入点之前的共享配音'),
          dialogue(DLG_MOVE, 2_000, 3_000, '插入点之后的共享配音'),
        ],
        timelineEvents: [],
      },
    ],
  });
}

describe('WF-EXT FIX B3: shared voice clip preview (P3-02)', () => {
  it('splits by default and reports the same plan the apply produces', () => {
    const service = new TimelineEventBatchService();
    const project = buildSharedClipProject();
    const input = {
      shotId: IDS.shot,
      atMs: 1_500,
      durationMs: 400,
      sharedClipPolicy: 'split' as const,
    };

    const plan = service.planInsertGap(project, input);
    const dialoguePlan = plan.crossTypePlan?.dialoguePlan;
    expect(dialoguePlan).not.toBeNull();
    expect(dialoguePlan!.splitAudioClipIds).toEqual([CLIP_SHARED]);
    expect(dialoguePlan!.includedDialogueIds).toEqual([]);
    expect(plan.skipped).toHaveLength(0);

    const applied = service.applyInsertGap(project, input);
    const shot = applied.shots[0]!;
    const stay = shot.dialogues.find((item) => item.id === DLG_STAY)!;
    const moved = shot.dialogues.find((item) => item.id === DLG_MOVE)!;

    // Untouched, unselected dialogue keeps its own position and clip.
    expect([stay.startMs, stay.endMs, stay.audioClipId]).toEqual([
      200, 1_200, CLIP_SHARED,
    ]);
    // The moving dialogue gets a physical copy instead of dragging the original.
    expect([moved.startMs, moved.endMs]).toEqual([2_400, 3_400]);
    expect(moved.audioClipId).toBeDefined();
    expect(moved.audioClipId).not.toBe(CLIP_SHARED);
    const copy = shot.audioClips.find((clip) => clip.id === moved.audioClipId)!;
    expect([copy.startMs, copy.endMs]).toEqual([600, 2_600]);

    // Preview entries match the committed positions exactly.
    const planEntry = dialoguePlan!.entries.find(
      (entry) => entry.dialogueId === DLG_MOVE,
    )!;
    expect([planEntry.startMs, planEntry.endMs]).toEqual([
      moved.startMs,
      moved.endMs,
    ]);
  });

  it('refuses to silently drag a pre-insert shared dialogue when policy is include', () => {
    const service = new TimelineEventBatchService();
    const project = buildSharedClipProject();

    expect(() =>
      service.planInsertGap(project, {
        shotId: IDS.shot,
        atMs: 1_500,
        durationMs: 400,
        sharedClipPolicy: 'include',
      }),
    ).toThrow(TimelineEventBatchError);
  });

  it('moves a fully selected shared clip once without splitting it', () => {
    const service = new TimelineEventBatchService();
    const base = buildSharedClipProject();
    // Both dialogues sit after the insert point, so the whole clip group moves.
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...base.shots[0]!,
          dialogues: [
            {
              id: DLG_STAY,
              characterId: IDS.character,
              voiceProfileId: IDS.voiceProfile,
              subtitleStyleId: IDS.subtitle,
              startMs: 2_000,
              endMs: 2_600,
              text: '插入点之后的同段配音',
              audioClipId: CLIP_SHARED,
            },
            base.shots[0]!.dialogues.find((item) => item.id === DLG_MOVE)!,
          ],
        },
      ],
    });

    const plan = service.planInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_500,
      durationMs: 400,
      sharedClipPolicy: 'include',
    });
    const dialoguePlan = plan.crossTypePlan?.dialoguePlan;
    expect(dialoguePlan!.includedDialogueIds).toEqual([]);
    expect(dialoguePlan!.splitAudioClipIds).toEqual([]);

    const applied = service.applyInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_500,
      durationMs: 400,
      sharedClipPolicy: 'include',
    });
    const shot = applied.shots[0]!;
    const stay = shot.dialogues.find((item) => item.id === DLG_STAY)!;
    const moved = shot.dialogues.find((item) => item.id === DLG_MOVE)!;
    expect([stay.startMs, stay.endMs]).toEqual([2_400, 3_000]);
    expect([moved.startMs, moved.endMs]).toEqual([2_400, 3_400]);
    expect(stay.audioClipId).toBe(CLIP_SHARED);
    expect(moved.audioClipId).toBe(CLIP_SHARED);
    // The shared clip moved once instead of being duplicated.
    expect(shot.audioClips.filter((clip) => clip.id === CLIP_SHARED)).toHaveLength(1);
    expect(shot.audioClips).toHaveLength(1);
  });
});
