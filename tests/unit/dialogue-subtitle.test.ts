import { describe, expect, it } from 'vitest';
import type { Dialogue, Shot } from '../../src/domain';
import { buildProductPreviewCues } from '../../src/renderer/shell/productPreviewModel';
import { buildDialogueSubtitleCues } from '../../src/shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';

const CHARACTER_ID = '10000000-0000-4000-8000-000000000001';
const VOICE_ID = '20000000-0000-4000-8000-000000000001';
const STYLE_ID = '30000000-0000-4000-8000-000000000001';

function dialogue(
  id: string,
  startMs: number,
  endMs: number,
  text: string,
): Dialogue {
  return {
    id,
    characterId: CHARACTER_ID,
    voiceProfileId: VOICE_ID,
    subtitleStyleId: STYLE_ID,
    startMs,
    endMs,
    text,
  };
}

function previewCues(dialogues: Dialogue[]) {
  return buildProductPreviewCues({ dialogues } as Shot);
}

describe('shared Dialogue subtitle projection/evaluator', () => {
  const first = dialogue(
    '40000000-0000-4000-8000-000000000001',
    100,
    200,
    ' first ',
  );
  const second = dialogue(
    '40000000-0000-4000-8000-000000000002',
    200,
    300,
    'second',
  );
  const untimed = dialogue(
    '40000000-0000-4000-8000-000000000003',
    250,
    250,
    'untimed',
  );

  it.each([
    ['just before start', 99, null],
    ['exact start', 100, first.id],
    ['inside span', 199, first.id],
    ['exact end / adjacency', 200, second.id],
    ['second exact end', 300, null],
  ])(
    'editor and Preview choose the same cue at %s',
    (_label, timeMs, expectedId) => {
      const dialogues = [first, second, untimed];
      const editor = evaluateSubtitleAtTime(
        buildDialogueSubtitleCues(dialogues),
        timeMs,
      );
      const preview = evaluateSubtitleAtTime(
        previewCues(dialogues),
        timeMs,
      );
      expect(editor?.id ?? null).toBe(expectedId);
      expect(preview?.id ?? null).toBe(expectedId);
      expect(preview).toEqual(editor);
    },
  );

  it('uses one deterministic winner for legacy overlap in both consumers', () => {
    const earlier = dialogue(
      '40000000-0000-4000-8000-000000000010',
      0,
      500,
      'earlier',
    );
    const later = dialogue(
      '40000000-0000-4000-8000-000000000011',
      200,
      400,
      'later',
    );
    const dialogues = [earlier, later];
    const editor = evaluateSubtitleAtTime(
      buildDialogueSubtitleCues(dialogues),
      250,
    );
    const preview = evaluateSubtitleAtTime(previewCues(dialogues), 250);
    expect(editor?.id).toBe(later.id);
    expect(preview).toEqual(editor);
  });

  it('trims and caps cue text at 500 characters in the shared owner', () => {
    const long = dialogue(
      '40000000-0000-4000-8000-000000000020',
      0,
      100,
      `  ${'字'.repeat(700)}  `,
    );
    const editor = buildDialogueSubtitleCues([long]);
    const preview = previewCues([long]);
    expect(editor[0]!.text).toHaveLength(500);
    expect(preview).toEqual(editor);
  });
});
