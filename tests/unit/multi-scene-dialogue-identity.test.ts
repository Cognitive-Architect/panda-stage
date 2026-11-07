import { describe, expect, it } from 'vitest';
import {
  MultiSceneDialogueService,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { prepareMultiSceneDialoguePreview } from '../../src/renderer/features/shots/multiSceneDialoguePlan';
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

/** Two distinct script labels, neither of which is an exact Character name. */
const ALIAS_BLOCKS = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：师兄、少侠',
  '站位：双人对话',
  '对白：',
  '师兄：你怎么来了？',
  '少侠：我来找你。',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：师兄、少侠',
  '站位：双人对话',
  '对白：',
  '少侠：你可知错？',
  '师兄：弟子知错。',
].join('\n');

/** Block 1 is valid; block 2 is the conflict, so the error must point at 2. */
const CONFLICT_IN_SECOND_BLOCK = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：师兄、少侠',
  '站位：双人对话',
  '对白：',
  '师兄：你怎么来了？',
  '少侠：我来找你。',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
  '对白：',
  '大长老：你可知错？',
  '张三：弟子知错。',
].join('\n');

/** 003 belongs to 李四 in the alias script, not the fixture's 大长老. */
function aliasAudioProject(): Project {
  const audio = defaultAudioAssets().map((asset, index) =>
    index === 2
      ? audioAsset(AUDIO_IDS[2]!, '003_李四.wav', AUDIO_DURATIONS[2]!)
      : asset,
  );
  return buildDialogueProject(audio);
}

const distinctBindings = {
  师兄: AUTO05_IDS.charZhang,
  少侠: AUTO05_IDS.charLi,
};

function harness(project: Project = buildDialogueProject()) {
  const editorStore = new EditorProjectStore();
  const shotStore = new ShotStore(editorStore, new ShotService());
  editorStore.open('D:\\auto05-identity.pandastage', project);
  return { editorStore, shotStore };
}

describe('AUTO-05 FIX-A: bound cast identity must differ within one Shot', () => {
  it('plans the whole batch when two labels bind to two different Characters', () => {
    const outcome = new MultiSceneDialogueService({
      speakerBindings: distinctBindings,
    }).plan(aliasAudioProject(), parseMultiSceneInput(ALIAS_BLOCKS));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.createdShotIds).toHaveLength(2);
    expect(outcome.plan.dialogue.rows.map((row) => row.characterId)).toEqual([
      AUTO05_IDS.charZhang,
      AUTO05_IDS.charLi,
      AUTO05_IDS.charLi,
      AUTO05_IDS.charZhang,
    ]);
  });

  it('refuses the whole batch when one Shot has two labels bound to the same id', () => {
    const outcome = new MultiSceneDialogueService({
      speakerBindings: {
        师兄: AUTO05_IDS.charZhang,
        少侠: AUTO05_IDS.charZhang,
      },
    }).plan(aliasAudioProject(), parseMultiSceneInput(ALIAS_BLOCKS));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('SPEAKER_BINDING_CONFLICT');
    expect(outcome.message).toContain('师兄');
    expect(outcome.message).toContain('少侠');
    expect(outcome.message).toContain('同一个角色');
  });

  it('points the refusal at the conflicting block, not the first one', () => {
    const outcome = new MultiSceneDialogueService({
      speakerBindings: {
        ...distinctBindings,
        张三: AUTO05_IDS.charElder,
        大长老: AUTO05_IDS.charElder,
      },
    }).plan(aliasAudioProject(), parseMultiSceneInput(CONFLICT_IN_SECOND_BLOCK));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('SPEAKER_BINDING_CONFLICT');
    expect(outcome.blockIndex).toBe(2);
  });

  it('leaves revision and History untouched when the conflict is refused', () => {
    const h = harness(aliasAudioProject());
    const outcome = prepareMultiSceneDialoguePreview(
      parseMultiSceneInput(ALIAS_BLOCKS),
      [],
      {
        editorStore: h.editorStore,
        shotStore: h.shotStore,
        service: new MultiSceneDialogueService({
          speakerBindings: {
            师兄: AUTO05_IDS.charZhang,
            少侠: AUTO05_IDS.charZhang,
          },
        }),
      },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('SPEAKER_BINDING_CONFLICT');
    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('allows reusing one Character across Shots, only forbidding same-Shot twins', () => {
    const outcome = new MultiSceneDialogueService().plan(
      buildDialogueProject(),
      parseMultiSceneInput(TWO_BLOCKS),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 张三 appears in both Shots; each Shot still has two distinct ids.
    const idsByShot = new Map<string, Set<string>>();
    for (const row of outcome.plan.dialogue.rows) {
      const ids = idsByShot.get(row.shotId) ?? new Set<string>();
      ids.add(row.characterId);
      idsByShot.set(row.shotId, ids);
    }
    expect([...idsByShot.values()].every((ids) => ids.size === 2)).toBe(true);
    expect(
      outcome.plan.dialogue.rows.filter(
        (row) => row.characterId === AUTO05_IDS.charZhang,
      ),
    ).toHaveLength(2);
  });
});
