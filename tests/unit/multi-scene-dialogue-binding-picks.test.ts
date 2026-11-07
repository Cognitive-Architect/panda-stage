import { describe, expect, it } from 'vitest';
import {
  MultiSceneDialogueService,
  canonicalCharacterName,
  parseMultiSceneInput,
  resolveAudioMatches,
  type Project,
} from '../../src/domain';
import {
  EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
  checkApplied,
  speakerPicked,
  submissionBatch,
  type MultiSceneDialogueBatch,
} from '../../src/renderer/features/shots/multiSceneDialoguePanelModel';
import type { MultiSceneDialoguePreview } from '../../src/renderer/features/shots/multiSceneDialoguePlan';
import { prepareMultiSceneDialoguePreview } from '../../src/renderer/features/shots/multiSceneDialoguePlan';
import { ShotService } from '../../src/domain/services';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  AUDIO_DURATIONS,
  AUDIO_IDS,
  AUTO05_IDS,
  TWO_BLOCKS,
  audioAsset,
  buildDialogueProject,
  defaultAudioAssets,
} from '../helpers/multiSceneDialogueFixture';

const blocks = parseMultiSceneInput(TWO_BLOCKS);
const PREVIEW = { identity: {}, plan: {} } as unknown as MultiSceneDialoguePreview;

/** 张三 speaks ordinals 1 and 4; 大长老 (other speaker) owns ordinal 3. */
function stateWithPicks(
  overrides: Partial<MultiSceneDialogueBatch> = {},
) {
  return checkApplied(TWO_BLOCKS, {
    ...EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
    blocks,
    speakerBindings: {
      张三: AUTO05_IDS.charZhang,
      李四: AUTO05_IDS.charLi,
      大长老: AUTO05_IDS.charElder,
    },
    audioSelections: {
      1: AUDIO_IDS[0]!,
      4: AUDIO_IDS[3]!,
      3: AUDIO_IDS[2]!,
    },
    preview: PREVIEW,
    ...overrides,
  });
}

/** Re-run the panel's audio resolution path with the post-pick bindings. */
function recomputeAudio(
  project: Project,
  picked: ReturnType<typeof stateWithPicks>,
) {
  return resolveAudioMatches(
    project,
    blocks.flatMap((block) =>
      block.dialogues.map((line) => ({
        ordinal: line.ordinal,
        characterName:
          canonicalCharacterName(
            project,
            picked.batch.speakerBindings[line.speaker] ?? '',
          ) ?? '',
      })),
    ),
    picked.batch.audioSelections,
  );
}

/** 001 / 004 now belong to the new role, so auto-match can re-bind them. */
function rebindableAudio(): Project {
  const audio = defaultAudioAssets().map((asset, index) => {
    if (index === 0) {
      return audioAsset(AUDIO_IDS[0]!, '001_大长老.wav', AUDIO_DURATIONS[0]!);
    }
    if (index === 3) {
      return audioAsset(AUDIO_IDS[3]!, '004_大长老.wav', AUDIO_DURATIONS[3]!);
    }
    return asset;
  });
  return buildDialogueProject(audio);
}

describe('AUTO-05 FIX-B: a changed binding invalidates that speaker audio picks', () => {
  it('drops every manual pick of the changed speaker and keeps the others', () => {
    const picked = speakerPicked(
      stateWithPicks(),
      '张三',
      AUTO05_IDS.charElder,
    );

    expect(picked.batch.speakerBindings['张三']).toBe(AUTO05_IDS.charElder);
    expect(picked.batch.audioSelections).toEqual({ 3: AUDIO_IDS[2] });
  });

  it('keeps the old preview unsubmittable after a binding change', () => {
    const picked = speakerPicked(
      stateWithPicks(),
      '张三',
      AUTO05_IDS.charElder,
    );

    expect(picked.batch.preview).toBeNull();
    expect(submissionBatch(picked)).toBeNull();
  });

  it('does not touch rawInput or checkedInput', () => {
    const picked = speakerPicked(
      stateWithPicks(),
      '张三',
      AUTO05_IDS.charElder,
    );

    expect(picked.rawInput).toBe(TWO_BLOCKS);
    expect(picked.checkedInput).toBe(TWO_BLOCKS);
  });

  it('re-matches the cleared ordinals automatically under the new role', () => {
    const picked = speakerPicked(
      stateWithPicks(),
      '张三',
      AUTO05_IDS.charElder,
    );
    const report = recomputeAudio(rebindableAudio(), picked);

    expect(report.ready).toBe(true);
    for (const ordinal of [1, 4]) {
      const row = report.rows.find((candidate) => candidate.ordinal === ordinal)!;
      expect(row.automatic).toBe(true);
      expect(row.issue).toBeNull();
      expect(row.asset?.id).toBe(AUDIO_IDS[ordinal - 1]);
    }
    // The untouched speaker keeps its manual pick.
    expect(report.rows.find((row) => row.ordinal === 3)!.automatic).toBe(false);
  });

  it('asks for a new manual pick when the new role has no auto match', () => {
    const picked = speakerPicked(
      stateWithPicks(),
      '张三',
      AUTO05_IDS.charElder,
    );
    const report = recomputeAudio(buildDialogueProject(), picked);

    expect(report.ready).toBe(false);
    for (const ordinal of [1, 4]) {
      const row = report.rows.find((candidate) => candidate.ordinal === ordinal)!;
      expect(row.asset).toBeNull();
      expect(row.issue).toBe('AUDIO_ROLE_MISMATCH');
    }
  });

  it('never writes revision or History while invalidating picks', () => {
    const editorStore = new EditorProjectStore();
    const shotStore = new ShotStore(editorStore, new ShotService());
    editorStore.open('D:\\auto05-binding-picks.pandastage', buildDialogueProject());
    const prepared = prepareMultiSceneDialoguePreview(blocks, [], {
      editorStore,
      shotStore,
      service: new MultiSceneDialogueService(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const state = stateWithPicks({ preview: prepared.preview });
    const picked = speakerPicked(state, '张三', AUTO05_IDS.charElder);

    expect(submissionBatch(picked)).toBeNull();
    expect(editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(editorStore.history.getSnapshot().undoCount).toBe(0);
  });
});
