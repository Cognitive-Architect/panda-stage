import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const controlsSource = readFileSync(
  'src/renderer/features/subtitles/SubtitleStyleControls.tsx',
  'utf8',
);
const stylesSource = readOrderedStylesheetSource();

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
    const issue521Styles = stylesSource.slice(
      stylesSource.indexOf('/* Issue #521:'),
    );

    expect(issue521Styles).toContain(
      '.dialogue-subtitle-style-primary-row',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: minmax(0, 1fr) auto',
    );
    expect(issue521Styles).toContain(
      '.dialogue-subtitle-style-outline-row',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: 52px 38px minmax(0, 1fr)',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: minmax(0, 1fr) auto',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: 36px minmax(44px, 1fr) 36px',
    );
    expect(issue521Styles).toContain(
      'grid-template-columns: 36px minmax(0, 1fr) 36px',
    );
    expect(issue521Styles).toContain('gap: 12px');
    expect(issue521Styles).toContain('gap: 0');
    expect(issue521Styles).toContain('width: min(232px, 100%)');
    expect(issue521Styles).toContain('border-radius: var(--ui-radius-medium, 10px)');
    expect(issue521Styles).toContain(
      '.dialogue-subtitle-style-position-control button + button',
    );
    expect(issue521Styles).toContain('border-left: 1px solid');
    expect(issue521Styles).toContain('grid-template-columns: 52px minmax(0, 1fr)');
    expect(issue521Styles).toContain('padding-left: 10px');
    expect(issue521Styles).toContain(
      '.dialogue-subtitle-style-toggle-track',
    );
    expect(issue521Styles).toContain('width: 36px !important');
    expect(issue521Styles).toContain('height: 36px !important');
    expect(issue521Styles).toContain('min-height: 38px !important');
    expect(issue521Styles).not.toContain('min-width: 148px');
  });
});
