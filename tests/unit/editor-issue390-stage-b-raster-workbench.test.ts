import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const issue390Styles = styles.slice(styles.indexOf('/* Issue #390:'));
const route = readFileSync('src/renderer/fla-import/fla-content-route.ts', 'utf8');
const card = component.slice(
  component.indexOf('function FlaReviewMediaCard'),
  component.indexOf('function FlaReviewMediaDetail'),
);
const detail = component.slice(
  component.indexOf('function FlaReviewMediaDetail'),
  component.indexOf('function isNestedInteractiveTarget'),
);

describe('Issue #390 Stage B direct-raster Workbench contract', () => {
  it('composes the raster route as one three-zone landscape workbench', () => {
    expect(component).toContain("data-workbench-route={rasterRoute ? 'raster' : 'render'}");
    expect(component).toContain('data-testid="fla-raster-workbench"');
    expect(component).toContain('data-testid="fla-raster-overview"');
    expect(component).toContain('data-testid="fla-raster-selection"');
    expect(component).toContain('data-testid="fla-raster-detail"');
    expect(component).toContain('const usedMediaCount = reviewItems.filter((item) => !item.libraryOnly).length;');
    expect(component).toContain('{usedMediaCount} 已使用 · {libraryOnlyMediaCount} 仅素材库');
    expect(component.indexOf('data-testid="fla-raster-overview"')).toBeLessThan(
      component.indexOf('data-testid="fla-raster-selection"'),
    );
    expect(component.indexOf('data-testid="fla-raster-selection"')).toBeLessThan(
      component.indexOf('data-testid="fla-raster-detail"'),
    );
    expect(issue390Styles).toMatch(
      /\.fla-raster-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(180px, 0\.72fr\) minmax\(460px, 2fr\) minmax\(240px, 0\.94fr\);/u,
    );
  });

  it('keeps the grid thumbnail-first and moves engineering facts into contextual detail', () => {
    expect(card).toContain('className="fla-review-thumbnail"');
    expect(card).toContain('{media.name}');
    expect(card).toContain("item.libraryOnly ? '仅素材库' : '已使用'");
    expect(card).not.toContain('media.sourceReference}');
    expect(card).not.toContain('目标文件名：');
    expect(card).not.toContain('fla-review-name-warnings');
    expect(detail).toContain('className="fla-review-detail-preview"');
    expect(detail).toContain('{media.sourceReference}');
    expect(detail).toContain('{item.name.targetFileName}');
    expect(detail).toContain('className="fla-review-detail-warnings"');
  });

  it('preserves default selection and keyboard selection while adding focused detail', () => {
    expect(component).toContain('new Set(nextResponse.ir.media.map((media) => media.id))');
    expect(component).toContain('setFocusedMediaId(nextResponse.ir.media[0]?.id ?? null)');
    expect(component).toContain('onFocus={() => setFocusedMediaId(item.media.id)}');
    expect(card).toContain('onClickCapture={onFocus}');
    expect(card).toContain('onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) =>');
    expect(card).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(card).toContain('aria-pressed={selected}');
  });

  it('shows stable progress and exactly one state-bound dominant CTA', () => {
    expect(component).toContain('className="fla-workbench-progress"');
    expect(component).toContain('选择素材</li>');
    expect(component).toContain('确认选择</li>');
    expect(component).toContain('导入素材</li>');
    expect(component).toContain("phase === 'ready' ? (");
    expect(component).toContain('className="fla-review-primary-action"');
    expect(component).toContain('确认 {selectedCount} 项');
    expect(component).toContain("intent && phase === 'confirmed' ? (");
    expect(component).toContain('className="fla-review-commit-primary fla-review-primary-action"');
    expect(component).toContain('导入这 {intent.selectedCount} 项');
  });

  it('retains one review scroll owner and all FLA business boundaries', () => {
    expect(issue390Styles).toContain('The review body remains the only wheel-scroll owner');
    expect(issue390Styles).toMatch(
      /\.fla-review-session\[data-workbench-route='raster'\] \.fla-review-body\s*\{[\s\S]*?padding:/u,
    );
    expect(issue390Styles).not.toMatch(/\.fla-raster-workbench\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(issue390Styles).not.toMatch(/\.fla-raster-selection\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(route).toContain('response.ir.media.length > 0');
    expect(route).toContain("? 'v1-raster-review'");
    expect(component).toContain('createFlaRasterSelectionIntent');
    expect(component).toContain('window.pandaStage.fla.commitSelected');
    expect(component).toContain('confirmed: true');
    expect(component).not.toContain('updateProject');
    expect(component).not.toContain('window.pandaStage.assets');
  });
});
