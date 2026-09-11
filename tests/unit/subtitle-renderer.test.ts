import { describe, expect, it } from 'vitest';
import type { SubtitleStyle } from '../../src/domain';
import { SubtitleRenderer } from '../../src/renderer/features/subtitles/SubtitleRenderer';
import { DEFAULT_SUBTITLE_STYLE } from '../../src/shared/preview/subtitle-layout';

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

  it('keeps the default background transparent while honoring explicit styles', () => {
    expect(DEFAULT_SUBTITLE_STYLE.backgroundColor).toBe('#0a141100');
    const explicitStyle: SubtitleStyle = {
      id: '40000000-0000-4000-8000-000000000001',
      name: 'Explicit background',
      fontFamily: 'Microsoft YaHei',
      fontSize: 44,
      textColor: '#fffdf6',
      backgroundColor: '#000000',
      position: 'bottom',
      align: 'center',
      maxWidth: 1600,
    };
    const element = SubtitleRenderer({ text: '字幕', style: explicitStyle });
    const children = element!.props.children as Array<{
      props: { fill?: string };
    }>;
    expect(children[0]!.props.fill).toBe('#000000');
  });
});
