import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const controlsSource = readFileSync(
  'src/renderer/features/subtitles/SubtitleStyleControls.tsx',
  'utf8',
);
const stylesSource = readFileSync('src/renderer/styles.css', 'utf8');

describe('Issue #521 subtitle-style final visual polish', () => {
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

    expect(controlsSource).toContain('文字色');
    expect(controlsSource).toContain('dialogue-subtitle-style-main-label');
    expect(controlsSource).not.toContain('subtitle-style-shared-badge');
    expect(controlsSource).not.toContain('同样式字幕同步');
    expect(controlsSource).toContain('dialogue-subtitle-style-toggle-track');
    expect(controlsSource).toContain('dialogue-subtitle-style-toggle-thumb');
    expect(controlsSource).toContain(
      'dialogue-subtitle-style-subordinate-label',
    );
    expect(controlsSource).toContain('粗细');
    expect(controlsSource).toContain('颜色');
    expect(controlsSource).toContain('aria-disabled={!outlineEnabled}');
  });

  it('uses compact horizontal rows while retaining touch-sized controls', () => {
    const issue520Styles = stylesSource.slice(
      stylesSource.indexOf('/* Issue #521:'),
    );

    expect(issue520Styles).toContain(
      '.dialogue-subtitle-style-primary-row',
    );
    expect(issue520Styles).toContain(
      'grid-template-columns: minmax(0, 1fr) auto',
    );
    expect(issue520Styles).toContain(
      '.dialogue-subtitle-style-outline-row',
    );
    expect(issue520Styles).toContain(
      'grid-template-columns: 52px 38px minmax(0, 1fr)',
    );
    expect(issue520Styles).toContain(
      'grid-template-columns: minmax(104px, 116px) 36px',
    );
    expect(issue520Styles).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    );
    expect(issue520Styles).toContain(
      'grid-template-columns: 36px minmax(44px, 1fr) 36px',
    );
    expect(issue520Styles).toContain('gap: 12px');
    expect(issue520Styles).toContain('gap: 0');
    expect(issue520Styles).toContain('width: min(232px, 100%)');
    expect(issue520Styles).toContain('border-radius: var(--ui-radius-medium, 10px)');
    expect(issue520Styles).toContain(
      '.dialogue-subtitle-style-position-control button + button',
    );
    expect(issue520Styles).toContain('border-left: 1px solid');
    expect(issue520Styles).toContain('grid-template-columns: 52px minmax(0, 1fr)');
    expect(issue520Styles).toContain('padding-left: 10px');
    expect(issue520Styles).toContain('border-left: 1px solid');
    expect(issue520Styles).toContain(
      '.dialogue-subtitle-style-toggle-track',
    );
    expect(issue520Styles).toContain('width: 36px !important');
    expect(issue520Styles).toContain('height: 36px !important');
    expect(issue520Styles).toContain('min-height: 38px !important');
    expect(issue520Styles).not.toContain('min-width: 148px');
  });
});
