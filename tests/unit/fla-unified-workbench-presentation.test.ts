import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlaUnifiedWorkbench } from '../../src/renderer/fla-import/FlaUnifiedWorkbench';
import type { FlaUnifiedImportReceipt } from '../../src/renderer/fla-import/fla-unified-import';

type WorkbenchProps = Parameters<typeof FlaUnifiedWorkbench>[0];

const baseProps: WorkbenchProps = {
  candidates: [],
  focusedCandidateIdentityKey: null,
  searchText: '',
  selectedOnly: false,
  selectedCount: 0,
  locked: false,
  canImport: false,
  importing: false,
  stopAfterCurrentRequested: false,
  bulkConfirmationOpen: false,
  newEligibleCount: 0,
  progress: { phase: 'ready', completed: 0, total: 0, omittedCandidateCount: 0 },
  receipt: null,
  showSnapshotPreview: false,
  showSequencePreview: false,
  snapshotPreview: null,
  sequencePreview: null,
  onSearchTextChange: () => undefined,
  onToggleSelectedOnly: () => undefined,
  onFocusCandidate: () => undefined,
  onToggleCandidate: () => undefined,
  onSelectCurrentResults: () => undefined,
  onConfirmBulkSelection: () => undefined,
  onCancelBulkSelection: () => undefined,
  onClearSelection: () => undefined,
  onImport: () => undefined,
  onStopAfterCurrent: () => undefined,
};

function renderWorkbench(overrides: Partial<WorkbenchProps> = {}): string {
  return renderToStaticMarkup(createElement(FlaUnifiedWorkbench, { ...baseProps, ...overrides }));
}

function failedReceipt(message: string): FlaUnifiedImportReceipt {
  return {
    selectedCount: 1,
    items: [{
      key: 'snapshot:1',
      kind: 'snapshot',
      identityKey: 'snapshot-1',
      label: 'sample.png',
      status: 'failed',
      message,
    }],
    counts: {
      imported: 0,
      duplicate: 0,
      failed: 1,
      notAttempted: 0,
      importedAssets: 0,
      duplicateAssets: 0,
    },
    partial: true,
    cancelled: false,
    warnings: [message],
    snapshot: {} as FlaUnifiedImportReceipt['snapshot'],
  };
}

describe('Issue #778 unified FLA workbench presentation', () => {
  it('states that bulk confirmation only checks candidates', () => {
    const markup = renderWorkbench({ bulkConfirmationOpen: true, newEligibleCount: 398 });

    expect(markup).toContain('即将勾选 398 项素材，暂不会导入。');
    expect(markup).toContain('确认勾选');
    expect(markup).not.toContain('将添加 398');
  });

  it('explains that search is paused in the selected-only view while retaining the query', () => {
    const markup = renderWorkbench({ searchText: 'blue sleeve', selectedOnly: true, selectedCount: 1 });

    expect(markup).toContain('正在查看已选 · 搜索已暂停');
    expect(markup).toContain('value="blue sleeve"');
    expect(markup).toContain('>返回浏览</button>');
    expect(markup).toContain('还没有已选择的素材。');
  });

  it('keeps toolbar labels compact and truthful, and preserves reset and import semantics', () => {
    const emptyMarkup = renderWorkbench();
    const selectedMarkup = renderWorkbench({ selectedCount: 3 });

    expect(emptyMarkup).toContain('aria-label="全选当前结果"');
    expect(emptyMarkup).toContain('>全选</button>');
    expect(emptyMarkup).toContain('aria-label="清空全部已选素材"');
    expect(emptyMarkup).toContain('>清空</button>');
    expect(selectedMarkup).toContain('aria-label="查看已选 3"');
    expect(selectedMarkup).toContain('>已选 3</button>');
    expect(emptyMarkup).toContain('aria-label="恢复默认预览大小"');
    expect(emptyMarkup).toContain('title="恢复默认预览大小"');
    expect(emptyMarkup).toContain('>适中</button>');
    expect(emptyMarkup).toContain('>导入 0 项</button>');
    expect(emptyMarkup).toMatch(/data-testid="fla-unified-import"[^>]*disabled/u);
  });

  it('places sequence controls in a sibling region below the canvas', () => {
    const marker = createElement('div', { 'data-testid': 'sequence-preview-marker' });
    const markup = renderWorkbench({
      showSequencePreview: true,
      sequencePreview: marker,
    });
    const canvasIndex = markup.indexOf('data-testid="fla-c03-preview-stage"');
    const controlsSlotIndex = markup.indexOf('data-testid="fla-c03-sequence-preview-slot"');
    const markerIndex = markup.indexOf('data-testid="sequence-preview-marker"');

    expect(canvasIndex).toBeGreaterThanOrEqual(0);
    expect(controlsSlotIndex).toBeGreaterThan(canvasIndex);
    expect(markerIndex).toBeGreaterThan(controlsSlotIndex);
    expect(markup.slice(canvasIndex, controlsSlotIndex)).not.toContain('sequence-preview-marker');
  });

  it('keeps an ordinary snapshot preview in the canvas when sequence controls are inactive', () => {
    const marker = createElement('div', { 'data-testid': 'snapshot-preview-marker' });
    const markup = renderWorkbench({
      showSnapshotPreview: true,
      snapshotPreview: marker,
    });
    const canvasIndex = markup.indexOf('data-testid="fla-c03-preview-stage"');
    const snapshotIndex = markup.indexOf('data-testid="snapshot-preview-marker"');
    const sequenceSlotIndex = markup.indexOf('data-testid="fla-c03-sequence-preview-slot"');

    expect(markup).toContain('data-sequence-canvas="false"');
    expect(markup).toContain('data-sequence-preview="false"');
    expect(canvasIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(canvasIndex);
    expect(snapshotIndex).toBeLessThan(sequenceSlotIndex);
    expect(markup.slice(sequenceSlotIndex)).toMatch(/fla-c03-sequence-preview-slot" hidden=/u);
  });

  it('shows safe failure guidance and keeps raw receipt diagnostics in a collapsed disclosure', () => {
    const rawMessage = 'Error invoking remote method: asset-id-42';
    const markup = renderWorkbench({ receipt: failedReceipt(rawMessage) });
    const diagnosticsStart = markup.indexOf('<details class="fla-c03-receipt-diagnostics"');
    const diagnosticsOpenTag = markup.match(/<details class="fla-c03-receipt-diagnostics"[^>]*>/u)?.[0];

    expect(markup).toContain('请先检查素材库，避免重复导入。');
    expect(diagnosticsStart).toBeGreaterThan(0);
    expect(markup.slice(0, diagnosticsStart)).not.toContain(rawMessage);
    expect(diagnosticsOpenTag).toBeDefined();
    expect(diagnosticsOpenTag).not.toContain(' open');
    expect(markup.slice(diagnosticsStart)).toContain(`<code>${rawMessage}</code>`);
  });
});
