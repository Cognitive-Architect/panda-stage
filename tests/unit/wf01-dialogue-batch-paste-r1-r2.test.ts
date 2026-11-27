// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectSchema,
  ShotService,
  type AudioAsset,
  type Character,
  type Project,
} from '../../src/domain';
import { DialogueAuthoringDraft } from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';
import { DialogueBatchPaste } from '../../src/renderer/features/dialogue/DialogueBatchPaste';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const TIGER_ID = '20000000-0000-4000-8000-000000000199';
const TIGER_EXPR_ID = '20000000-0000-4000-8000-000000000198';
const TIGER_VOICE_ID = '30000000-0000-4000-8000-000000000199';

function makeAudio(index: number, name: string, durationMs = 1_200): AudioAsset {
  return {
    id: `10000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
    kind: 'audio',
    name,
    relativePath: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: String(index % 10).repeat(64),
    durationMs,
  };
}

function makeProject(audioAssets: readonly AudioAsset[]): Project {
  const base = buildProject();
  const panda: Character = {
    ...base.characters[0]!,
    name: '熊猫',
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
        name: '老虎音色',
      },
    ],
    shots: [
      {
        ...base.shots[0]!,
        durationMs: 20_000,
      },
    ],
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { pandaStage?: unknown }).pandaStage = {
    assets: {
      readThumbnail: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'ASSET_THUMBNAIL_SOURCE_MISSING', message: 'mock' },
      }),
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  editorProjectStore.clear();
});

function selectByTestId(testId: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing select ${testId}`);
  return el;
}

function buttonByTestId(testId: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing button ${testId}`);
  return el;
}

async function changeSelect(testId: string, value: string): Promise<void> {
  const select = selectByTestId(testId);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('WF-01 DialogueBatchPaste R1 & R2 UI regressions', () => {
  it('R1: deleting a manually bound 3rd line and adding a new same-character line does not inherit the old manual/confirmed binding; switching shot clears stale overrides', async () => {
    const audio1 = makeAudio(1, '1_熊猫', 1_200);
    const audio2 = makeAudio(2, '2_老虎', 1_400);
    const audioCustom = makeAudio(3, 'custom_voice', 1_100);
    let project = makeProject([audio1, audio2, audioCustom]);
    project = new ShotService().create(project, { name: '镜头 2', durationMs: 10_000 });
    const shot1Id = project.shots[0]!.id;
    const shot2Id = project.shots[1]!.id;

    editorProjectStore.open('D:/wf01-r1.pandastage', project);
    shotStore.select(shot1Id);

    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot: 'D:/wf01-r1.pandastage', shotId: shot1Id });
    draft.setBatchRaw('熊猫：第一句\n老虎：第二句\n熊猫：第三句旧台词');

    const onSuccess = vi.fn();
    await act(async () => {
      root.render(
        createElement(DialogueBatchPaste, {
          draft,
          onSuccess,
          showDefaultExpression: false,
        }),
      );
    });

    // Manually bind line 3 to custom_voice
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(audio1.id);
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(audio2.id);
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe('');
    await changeSelect('dialogue-batch-audio-3', audioCustom.id);
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe(audioCustom.id);

    // Delete line 3
    await act(async () => {
      draft.setBatchRaw('熊猫：第一句\n老虎：第二句');
    });
    expect(
      container.querySelector('[data-testid="dialogue-batch-audio-3"]'),
    ).toBeNull();

    // Add a new 3rd line for the same character (熊猫) with different text
    await act(async () => {
      draft.setBatchRaw('熊猫：第一句\n老虎：第二句\n熊猫：全新第三句');
    });
    // Must NOT inherit deleted line 3's manual/confirmed binding!
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe('');

    // Manually bind line 3 again, then switch to shot 2 -> stale override must not carry over!
    await changeSelect('dialogue-batch-audio-3', audioCustom.id);
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe(audioCustom.id);
    await act(async () => {
      shotStore.select(shot2Id);
    });
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe('');
  });

  it('R2: preserves original logical ordinals when line 1 is unknown, and keeps post-partial-commit remaining draft lines from matching already-committed audio', async () => {
    const audio1 = makeAudio(1, '1_熊猫', 1_200);
    const audio2 = makeAudio(2, '2_熊猫', 1_500);
    const audio3 = makeAudio(3, '3_老虎', 1_300);
    const project = makeProject([audio1, audio2, audio3]);

    editorProjectStore.open('D:/wf01-r2.pandastage', project);
    shotStore.select(IDS.shot);

    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot: 'D:/wf01-r2.pandastage', shotId: IDS.shot });
    // Line 1 is an unknown speaker; Line 2 (熊猫) must match 2_熊猫, Line 3 (老虎) must match 3_老虎!
    draft.setBatchRaw('陌生人：开场白\n熊猫：第二句\n老虎：第三句');

    const onSuccess = vi.fn();
    await act(async () => {
      root.render(
        createElement(DialogueBatchPaste, {
          draft,
          onSuccess,
          showDefaultExpression: false,
        }),
      );
    });

    expect(
      container.querySelector('[data-testid="dialogue-batch-audio-1"]'),
    ).toBeNull();
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(audio2.id);
    expect(selectByTestId('dialogue-batch-audio-3').value).toBe(audio3.id);

    // Now test partial commit: Line 1 matches 1_熊猫 (ready), Line 2 has NO 2_老虎 (stays draft),
    // Line 3 is unknown speaker. After committing Line 1, remaining lines must keep ordinals 2 & 3
    // and NEVER re-number onto already-committed 1_熊猫!
    await act(async () => {
      draft.setBatchRaw('熊猫：第一句已就绪\n老虎：第二句缺配音\n陌生人：第三句待确认');
    });
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(audio1.id);
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe('');

    // Commit valid subset (Line 1 -> 1_熊猫)
    await act(async () => {
      buttonByTestId('dialogue-batch-audio-commit').click();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(1);

    // Remaining lines compacted to line 1 (老虎：第二句缺配音) and line 2 (陌生人：第三句待确认)
    expect(draft.getSnapshot().batchRaw).toBe('老虎：第二句缺配音\n陌生人：第三句待确认');
    // Line 1 (previously ordinal 2) stays unmatched (no 2_老虎); does NOT match 1_熊猫!
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe('');

    // Map remaining line 2 (陌生人 -> 老虎): previously ordinal 3 -> matches 3_老虎 (NOT 2_老虎 or 1_熊猫)!
    await act(async () => {
      draft.setBatchMapping(2, TIGER_ID);
    });
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(audio3.id);
  });
});
