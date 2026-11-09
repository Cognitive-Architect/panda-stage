import { describe, expect, it } from 'vitest';
import {
  MultiSceneInputError,
  MULTI_SCENE_MAX_DIALOGUE_LENGTH,
  collectSpeakerLabels,
  parseMultiSceneInput,
} from '../../src/domain';
import { THREE_BLOCKS, TWO_BLOCKS } from '../helpers/multiSceneDialogueFixture';

function codeOf(raw: string): string | null {
  try {
    parseMultiSceneInput(raw);
    return null;
  } catch (error) {
    return error instanceof MultiSceneInputError ? error.code : 'UNEXPECTED';
  }
}

const BLOCK_1 = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：你怎么来了？',
  '李四：我来找你。',
].join('\n');

const BLOCK_2 = [
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
  '对白：',
  '大长老：你可知错？',
  '张三：弟子知错。',
].join('\n');

describe('AUTO-05 strict multi-scene dialogue input', () => {
  it('parses 2 blocks and keeps the whole-script ordinal order', () => {
    const blocks = parseMultiSceneInput(TWO_BLOCKS);
    expect(blocks).toHaveLength(2);
    expect(blocks.flatMap((block) => block.dialogues.map((line) => line.ordinal))).toEqual([
      1, 2, 3, 4,
    ]);
    expect(blocks[0]!.dialogues.map((line) => line.speaker)).toEqual([
      '张三',
      '李四',
    ]);
    expect(blocks[1]!.dialogues.map((line) => line.speaker)).toEqual([
      '大长老',
      '张三',
    ]);
  });

  it('parses 3 blocks with ordinals 1..6', () => {
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    expect(blocks).toHaveLength(3);
    expect(blocks.flatMap((block) => block.dialogues.map((line) => line.ordinal))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('skips blank lines and keeps the first colon as the only separator', () => {
    const raw = [
      '镜头：花园相遇',
      '背景：花园',
      '出场：张三、李四',
      '站位：双人对话',
      '对白：',
      '',
      '张三：我说：你好',
      '',
      '李四：我来找你。',
      '---',
      BLOCK_2,
    ].join('\n');
    const blocks = parseMultiSceneInput(raw);
    expect(blocks[0]!.dialogues).toHaveLength(2);
    expect(blocks[0]!.dialogues[0]!.text).toBe('我说：你好');
    expect(blocks[0]!.dialogues[1]!.ordinal).toBe(2);
  });

  it('never merges adjacent lines from the same speaker', () => {
    const raw = [
      BLOCK_1.replace('李四：我来找你。', '张三：我再说一句。'),
      BLOCK_2,
    ].join('\n---\n');
    expect(parseMultiSceneInput(raw)[0]!.dialogues.map((line) => line.speaker)).toEqual([
      '张三',
      '张三',
    ]);
  });

  it('rejects 1 or 4 blocks', () => {
    expect(codeOf(BLOCK_1)).toBe('BLOCK_COUNT_OUT_OF_RANGE');
    expect(codeOf([BLOCK_1, BLOCK_2, BLOCK_1, BLOCK_2].join('\n---\n'))).toBe(
      'BLOCK_COUNT_OUT_OF_RANGE',
    );
  });

  it('rejects unknown, duplicate, missing and empty scene fields', () => {
    expect(codeOf(TWO_BLOCKS.replace('背景：花园', '旁白：花园'))).toBe('UNKNOWN_FIELD');
    expect(
      codeOf(TWO_BLOCKS.replace('背景：花园', '背景：花园\n背景：宗门大厅')),
    ).toBe('DUPLICATE_FIELD');
    expect(codeOf(TWO_BLOCKS.replace('镜头：花园相遇\n', ''))).toBe('MISSING_FIELD');
    expect(codeOf(TWO_BLOCKS.replace('站位：双人对话', '站位：'))).toBe('EMPTY_FIELD');
  });

  it('rejects a cast that is not exactly two different people', () => {
    expect(codeOf(TWO_BLOCKS.replace('出场：张三、李四', '出场：张三'))).toBe(
      'INVALID_CAST_COUNT',
    );
    expect(codeOf(TWO_BLOCKS.replace('出场：张三、李四', '出场：张三、张三'))).toBe(
      'SAME_CHARACTER',
    );
  });

  it('rejects any stance other than 双人对话', () => {
    expect(codeOf(TWO_BLOCKS.replace('站位：双人对话', '站位：三人对话'))).toBe(
      'INVALID_STANCE',
    );
  });

  it('rejects duplicate Shot names inside the batch', () => {
    expect(codeOf(TWO_BLOCKS.replace('镜头：宗门大厅', '镜头：花园相遇'))).toBe(
      'DUPLICATE_SHOT_NAME',
    );
  });

  it('requires exactly one empty 对白 section per block', () => {
    expect(
      codeOf(
        TWO_BLOCKS.replace(
          '对白：\n张三：你怎么来了？\n李四：我来找你。\n',
          '',
        ),
      ),
    ).toBe('MISSING_DIALOGUE_SECTION');
    expect(codeOf(TWO_BLOCKS.replace('对白：', '对白：张三：你好'))).toBe(
      'INVALID_DIALOGUE_SECTION',
    );
    expect(
      codeOf(TWO_BLOCKS.replace('李四：我来找你。', '对白：\n李四：我来找你。')),
    ).toBe('DUPLICATE_DIALOGUE_SECTION');
    expect(codeOf(TWO_BLOCKS.replace(/张三：你怎么来了？\n李四：我来找你。/u, ''))).toBe(
      'EMPTY_DIALOGUE',
    );
  });

  it('rejects malformed, empty-speaker, empty-text and overlong dialogue', () => {
    expect(codeOf(TWO_BLOCKS.replace('张三：你怎么来了？', '张三没有说话'))).toBe(
      'MALFORMED_DIALOGUE',
    );
    expect(codeOf(TWO_BLOCKS.replace('张三：你怎么来了？', '：你怎么来了？'))).toBe(
      'EMPTY_SPEAKER',
    );
    expect(codeOf(TWO_BLOCKS.replace('张三：你怎么来了？', '张三：'))).toBe(
      'EMPTY_TEXT',
    );
    expect(
      codeOf(
        TWO_BLOCKS.replace(
          '张三：你怎么来了？',
          `张三：${'字'.repeat(MULTI_SCENE_MAX_DIALOGUE_LENGTH + 1)}`,
        ),
      ),
    ).toBe('TEXT_TOO_LONG');
  });

  it('rejects a speaker that is not one of the two cast members', () => {
    expect(codeOf(TWO_BLOCKS.replace('李四：我来找你。', '王五：我来找你。'))).toBe(
      'SPEAKER_NOT_IN_CAST',
    );
  });

  it('rejects a scene field written after the 对白 section', () => {
    expect(
      codeOf(TWO_BLOCKS.replace('李四：我来找你。', '背景：花园\n李四：我来找你。')),
    ).toBe('MALFORMED_DIALOGUE');
  });

  it('collects each script label once, in first-seen order', () => {
    const labels = collectSpeakerLabels(parseMultiSceneInput(THREE_BLOCKS));
    expect(labels).toEqual(['张三', '李四', '大长老']);
  });
});
