import { describe, expect, it } from 'vitest';
import { SubtitleRenderer } from '../../src/renderer/features/subtitles/SubtitleRenderer';

describe('SubtitleRenderer hit authority', () => {
  it('makes the caption group and every visual child non-listening', () => {
    const element = SubtitleRenderer({ text: '字幕', style: undefined });
    expect(element).not.toBeNull();
    const props = element!.props as {
      listening: boolean;
      children: Array<{ props: { listening: boolean } }>;
    };
    expect(props.listening).toBe(false);
    expect(props.children).toHaveLength(2);
    expect(props.children.every((child) => child.props.listening === false))
      .toBe(true);
  });
});
