import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const controlsSource = readFileSync(
  'src/renderer/features/subtitles/SubtitleStyleControls.tsx',
  'utf8',
);
const stylesSource = readFileSync('src/renderer/styles.css', 'utf8');

describe('Issue #517 subtitle-style density polish', () => {
  it('keeps the always-expanded controls in the approved three-row grouping', () => {
    const primaryStart = controlsSource.indexOf(
      'dialogue-subtitle-style-primary-row',
    );
    const outlineStart = controlsSource.indexOf(
      'dialogue-subtitle-style-outline-row',
    );
    const positionStart = controlsSource.indexOf(
      'dialogue-subtitle-style-position-row',
    );

    expect(primaryStart).toBeGreaterThan(-1);
    expect(outlineStart).toBeGreaterThan(primaryStart);
    expect(positionStart).toBeGreaterThan(outlineStart);

    const primaryRow = controlsSource.slice(primaryStart, outlineStart);
    const outlineRow = controlsSource.slice(outlineStart, positionStart);
    const positionRow = controlsSource.slice(positionStart);

    expect(primaryRow).toContain('subtitle-style-font-size-control');
    expect(primaryRow).toContain('subtitle-style-text-color');
    expect(outlineRow).toContain('subtitle-style-stroke-toggle');
    expect(outlineRow).toContain('subtitle-style-stroke-width-control');
    expect(outlineRow).toContain('subtitle-style-stroke-color');
    expect(positionRow).toContain('POSITIONS.map');
    expect(positionRow).toContain('data-testid={`subtitle-style-position-${position}`}');
    expect(controlsSource).toContain("top: '顶部'");
    expect(controlsSource).toContain("center: '中间'");
    expect(controlsSource).toContain("bottom: '底部'");

    expect(controlsSource).toContain('同样式字幕同步');
    expect(controlsSource).not.toContain('使用此样式的字幕会同步更新');
    expect(controlsSource).toContain('aria-disabled={!outlineEnabled}');
  });

  it('uses compact horizontal rows while retaining touch-sized controls', () => {
    const issue517Styles = stylesSource.slice(
      stylesSource.indexOf('/* Issue #517:'),
    );

    expect(issue517Styles).toContain(
      '.dialogue-subtitle-style-primary-row',
    );
    expect(issue517Styles).toContain(
      'grid-template-columns: minmax(0, 1fr) auto',
    );
    expect(issue517Styles).toContain(
      '.dialogue-subtitle-style-outline-row',
    );
    expect(issue517Styles).toContain(
      'grid-template-columns: auto auto minmax(0, 1fr)',
    );
    expect(issue517Styles).toContain(
      'grid-template-columns: minmax(104px, 1fr) 40px',
    );
    expect(issue517Styles).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    );
    expect(issue517Styles).toContain('min-height: 40px !important');
    expect(issue517Styles).toContain('min-height: 38px !important');
    expect(issue517Styles).not.toContain('min-width: 148px');
  });
});
