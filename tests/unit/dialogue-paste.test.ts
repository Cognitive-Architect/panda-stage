import { describe, expect, it } from 'vitest';
import type { Character } from '../../src/domain';
import {
  isBatchSubmittable,
  parseDialoguePaste,
  resolveDialoguePaste,
} from '../../src/renderer/features/dialogue/parseDialoguePaste';

function character(id: string, name: string): Character {
  return {
    id,
    name,
    baseAssetId: '10000000-0000-4000-8000-000000000002',
    defaultVoiceProfileId: '30000000-0000-4000-8000-000000000001',
    expressions: [
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: '正常',
        assetId: '10000000-0000-4000-8000-000000000002',
      },
    ],
    defaultExpressionId: '20000000-0000-4000-8000-000000000002',
    defaultScale: 1,
    defaultFlipX: false,
  };
}

const panda = character('c-panda', '熊猫');
const tiger = character('c-tiger', '老虎');
const characters = [panda, tiger];

describe('parseDialoguePaste', () => {
  it('parses a valid speaker:text line', () => {
    const result = parseDialoguePaste('熊猫：你好吗', characters);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      status: 'valid',
      speaker: '熊猫',
      text: '你好吗',
      characterId: 'c-panda',
    });
    expect(result.validCount).toBe(1);
    expect(result.ignoredEmpty).toBe(0);
  });

  it('preserves colons that appear inside the dialogue text', () => {
    const result = parseDialoguePaste('熊猫：他说：你好', characters);
    expect(result.lines[0]).toMatchObject({
      status: 'valid',
      speaker: '熊猫',
      text: '他说：你好',
      characterId: 'c-panda',
    });
  });

  it('accepts the ASCII colon as a separator', () => {
    const result = parseDialoguePaste('老虎: 我很好', characters);
    expect(result.lines[0]).toMatchObject({
      status: 'valid',
      speaker: '老虎',
      text: '我很好',
      characterId: 'c-tiger',
    });
  });

  it('trims whitespace and matches case-insensitively', () => {
    const result = parseDialoguePaste(' 熊猫 ： 你好 ', characters);
    expect(result.lines[0]).toMatchObject({
      status: 'valid',
      speaker: '熊猫',
      text: '你好',
      characterId: 'c-panda',
    });
  });

  it('marks lines without a separator as malformed', () => {
    const result = parseDialoguePaste('只是普通文本', characters);
    expect(result.lines[0]!.status).toBe('malformed');
    expect(result.validCount).toBe(0);
  });

  it('marks empty speaker and empty text as invalid', () => {
    const noSpeaker = parseDialoguePaste('：没名字', characters);
    expect(noSpeaker.lines[0]).toMatchObject({
      status: 'invalid',
      reason: 'empty-speaker',
    });
    const noText = parseDialoguePaste('熊猫：', characters);
    expect(noText.lines[0]).toMatchObject({
      status: 'invalid',
      reason: 'empty-text',
    });
  });

  it('marks unknown speakers without guessing', () => {
    const result = parseDialoguePaste('小猫：喵', characters);
    expect(result.lines[0]).toMatchObject({
      status: 'unknown',
      speaker: '小猫',
      text: '喵',
    });
    expect(result.lines[0]!.characterId).toBeUndefined();
    expect(result.validCount).toBe(0);
  });

  it('handles ambiguous matches defensively', () => {
    const dupes: Character[] = [
      ...characters,
      character('c-extra', '熊猫'),
    ];
    const result = parseDialoguePaste('熊猫：重复名', dupes);
    expect(result.lines[0]!.status).toBe('ambiguous');
  });

  it('skips blank lines and reports the ignored count', () => {
    const result = parseDialoguePaste(
      '\n\n熊猫：一句\n\n老虎：二句\n',
      characters,
    );
    expect(result.ignoredEmpty).toBe(4);
    expect(result.lines).toHaveLength(2);
    expect(result.validCount).toBe(2);
  });

  it('reports submittability only when every line is valid', () => {
    const clean = parseDialoguePaste('熊猫：a\n老虎：b', characters);
    expect(isBatchSubmittable(clean)).toBe(true);
    const withUnknown = parseDialoguePaste('熊猫：a\n小猫：b', characters);
    expect(isBatchSubmittable(withUnknown)).toBe(false);
    const empty = parseDialoguePaste('', characters);
    expect(isBatchSubmittable(empty)).toBe(false);
  });

  it('resolves unknown speakers through draft-only mappings and reports stats', () => {
    const parsed = parseDialoguePaste(
      '熊猫：有效\n小猫：待映射\n没有分隔符',
      characters,
    );
    const unresolved = resolveDialoguePaste(parsed, {}, characters);
    expect(unresolved).toMatchObject({
      readyCount: 1,
      failureCount: 1,
      unknownCount: 1,
      allResolved: false,
    });

    const mapped = resolveDialoguePaste(parsed, { 2: 'c-tiger' }, characters);
    expect(mapped).toMatchObject({
      readyCount: 2,
      failureCount: 1,
      unknownCount: 1,
      allResolved: false,
    });
    expect(mapped.resolvedLines[1]).toEqual({
      characterId: 'c-tiger',
      text: '待映射',
    });
  });

  it('rejects a stale speaker mapping to a character that no longer exists', () => {
    const parsed = parseDialoguePaste('小猫：喵', characters);
    expect(
      resolveDialoguePaste(parsed, { 1: 'deleted-character' }, characters),
    ).toMatchObject({ readyCount: 0, allResolved: false });
  });
});
