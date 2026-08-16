import { Group, Rect, Text } from 'react-konva';
import { PROJECT_HEIGHT, type SubtitleStyle } from '../../../domain';
import { STAGE_CAPTION_SAFE_AREA } from '../../../shared/stage/layout';
import {
  DEFAULT_SUBTITLE_STYLE,
  layoutSubtitleText,
  subtitleStyleOrDefault,
} from '../../../shared/preview/subtitle-layout';

export interface SubtitleRendererProps {
  text: string | null;
  style?: SubtitleStyle;
}

function subtitleY(position: SubtitleStyle['position']): number {
  if (position === 'top') return 40;
  if (position === 'center') {
    return (PROJECT_HEIGHT - STAGE_CAPTION_SAFE_AREA.height) / 2;
  }
  return STAGE_CAPTION_SAFE_AREA.y;
}

/** Shared, non-listening Konva subtitle projection for editor and preview. */
export function SubtitleRenderer({
  text,
  style,
}: SubtitleRendererProps): React.JSX.Element | null {
  if (!text?.trim()) return null;
  const resolvedStyle = subtitleStyleOrDefault(style);
  const layout = layoutSubtitleText(text, resolvedStyle);
  if (!layout.text) return null;
  const y = subtitleY(resolvedStyle.position);
  const x = STAGE_CAPTION_SAFE_AREA.x;
  const textWidth = layout.width;
  const backgroundHeight = STAGE_CAPTION_SAFE_AREA.height;

  return (
    <Group
      listening={false}
      name="subtitle-renderer"
      opacity={1}
    >
      <Rect
        cornerRadius={34}
        fill={resolvedStyle.backgroundColor ?? DEFAULT_SUBTITLE_STYLE.backgroundColor}
        height={backgroundHeight}
        listening={false}
        width={STAGE_CAPTION_SAFE_AREA.width}
        x={x}
        y={y}
      />
      <Text
        align={resolvedStyle.align}
        fill={resolvedStyle.textColor ?? DEFAULT_SUBTITLE_STYLE.textColor}
        fontFamily={resolvedStyle.fontFamily ?? DEFAULT_SUBTITLE_STYLE.fontFamily}
        fontSize={layout.fontSize}
        height={backgroundHeight - STAGE_CAPTION_SAFE_AREA.verticalPadding * 2}
        listening={false}
        lineHeight={1.25}
        name={layout.truncated ? 'subtitle-text-warning' : 'subtitle-text'}
        padding={0}
        text={layout.text}
        verticalAlign="middle"
        width={textWidth}
        x={x + (STAGE_CAPTION_SAFE_AREA.width - textWidth) / 2}
        y={y + STAGE_CAPTION_SAFE_AREA.verticalPadding}
      />
    </Group>
  );
}
