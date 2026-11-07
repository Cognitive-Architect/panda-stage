import { describe, expect, it } from 'vitest';
import {
  MultiSceneInputError,
  parseMultiSceneInput,
  type MultiSceneBlock,
} from '../../src/domain';
import {
  PERFORMANCE_THREE_BLOCKS,
  THREE_BLOCKS,
  TWO_BLOCKS,
} from '../helpers/multiSceneDialogueFixture';

function script(performanceLines: readonly string[] = []): string {
  return [
    '镜头：花园相遇',
    '背景：花园',
    '出场：张三、李四',
    '站位：双人对话',
    '对白：',
    '张三：你好。',
    '李四：好久不见。',
    ...(performanceLines.length > 0 ? ['表演：', ...performanceLines] : []),
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

function codeOf(raw: string): string {
  try {
    parseMultiSceneInput(raw);
    return 'NO_ERROR';
  } catch (error) {
    return error instanceof MultiSceneInputError ? error.code : 'UNKNOWN';
  }
}

describe('AUTO-06 strict performance input', () => {
  it('omitting the performance section behaves exactly like AUTO-05', () => {
    const blocks = parseMultiSceneInput(TWO_BLOCKS);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.performances.length === 0)).toBe(true);
    expect(
      blocks.flatMap((block) => block.dialogues.map((line) => line.ordinal)),
    ).toEqual([1, 2, 3, 4]);
  });

  it('parses all 8 stock actions with their explicit parameters', () => {
    const [first] = parseMultiSceneInput(
      script([
        '1｜左入场',
        '1｜右入场',
        '1｜移动｜x=1260｜y=760',
        '1｜放大｜1.20',
        '1｜抖动',
        '1｜表情｜生气',
        '1｜淡入',
        '1｜淡出',
      ]),
    );
    const directives = (first as MultiSceneBlock).performances;
    expect(directives.map((directive) => directive.action)).toEqual([
      'left-enter',
      'right-enter',
      'move',
      'scale',
      'shake',
      'expression',
      'fade-in',
      'fade-out',
    ]);
    const move = directives[2]!;
    expect(move.action === 'move' && move.targetX === 1260).toBe(true);
    expect(move.action === 'move' && move.targetY === 760).toBe(true);
    expect(
      directives[3]!.action === 'scale' &&
        directives[3]!.scaleFactor === 1.2,
    ).toBe(true);
    expect(
      directives[5]!.action === 'expression' &&
        directives[5]!.expressionName === '生气',
    ).toBe(true);
    expect(directives.every((directive) => directive.blockIndex === 1)).toBe(
      true,
    );
    expect(directives[0]!.sourceLine).toBe(9);
  });

  it('accepts ASCII vertical bars and global ordinals across Shots', () => {
    const blocks = parseMultiSceneInput(
      [
        '镜头：花园相遇',
        '背景：花园',
        '出场：张三、李四',
        '站位：双人对话',
        '对白：',
        '张三：你好。',
        '李四：好久不见。',
        '表演：',
        '2|抖动',
        '---',
        '镜头：宗门大厅',
        '背景：宗门大厅',
        '出场：张三、大长老',
        '站位：双人对话',
        '对白：',
        '大长老：你可知错？',
        '张三：弟子知错。',
        '表演：',
        '3|淡入',
      ].join('\n'),
    );
    expect(blocks[0]!.performances[0]).toMatchObject({
      dialogueOrdinal: 2,
      action: 'shake',
    });
    expect(blocks[1]!.performances[0]).toMatchObject({
      dialogueOrdinal: 3,
      action: 'fade-in',
      blockIndex: 2,
    });
  });

  it('keeps the whole-script ordinal continuous when a Shot has no directives', () => {
    const blocks = parseMultiSceneInput(script(['1｜抖动']));
    expect(
      blocks.flatMap((block) => block.dialogues.map((line) => line.ordinal)),
    ).toEqual([1, 2, 3, 4]);
    expect(blocks[1]!.performances).toHaveLength(0);
  });

  it('parses the three-Shot fixture with a performance section in each Shot', () => {
    const blocks = parseMultiSceneInput(PERFORMANCE_THREE_BLOCKS);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.performances.length)).toEqual([
      4, 2, 2,
    ]);
    expect(
      blocks.flatMap((block) =>
        block.performances.map((directive) => directive.dialogueOrdinal),
      ),
    ).toEqual([1, 1, 2, 2, 3, 4, 5, 6]);
  });

  it('refuses an ordinal that has no Dialogue in this batch', () => {
    expect(codeOf(script(['5｜抖动']))).toBe('PERFORMANCE_ORDINAL_UNKNOWN');
    expect(codeOf(script(['0｜抖动']))).toBe('PERFORMANCE_MALFORMED');
    expect(codeOf(script(['x｜抖动']))).toBe('PERFORMANCE_MALFORMED');
  });

  it('refuses unknown actions, malformed lines and stray dialogue after 表演：', () => {
    expect(codeOf(script(['1｜跑步']))).toBe('PERFORMANCE_UNKNOWN_ACTION');
    expect(codeOf(script(['抖动']))).toBe('PERFORMANCE_MALFORMED');
    expect(codeOf(script(['1｜｜抖动']))).toBe('PERFORMANCE_MALFORMED');
    expect(codeOf(script(['1｜抖动', '张三：又来一句']))).toBe(
      'PERFORMANCE_MALFORMED',
    );
  });

  it('refuses missing, extra, duplicate and non-finite move parameters', () => {
    expect(codeOf(script(['1｜移动｜x=100']))).toBe(
      'PERFORMANCE_MISSING_PARAM',
    );
    expect(codeOf(script(['1｜移动｜x=1｜y=2｜z=3']))).toBe(
      'PERFORMANCE_EXTRA_PARAM',
    );
    expect(codeOf(script(['1｜移动｜x=1｜x=2']))).toBe(
      'PERFORMANCE_EXTRA_PARAM',
    );
    expect(codeOf(script(['1｜移动｜x=abc｜y=2']))).toBe(
      'PERFORMANCE_INVALID_NUMBER',
    );
    expect(codeOf(script(['1｜移动｜x=Infinity｜y=2']))).toBe(
      'PERFORMANCE_INVALID_NUMBER',
    );
  });

  it('refuses missing, extra, non-numeric and non-positive scale', () => {
    expect(codeOf(script(['1｜放大']))).toBe('PERFORMANCE_MISSING_PARAM');
    expect(codeOf(script(['1｜放大｜1.2｜2.0']))).toBe(
      'PERFORMANCE_EXTRA_PARAM',
    );
    expect(codeOf(script(['1｜放大｜abc']))).toBe(
      'PERFORMANCE_INVALID_NUMBER',
    );
    expect(codeOf(script(['1｜放大｜0']))).toBe('PERFORMANCE_INVALID_SCALE');
    expect(codeOf(script(['1｜放大｜-1']))).toBe('PERFORMANCE_INVALID_SCALE');
  });

  it('refuses empty expression names and parameters on no-arg actions', () => {
    expect(codeOf(script(['1｜表情｜  ']))).toBe(
      'PERFORMANCE_EMPTY_EXPRESSION',
    );
    expect(codeOf(script(['1｜表情']))).toBe('PERFORMANCE_MISSING_PARAM');
    expect(codeOf(script(['1｜表情｜生气｜正常']))).toBe(
      'PERFORMANCE_EXTRA_PARAM',
    );
    expect(codeOf(script(['1｜抖动｜1']))).toBe('PERFORMANCE_EXTRA_PARAM');
  });

  it('refuses a duplicate section, a section before dialogue, and inline values', () => {
    expect(codeOf(script(['1｜抖动', '表演：', '2｜抖动']))).toBe(
      'DUPLICATE_PERFORMANCE_SECTION',
    );
    expect(
      codeOf(
        [
          '镜头：花园相遇',
          '背景：花园',
          '出场：张三、李四',
          '站位：双人对话',
          '表演：',
          '1｜抖动',
          '对白：',
          '张三：你好。',
          '---',
          '镜头：宗门大厅',
          '背景：宗门大厅',
          '出场：张三、大长老',
          '站位：双人对话',
          '对白：',
          '大长老：你可知错？',
        ].join('\n'),
      ),
    ).toBe('PERFORMANCE_SECTION_INVALID');
    expect(codeOf(script(['1｜抖动']).replace('表演：', '表演：1'))).toBe(
      'PERFORMANCE_SECTION_INVALID',
    );
    expect(
      codeOf(script(['1｜抖动']).replace('表演：\n1｜抖动', '表演：\n1｜抖动\n对白：')),
    ).toBe('PERFORMANCE_SECTION_INVALID');
  });

  it('still refuses prose and never guesses an emotion from dialogue text', () => {
    expect(
      codeOf(script([]).replace('张三：你好。', '张三愤怒地说：你好。')),
    ).toBe('SPEAKER_NOT_IN_CAST');
    expect(parseMultiSceneInput(THREE_BLOCKS)).toHaveLength(3);
  });
});
