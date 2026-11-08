import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('EF-03 Batch Adjust action scope contract', () => {
  it('adds a 对白 / 动作 switch to the existing Batch Adjust drawer page', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(drawer).toContain('data-testid="batch-adjust-scope-dialogue"');
    expect(drawer).toContain('data-testid="batch-adjust-scope-action"');
    expect(drawer).toMatch(/对白\s*<\/button>/u);
    expect(drawer).toMatch(/动作\s*<\/button>/u);
    // AUTO-02 stays the default scope and keeps its own panel untouched.
    expect(drawer).toContain("useState<BatchAdjustScope>('dialogue')");
    expect(drawer).toContain('<BatchDialogueMovePanel');
    expect(drawer).toContain('<BatchTimelineEventPanel');
    // The drawer stays a presentation launcher; it never commits Project data.
    expect(drawer).not.toContain('updateProject');
  });

  it('keeps the action panel a thin view over one Store call', () => {
    const panel = source(
      'src/renderer/features/timeline/BatchTimelineEventPanel.tsx',
    );

    expect(panel).toContain('timelineBatchStore.plan');
    expect(panel).toContain('timelineBatchStore.apply');
    expect(panel).not.toContain('updateProject');
    expect(panel).not.toContain('new TimelineEventBatchService');
    // Timeline selection stays local: no global selection store is touched.
    expect(panel).not.toContain('selectionStore');
    expect(panel).toContain('type="checkbox"');
    expect(panel).toContain('data-testid="batch-timeline-amount"');
    expect(panel).toContain('data-testid="batch-timeline-scope-shift"');
    expect(panel).toContain('data-testid="batch-timeline-scope-unify"');
    expect(panel).toContain('data-testid="batch-timeline-impact"');
    expect(panel).toContain('data-testid="batch-timeline-apply"');
    expect(panel).toContain('应用调整');
    // Exactly one primary action, and it is disabled until the batch is legal.
    expect(panel.match(/variant="primary"/gu)).toHaveLength(1);
    expect(panel).toContain('disabled={!canApply}');
    // The supported kinds come from the domain, not a second local list.
    expect(panel).toContain('BATCH_EDITABLE_EVENT_TYPES');
    // No new frame-rate constant is invented for the seconds field.
    expect(panel).not.toMatch(/\b(24|25|30)\s*(?:fps|FPS)\b/u);
  });

  it('owns the batch rules in the domain service, not in the panel', () => {
    const service = source('src/domain/services/TimelineEventBatchService.ts');
    const barrel = source('src/domain/services/index.ts');

    expect(barrel).toContain("export * from './TimelineEventBatchService'");
    expect(service).toContain('plan(');
    expect(service).toContain('apply(');
    expect(service).toContain('TIMELINE_EVENT_OVERLAP');
    expect(service).toContain('TIMELINE_EVENT_ORDER_REVERSED');
    expect(service).toContain('TIMELINE_EVENT_UNSUPPORTED');
    // The evaluator itself is never rewritten by this seam.
    expect(service).not.toContain('evaluateShotAtTime');
  });

  it('registers the extended Batch Adjust stylesheet once', () => {
    const entry = readFileSync('src/renderer/styles.css', 'utf8').replace(
      /\r\n/gu,
      '\n',
    );
    const imports = entry.match(/s18-01--batch-adjust-tool\.css/gu) ?? [];
    const css = source('src/renderer/styles/shell/tools/s18-01--batch-adjust-tool.css');

    expect(imports).toHaveLength(1);
    expect(css).toContain('.batch-adjust-scope');
    expect(css).toContain('.batch-timeline-scope');
    expect(css).toContain('.batch-adjust-apply');
  });
});
