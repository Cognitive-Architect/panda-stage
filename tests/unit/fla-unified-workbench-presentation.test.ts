import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import { FlaUnifiedWorkbench } from '../../src/renderer/fla-import/FlaUnifiedWorkbench';
import { createFlaWorkbenchCandidates } from '../../src/renderer/fla-import/fla-workbench-candidates';
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

function sequenceCandidate(status: 'unscanned' | 'checking' | 'verified' | 'error' | 'blank' | 'unsupported') {
  const renderTargetId = `fla-render-target-${status.padEnd(16, '0')}`;
  const entry: FlaRenderableTargetCatalogEntry = {
    target: {
      renderTargetId,
      kind: 'timeline',
      userLabel: '挥剑动作',
      sourceLibraryItemName: '挥剑动作',
      sourceSymbolName: '挥剑动作',
      sourceTimelineIndex: 0,
      frameCount: 30,
      selectedFrameIndex: 0,
      compatibility: [],
    },
    previewSupported: status !== 'unsupported',
    isBlank: status === 'blank',
    ...(status === 'unsupported' ? { unsupportedReason: '不支持此素材。' } : {}),
  };
  const preview = status === 'unscanned' || status === 'blank' || status === 'unsupported'
    ? undefined
    : status === 'verified'
      ? {
          status: 'verified' as const,
          previewUrl: 'blob:sequence-preview',
          sha256: 'b'.repeat(64),
          requestId: '00000000-0000-4000-8000-000000000777',
          startFrameIndex: 0,
          endFrameIndex: 6,
        }
      : status === 'error'
        ? { status: 'error' as const, reason: '生成失败，请重试。' }
        : { status: 'checking' as const };
  const [candidate] = createFlaWorkbenchCandidates({
    context: {
      sessionId: '00000000-0000-4000-8000-000000000778',
      source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
    },
    sequenceEntries: [entry],
    sequencePreviews: preview ? { [renderTargetId]: preview } : undefined,
  });
  if (!candidate) throw new Error(`No sequence candidate for ${status}`);
  return candidate;
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

  it('shows concise sequence readiness without changing candidate eligibility', () => {
    const ready = sequenceCandidate('verified');
    const unscanned = sequenceCandidate('unscanned');
    const checking = sequenceCandidate('checking');
    const failed = sequenceCandidate('error');
    const blank = sequenceCandidate('blank');
    const unsupported = sequenceCandidate('unsupported');
    const readyMarkup = renderWorkbench({
      candidates: [ready],
      focusedCandidateIdentityKey: ready.identityKey,
    });
    const unscannedMarkup = renderWorkbench({ candidates: [unscanned] });
    const checkingMarkup = renderWorkbench({ candidates: [checking] });
    const failedMarkup = renderWorkbench({ candidates: [failed] });
    const blankMarkup = renderWorkbench({ candidates: [blank] });
    const unsupportedMarkup = renderWorkbench({ candidates: [unsupported] });

    expect(ready).toMatchObject({ selectable: true, preview: { status: 'verified', requestId: expect.any(String) } });
    expect(readyMarkup).toContain('<small data-status="verified">已生成</small>');
    expect(readyMarkup).not.toContain('第 1–7 帧已生成');
    expect(readyMarkup).not.toContain('data-testid="fla-c03-focused-status"');
    expect(unscannedMarkup).toContain('<span>可生成</span>');
    expect(unscannedMarkup).toContain('<small data-status="unscanned">可生成</small>');
    expect(unscanned).toMatchObject({ selectable: false, checked: false });
    expect(unscannedMarkup).toMatch(/data-selectable="false"[^>]*>[\s\S]*?disabled/u);
    expect(checkingMarkup).toContain('<span>生成中…</span>');
    expect(checkingMarkup).toContain('<small data-status="checking">生成中…</small>');
    expect(failedMarkup).toContain('<small data-status="error">加载失败</small>');
    expect(blankMarkup).toContain('<small data-status="blank">空白画面</small>');
    expect(unsupportedMarkup).toContain('<small data-status="unsupported">暂无法预览</small>');
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
