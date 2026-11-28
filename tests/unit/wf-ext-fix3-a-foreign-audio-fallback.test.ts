// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectSchema,
  dialogueAudioManifestTextHash,
  serializeDialogueAudioManifestCsv,
  type AudioAsset,
  type Character,
  type DialogueAudioManifestRow,
  type Project,
} from '../../src/domain';
import { DialogueAuthoringDraft } from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';
import { DialogueBatchPaste } from '../../src/renderer/features/dialogue/DialogueBatchPaste';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

const TIGER_ID = '20000000-0000-4000-8000-000000000399';
const TIGER_EXPR_ID = '20000000-0000-4000-8000-000000000398';
const TIGER_VOICE_ID = '30000000-0000-4000-8000-000000000399';
const EXISTING_DIALOGUE_ID = '82000000-0000-4000-8000-000000000302';
const FOREIGN_DIALOGUE_ID = '82000000-0000-4000-8000-000000000301';

function makeAudio(
  index: number,
  name: string,
  durationMs = 2_000,
  fileName = `${name}.wav`,
): AudioAsset {
  return {
    id: `10000000-0000-4000-8000-${String(900 + index).padStart(12, '0')}`,
    kind: 'audio',
    name,
    relativePath: `assets/${fileName}`,
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
    expressions: [{ id: TIGER_EXPR_ID, name: '正常', assetId: IDS.assetChar }],
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
        dialogues: [
          {
            id: EXISTING_DIALOGUE_ID,
            characterId: panda.id,
            speakerType: 'character',
            voiceProfileId: panda.defaultVoiceProfileId,
            text: '旧对白占位',
            startMs: 10_000,
            endMs: 11_000,
            subtitleStyleId: base.shots[0]!.defaultSubtitleStyleId,
          },
        ],
      },
    ],
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  timelineUiStore.seek(0, 20_000);
});

function selectByTestId(testId: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(
    `[data-testid="${testId}"]`,
  );
  if (!el) throw new Error(`Missing select ${testId}`);
  return el;
}

function buttonByTestId(testId: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
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

async function importCsv(csvText: string): Promise<void> {
  const fileInput = container.querySelector<HTMLInputElement>(
    '[data-testid="dialogue-batch-manifest-file"]',
  );
  if (!fileInput) throw new Error('Missing manifest file input');
  const file = new File([csvText], 'manifest.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(csvText),
  });
  await act(async () => {
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function manifestRow(
  overrides: Partial<DialogueAudioManifestRow> & {
    projectId: string;
    shotId: string;
  },
): DialogueAudioManifestRow {
  const speaker = overrides.speaker ?? '熊猫';
  const text = overrides.text ?? '你来了？';
  return {
    version: 1,
    lineKey: 'L001',
    ordinal: 1,
    speaker,
    text,
    ...overrides,
    textHash:
      overrides.textHash ?? dialogueAudioManifestTextHash(speaker, text),
  };
}

describe('WF-EXT FIX-03 A: out-of-scope CSV rows never fall back to numbered auto-audio (R3-P2-01)', () => {
  it('keeps foreign line 1 explicitly unselected when 1_熊猫.wav exists, binds valid line 2 with real trim, survives partial commit & reorder, and allows explicit manual pick', async () => {
    const numberedAudio1 = makeAudio(1, '1_熊猫', 1_500);
    const localTake2 = makeAudio(2, 'take_l002', 2_400);
    const projectRoot = 'D:/wf-fix3-r3-p2-01.pandastage';
    const project = makeProject([numberedAudio1, localTake2]);

    editorProjectStore.open(projectRoot, project);
    shotStore.select(IDS.shot);

    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot, shotId: IDS.shot });
    // Pre-populate a plain line that auto-matches 1_熊猫.wav so we also prove
    // stale confirmed cache cannot leak into the imported foreign row.
    draft.setBatchRaw('熊猫：你来了？');

    const onSuccess = vi.fn();
    await act(async () => {
      root.render(createElement(DialogueBatchPaste, { draft, onSuccess }));
    });
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(
      numberedAudio1.id,
    );

    const csv = serializeDialogueAudioManifestCsv([
      manifestRow({
        projectId: project.id,
        shotId: '10000000-0000-4000-8000-0000000000ff',
        lineKey: 'L001',
        dialogueId: FOREIGN_DIALOGUE_ID,
        ordinal: 1,
        speaker: '熊猫',
        text: '你来了？',
        audioFilename: '1_熊猫.wav',
      }),
      manifestRow({
        projectId: project.id,
        shotId: IDS.shot,
        lineKey: 'L002',
        dialogueId: EXISTING_DIALOGUE_ID,
        ordinal: 2,
        speaker: '熊猫',
        text: '你来了？',
        audioFilename: 'take_l002.wav',
        sourceStartMs: 250,
        sourceEndMs: 1_450,
      }),
    ]);

    await importCsv(csv);

    // Line 1 (foreign) stays plain text with NO auto-matched 1_熊猫.wav;
    // Line 2 (current shot) binds L002's real recording and [250, 1450) trim.
    const rowsAfterImport = container.querySelectorAll<HTMLLIElement>(
      '[data-testid="dialogue-batch-line"]',
    );
    expect(rowsAfterImport).toHaveLength(2);
    expect(rowsAfterImport[0]!.dataset.audioReady).toBe('false');
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe('');
    expect(rowsAfterImport[1]!.dataset.audioReady).toBe('true');
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(localTake2.id);
    expect(
      container.querySelector('[data-testid="dialogue-batch-audio-timing-2"]')
        ?.textContent,
    ).toContain('1.2 秒');

    // Partial commit: only line 2 commits onto its formal dialogueId and trim.
    await act(async () => {
      buttonByTestId('dialogue-batch-audio-commit').click();
    });
    expect(onSuccess).not.toHaveBeenCalled();

    const shotAfterPartial =
      editorProjectStore.getSnapshot()!.project.shots[0]!;
    expect(shotAfterPartial.dialogues).toHaveLength(1);
    expect(shotAfterPartial.dialogues[0]!.id).toBe(EXISTING_DIALOGUE_ID);
    expect(shotAfterPartial.dialogues[0]!.text).toBe('你来了？');
    expect(shotAfterPartial.dialogues[0]!.startMs).toBe(0);
    expect(shotAfterPartial.dialogues[0]!.endMs).toBe(1_200);
    expect(shotAfterPartial.audioClips).toHaveLength(1);
    expect(shotAfterPartial.audioClips[0]).toMatchObject({
      assetId: localTake2.id,
      offsetMs: 250,
      startMs: 0,
      endMs: 1_200,
    });

    // Remaining foreign line 1 must STILL stay unselected (no fallback to 1_熊猫.wav).
    expect(draft.getSnapshot().batchRaw).toBe('熊猫：你来了？');
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe('');

    // Reorder / insert a plain line above the remaining foreign row:
    // the foreign row keeps its explicit unselected state at line 2.
    await act(async () => {
      draft.setBatchRaw('老虎：新插入的台词\n熊猫：你来了？');
    });
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe('');

    // Author can explicitly select a recording on the foreign row to clear
    // the unselected state and commit it as a brand-new dialogue.
    await act(async () => {
      timelineUiStore.seek(2_000, 20_000);
    });
    await changeSelect('dialogue-batch-audio-2', numberedAudio1.id);
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(
      numberedAudio1.id,
    );

    await act(async () => {
      buttonByTestId('dialogue-batch-audio-commit').click();
    });
    const shotAfterManual =
      editorProjectStore.getSnapshot()!.project.shots[0]!;
    expect(shotAfterManual.dialogues).toHaveLength(2);
    expect(shotAfterManual.dialogues.map((d) => d.id)).not.toContain(
      FOREIGN_DIALOGUE_ID,
    );
    expect(shotAfterManual.audioClips.map((clip) => clip.assetId)).toEqual([
      localTake2.id,
      numberedAudio1.id,
    ]);
  });

  it.each([
    { format: 'surrounding whitespace', text: '  来自其他工程  ' },
    { format: 'CRLF multiline text', text: '来自其他工程\r\n第二行' },
  ])('keeps foreign CSV audio unselected after $format normalization', async ({ text }) => {
    const numberedAudio1 = makeAudio(1, '1_熊猫', 1_500);
    const localTake2 = makeAudio(2, 'take_l002', 2_400);
    const projectRoot = 'D:/wf-fix3-r3-p2-01-format.pandastage';
    const project = makeProject([numberedAudio1, localTake2]);
    editorProjectStore.open(projectRoot, project);
    shotStore.select(IDS.shot);

    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot, shotId: IDS.shot });
    await act(async () => {
      root.render(createElement(DialogueBatchPaste, { draft, onSuccess: vi.fn() }));
    });

    await importCsv(serializeDialogueAudioManifestCsv([
      manifestRow({
        projectId: project.id,
        shotId: '10000000-0000-4000-8000-0000000000ff',
        lineKey: 'L001',
        dialogueId: FOREIGN_DIALOGUE_ID,
        ordinal: 1,
        speaker: '熊猫',
        text,
        audioFilename: '1_熊猫.wav',
      }),
      manifestRow({
        projectId: project.id,
        shotId: IDS.shot,
        lineKey: 'L002',
        dialogueId: EXISTING_DIALOGUE_ID,
        ordinal: 2,
        speaker: '熊猫',
        text: '当前镜头台词',
        audioFilename: 'take_l002.wav',
      }),
    ]));

    expect(selectByTestId('dialogue-batch-audio-1').value).toBe('');
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(localTake2.id);
    await changeSelect('dialogue-batch-audio-1', numberedAudio1.id);
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(numberedAudio1.id);
  });

  it('preserves explicit unselected state across line swap and keeps plain-text numbered auto-matching intact', async () => {
    const numberedAudio1 = makeAudio(1, '1_熊猫', 1_500);
    const numberedAudio2 = makeAudio(2, '2_熊猫', 1_600);
    const projectRoot = 'D:/wf-fix3-r3-p2-01-plain.pandastage';
    const project = makeProject([numberedAudio1, numberedAudio2]);

    editorProjectStore.open(projectRoot, project);
    shotStore.select(IDS.shot);

    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot, shotId: IDS.shot });
    const onSuccess = vi.fn();

    await act(async () => {
      root.render(createElement(DialogueBatchPaste, { draft, onSuccess }));
    });

    const csv = serializeDialogueAudioManifestCsv([
      manifestRow({
        projectId: '10000000-0000-4000-8000-0000000000fe',
        shotId: IDS.shot,
        lineKey: 'L001',
        ordinal: 1,
        speaker: '熊猫',
        text: '来自其他工程',
      }),
      manifestRow({
        projectId: project.id,
        shotId: IDS.shot,
        lineKey: 'L002',
        ordinal: 2,
        speaker: '熊猫',
        text: '当前镜头台词',
        audioFilename: '2_熊猫.wav',
      }),
    ]);

    await importCsv(csv);
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe('');
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(
      numberedAudio2.id,
    );

    // Swap the two lines in the editor: foreign row moves to line 2 and must
    // still stay unselected instead of matching 2_熊猫.wav; local row keeps its
    // imported binding at line 1.
    await act(async () => {
      draft.setBatchRaw('熊猫：当前镜头台词\n熊猫：来自其他工程');
    });
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(
      numberedAudio2.id,
    );
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe('');

    // Clearing and pasting normal plain text still uses <ordinal>_<speakerName> auto-matching.
    await act(async () => {
      draft.setBatchRaw('');
    });
    await act(async () => {
      draft.setBatchRaw('熊猫：普通纯文本第一句\n熊猫：普通纯文本第二句');
    });
    expect(selectByTestId('dialogue-batch-audio-1').value).toBe(
      numberedAudio1.id,
    );
    expect(selectByTestId('dialogue-batch-audio-2').value).toBe(
      numberedAudio2.id,
    );
  });
});
