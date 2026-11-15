import { describe, expect, it } from 'vitest';
import type { Character } from '../../src/domain';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
} from '../../src/renderer/features/dialogue/parseDialoguePaste';
import { buildProject } from './domain/testProject';

const project = buildProject();
const [panda] = project.characters as unknown as [Character];

function charactersWithNarratorName(): Character[] {
  return [{ ...panda, name: '旁白' }];
}

describe('VOICE-01 batch paste narration', () => {
  it('accepts 旁白 lines mixed with existing character lines', () => {
    const parsed = parseDialoguePaste(
      '旁白：十年前，少年张三踏上修仙之路……\n熊猫：你好呀\n旁白：如今他已是金丹修士。',
      [panda],
    );

    expect(parsed.lines.map((line) => line.status)).toEqual([
      'valid',
      'valid',
      'valid',
    ]);
    expect(parsed.lines[0]!.speakerType).toBe('narrator');
    expect(parsed.lines[0]!.characterId).toBeUndefined();
    expect(parsed.lines[1]!.characterId).toBe(panda.id);
    expect(parsed.lines[1]!.speakerType).toBeUndefined();
    expect(parsed.validCount).toBe(3);

    const resolved = resolveDialoguePaste(parsed, {}, [panda]);
    expect(resolved.allResolved).toBe(true);
    expect(resolved.resolvedLines).toEqual([
      { speakerType: 'narrator', text: '十年前，少年张三踏上修仙之路……' },
      { characterId: panda.id, text: '你好呀' },
      { speakerType: 'narrator', text: '如今他已是金丹修士。' },
    ]);
  });

  it('still reports genuinely unknown speakers for explicit mapping', () => {
    const parsed = parseDialoguePaste('李四：我是谁\n旁白：旁白', [panda]);
    expect(parsed.lines[0]!.status).toBe('unknown');
    expect(parsed.lines[1]!.status).toBe('valid');
    expect(resolveDialoguePaste(parsed, {}, [panda]).allResolved).toBe(false);
  });

  it('never silently converts a real character named 旁白 into narration', () => {
    const characters = charactersWithNarratorName();
    const parsed = parseDialoguePaste('旁白：这是角色对白', characters);

    expect(parsed.lines[0]!.status).toBe('ambiguous');
    expect(parsed.lines[0]!.reason).toBe('narrator-name-conflict');
    expect(parsed.lines[0]!.speakerType).toBeUndefined();
    expect(resolveDialoguePaste(parsed, {}, characters).allResolved).toBe(false);

    const mapped = resolveDialoguePaste(
      parsed,
      { 1: characters[0]!.id },
      characters,
    );
    expect(mapped.resolvedLines).toEqual([
      { characterId: characters[0]!.id, text: '这是角色对白' },
    ]);
  });
});
