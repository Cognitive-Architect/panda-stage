// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';
import {
  createFlaGraphicInstanceWorkbenchCandidates,
  FlaGraphicImportError,
  type EditableFlaGraphicInstancePreview,
} from '../../src/renderer/features/fla-import/fla-graphic-instance-import';
import { FlaGraphicInstanceWorkbench } from '../../src/renderer/fla-import/FlaGraphicInstanceWorkbench';

const SESSION_ID = '00000000-0000-4000-8000-000000001072';
const PLAN_ID = '00000000-0000-4000-8000-000000001073';
const SOURCE_SHA256 = 'b'.repeat(64);
const SOURCE = { basename: 'sample.fla', sha256: SOURCE_SHA256 };
const TARGET_ID = 'render-target-main-scene' as FlaRenderTarget['renderTargetId'];

function part(
  unitId: string,
  occurrenceId: string,
  sourceAddress: string,
  sourceKind: 'graphic-symbol-occurrence' | 'shape-occurrence',
  drawOrder: number,
) {
  const bytes = new Uint8Array([137, 80, 78, drawOrder + 1]);
  return {
    unitId,
    occurrenceId,
    sourceKind,
    sourceSymbolId: sourceKind === 'graphic-symbol-occurrence' ? 'MyGraphic' : null,
    sourceAddress,
    adapterIdentity: sourceKind === 'graphic-symbol-occurrence' ? `adapter-${drawOrder}` : null,
    sourceDefinitionFrameCount: sourceKind === 'graphic-symbol-occurrence' ? drawOrder + 1 : null,
    layerName: `Layer ${drawOrder + 1}`,
    drawOrder,
    graphicInstanceImportable: sourceKind === 'graphic-symbol-occurrence',
    image: {
      width: 1,
      height: 1,
      pixelCount: 1,
      sha256: String(drawOrder + 1).repeat(64),
      byteLength: bytes.byteLength,
      bytes,
    },
  };
}

function readyPreview(generation = 1): EditableFlaGraphicInstancePreview {
  const image = part('part-native', 'occ-aaaaaaaaaaaaaaaaaaaaaaaa', 'native', 'shape-occurrence', 0).image;
  return {
    ok: true,
    status: 'PREVIEW_READY',
    capability: 'EDITABLE_PARTS_READY',
    requestId: '00000000-0000-4000-8000-000000001074',
    sessionId: SESSION_ID,
    generation,
    planId: PLAN_ID,
    poseIdentity: 'c'.repeat(64),
    target: {
      renderTargetId: TARGET_ID,
      userLabel: 'Scene 0',
      frameCount: 1,
      selectedFrameIndex: 0,
    },
    stage: { width: 1, height: 1, pixelCount: 1 },
    nativePreview: image,
    partPreviews: [
      part('part-graphic1', 'occ-111111111111111111111111', 'scene/layer-1/instance-1', 'graphic-symbol-occurrence', 0),
      part('part-shape01', 'occ-aaaaaaaaaaaaaaaaaaaaaaaa', 'scene/layer-2/shape-1', 'shape-occurrence', 1),
      part('part-graphic2', 'occ-222222222222222222222222', 'scene/layer-3/instance-2', 'graphic-symbol-occurrence', 2),
    ],
    reassembledPreview: image,
    metrics: {
      preparedSourceCacheHit: false,
      sourcePreparationCountForRequest: 1,
      displayListResolveCount: 3,
      rasterCount: 0,
      unitCount: 3,
      totalPngBytes: 16,
      elapsedMs: 1,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function previewError(code: string, message: string): EditableFlaGraphicInstancePreview {
  return {
    ok: false,
    error: { code, message },
  } as unknown as EditableFlaGraphicInstancePreview;
}

let container: HTMLDivElement;
let root: Root;
let previewResponse: EditableFlaGraphicInstancePreview;
let partPreview: ReturnType<typeof vi.fn>;
let partPreviewCancel: ReturnType<typeof vi.fn>;
let createdObjectUrls: string[];
let priorPandaStageDescriptor: PropertyDescriptor | undefined;

async function renderWorkbench(props: Partial<React.ComponentProps<typeof FlaGraphicInstanceWorkbench>> = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(FlaGraphicInstanceWorkbench, {
      enabled: true,
      sessionId: SESSION_ID,
      source: SOURCE,
      targetRenderTargetId: TARGET_ID,
      targetLookupPending: false,
      importDisabledReason: null,
      ...props,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function replacePartPreview(next: ReturnType<typeof vi.fn>): void {
  partPreview = next;
  Object.defineProperty(window, 'pandaStage', {
    configurable: true,
    value: { fla: { partPreview, partPreviewCancel } },
  });
}

function click(testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`Missing button ${testId}.`);
  button.click();
}

describe('FLA Graphic occurrence candidate workbench', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    previewResponse = readyPreview();
    partPreview = vi.fn(async (request: { requestId: string; sessionId: string; generation: number }) => ({
      ...previewResponse,
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation: request.generation,
    }));
    partPreviewCancel = vi.fn(async () => undefined);
    priorPandaStageDescriptor = Object.getOwnPropertyDescriptor(window, 'pandaStage');
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: { fla: { partPreview, partPreviewCancel } },
    });
    createdObjectUrls = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:fla-graphic-instance-${createdObjectUrls.length + 1}`;
      createdObjectUrls.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    if (priorPandaStageDescriptor) {
      Object.defineProperty(window, 'pandaStage', priorPandaStageDescriptor);
    } else {
      Reflect.deleteProperty(window, 'pandaStage');
    }
  });

  it('preserves duplicate Graphic source identity and frame count without treating parts as candidates', () => {
    const candidates = createFlaGraphicInstanceWorkbenchCandidates(previewResponse, {
      sessionId: SESSION_ID,
      source: SOURCE,
      renderTargetId: TARGET_ID,
      previewUrls: {},
      focusedIdentityKey: null,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.displayLabel)).toEqual([
      'MyGraphic · 1',
      'MyGraphic · 2',
    ]);
    expect(candidates.map((candidate) => candidate.provenance.sourceAddress)).toEqual([
      'scene/layer-1/instance-1',
      'scene/layer-3/instance-2',
    ]);
    expect(candidates.map((candidate) => candidate.provenance.occurrenceId)).toEqual([
      'occ-111111111111111111111111',
      'occ-222222222222222222222222',
    ]);
    expect(candidates.map((candidate) => candidate.provenance.adapterIdentity)).toEqual([
      'adapter-0',
      'adapter-2',
    ]);
    expect(candidates.map((candidate) => candidate.provenance.sourceSymbolId)).toEqual([
      'MyGraphic',
      'MyGraphic',
    ]);
    expect(candidates.map((candidate) => candidate.provenance.frameCount)).toEqual([1, 3]);
    expect(candidates[0]?.identityKey).not.toBe(candidates[1]?.identityKey);
  });

  it('uses the unified browser search and keeps the selected Main preview aligned with its occurrence', async () => {
    await renderWorkbench();
    const first = container.querySelector<HTMLButtonElement>(
      '[data-testid="fla-graphic-instance-candidate-part-graphic1"]',
    );
    const second = container.querySelector<HTMLButtonElement>(
      '[data-testid="fla-graphic-instance-candidate-part-graphic2"]',
    );
    expect(container.querySelector('[data-testid="fla-c03-multi-select-toggle"]')).toBeNull();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(container.querySelectorAll('.fla-c03-footer-actions button')).toHaveLength(1);
    expect(container.querySelector('[data-testid="fla-graphic-instance-import"]')?.textContent)
      .toBe('导入此元件');
    expect(container.querySelector('[data-testid="fla-graphic-instance-search"]')?.getAttribute('aria-label'))
      .toBe('搜索元件');
    expect(container.querySelector('[data-testid="fla-graphic-instance-candidates"]')?.getAttribute('aria-label'))
      .toBe('元件列表');
    expect(first?.querySelector('.fla-c03-candidate-kind')?.textContent).toBe('元件 · 1 帧');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await act(async () => second!.click());

    let selectedPreview = container.querySelector<HTMLImageElement>(
      '[data-testid="fla-graphic-instance-selected-preview"]',
    );
    expect(selectedPreview?.dataset.occurrenceId).toBe('occ-222222222222222222222222');
    expect(selectedPreview?.dataset.previewCandidateIdentity)
      .toBe(second!.closest('[data-candidate-identity]')?.getAttribute('data-candidate-identity'));
    expect(selectedPreview?.getAttribute('src')).toBe(
      container.querySelector<HTMLImageElement>(
        '[data-testid="fla-graphic-instance-candidate-part-graphic2"] img',
      )?.getAttribute('src'),
    );

    const search = container.querySelector<HTMLInputElement>(
      '[data-testid="fla-graphic-instance-search"]',
    );
    if (!search) throw new Error('Graphic search field is missing.');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('HTMLInputElement.value setter is missing.');
      setter.call(search, 'instance-1');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(search.value).toBe('instance-1');
    expect(container.querySelectorAll('li[data-candidate-kind="graphic"]')).toHaveLength(1);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    selectedPreview = container.querySelector<HTMLImageElement>(
      '[data-testid="fla-graphic-instance-selected-preview"]',
    );
    expect(selectedPreview?.dataset.occurrenceId).toBe('occ-111111111111111111111111');
    expect(selectedPreview?.dataset.previewCandidateIdentity)
      .toBe(first!.closest('[data-candidate-identity]')?.getAttribute('data-candidate-identity'));
    expect(container.querySelector('[data-testid="fla-graphic-instance-import"]')).not.toBeNull();
  });

  it('commits the focused occurrence and retains its preview and selection', async () => {
    const receivedImports: Array<[EditableFlaGraphicInstancePreview, string]> = [];
    const onImportGraphicInstance = vi.fn(async (
      preview: EditableFlaGraphicInstancePreview,
      unitId: string,
    ) => {
      receivedImports.push([preview, unitId]);
    });
    const onImportComplete = vi.fn();
    await renderWorkbench({ onImportGraphicInstance, onImportComplete });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic2'));
    await act(async () => click('fla-graphic-instance-import'));

    expect(onImportGraphicInstance).toHaveBeenCalledTimes(1);
    const importCall = receivedImports[0];
    if (!importCall) throw new Error('Graphic import callback was not invoked.');
    expect(importCall[0].planId).toBe(PLAN_ID);
    expect(importCall[1]).toBe('part-graphic2');
    expect(onImportComplete).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="fla-graphic-instance-selected-preview"]')).not.toBeNull();
    expect(partPreview).toHaveBeenCalledTimes(1);
    expect(partPreviewCancel).not.toHaveBeenCalled();
  });

  it('blocks repeated clicks and retries a save failure without preparing the preview again', async () => {
    const pending = deferred<void>();
    const onImportGraphicInstance = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    await renderWorkbench({ onImportGraphicInstance });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic2'));
    const previewUrl = container.querySelector('[data-testid="fla-graphic-instance-selected-preview"]')?.getAttribute('src');
    await act(async () => {
      click('fla-graphic-instance-import');
      click('fla-graphic-instance-import');
    });
    expect(onImportGraphicInstance).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="fla-c03-import-overlay"]')).not.toBeNull();
    await act(async () => pending.reject(new FlaGraphicImportError('ASSET_COMMIT_FAILED', 'Disk full; retry after freeing space.')));
    expect(container.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-import"]')?.disabled).toBe(false);
    expect(partPreviewCancel).not.toHaveBeenCalled();
    await act(async () => click('fla-graphic-instance-import'));
    expect(onImportGraphicInstance).toHaveBeenCalledTimes(2);
    expect(onImportGraphicInstance.mock.calls[1]).toEqual(onImportGraphicInstance.mock.calls[0]);
    expect(container.querySelector('[data-testid="fla-graphic-instance-selected-preview"]')?.getAttribute('src')).toBe(previewUrl);
    expect(partPreview).toHaveBeenCalledTimes(1);
  });

  it('separates loading, an empty Graphic result, and a failed preview with collapsed diagnostics', async () => {
    const pending = deferred<EditableFlaGraphicInstancePreview>();
    replacePartPreview(vi.fn(() => pending.promise));
    await renderWorkbench();
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-loading"]')?.textContent)
      .toContain('正在加载预览…');

    await act(async () => {
      pending.resolve({
        ...readyPreview(),
        partPreviews: [part('part-shape', 'occ-aaaaaaaaaaaaaaaaaaaaaaaa', 'shape', 'shape-occurrence', 0)],
      });
      await pending.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-empty"]')?.textContent)
      .toContain('未找到元件');
    expect(container.querySelector('[data-testid="fla-graphic-instance-empty-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    replacePartPreview(vi.fn(async () => previewError(
      'UNKNOWN_ERROR',
      'ERR_FAILED (-2) loading http://127.0.0.1:5190/fla-static-snapshot.html; Snapshot rasterization failed',
    )));
    await renderWorkbench();

    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')?.textContent)
      .toContain('预览加载失败');
    const details = container.querySelector<HTMLDetailsElement>(
      '[data-testid="fla-graphic-instance-error-details"]',
    );
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('ERR_FAILED (-2)');
    expect(details?.textContent).toContain('Snapshot rasterization failed');
    const visibleCopy = container.cloneNode(true) as HTMLDivElement;
    visibleCopy.querySelector('details')?.remove();
    expect(visibleCopy.textContent).not.toContain('ERR_FAILED (-2)');
    expect(visibleCopy.textContent).not.toContain('Snapshot rasterization failed');
    expect(container.querySelector('.fla-c03-graphic-retry span')?.textContent).toBe('请重试');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('重试预览')))
      .toBe(false);
    expect(container.textContent).not.toContain('请稍后重试');
    expect(container.querySelector('[data-testid="fla-graphic-instance-reset-preview"]')?.getAttribute('aria-label'))
      .toBe('重置预览');
    expect(container.querySelectorAll('[data-testid="fla-graphic-instance-reset-preview"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="fla-graphic-instance-import"]')?.hasAttribute('disabled'))
      .toBe(true);
    expect(container.querySelectorAll('button')).not.toHaveLength(0);
    expect(container.querySelector('[data-testid="fla-graphic-instance-reimport"]')).toBeNull();
  });

  it('retries a failed preview once, shows loading, and restores candidates on success', async () => {
    const reset = deferred<EditableFlaGraphicInstancePreview>();
    replacePartPreview(vi.fn()
      .mockResolvedValueOnce(previewError('UNKNOWN_ERROR', 'Snapshot rasterization failed'))
      .mockImplementationOnce(() => reset.promise));
    await renderWorkbench();
    const resetButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="fla-graphic-instance-reset-preview"]',
    );
    if (!resetButton) throw new Error('Preview reset button is missing.');

    await act(async () => {
      resetButton.click();
      resetButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(partPreview).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-loading"]')?.textContent)
      .toContain('正在加载预览…');
    expect(container.querySelector('[data-testid="fla-graphic-instance-import"]')?.hasAttribute('disabled'))
      .toBe(true);

    await act(async () => {
      reset.resolve(readyPreview(2));
      await reset.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')).toBeNull();
    expect(container.querySelectorAll('li[data-candidate-kind="graphic"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="fla-graphic-instance-reset-preview"]')).toBeNull();
    expect(container.querySelector('[data-testid="fla-graphic-instance-selected-preview"]')?.getAttribute('src'))
      .toMatch(/^blob:fla-graphic-instance-/u);
  });

  it('releases a failed import plan before resetting and routes an expired session to FLA reimport', async () => {
    const onImportGraphicInstance = vi.fn(async () => {
      throw new FlaGraphicImportError('STALE_PLAN', 'Snapshot rasterization failed');
    });
    await renderWorkbench({ onImportGraphicInstance });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(container.querySelector('[data-testid="fla-graphic-instance-summary"]')?.textContent)
      .toContain('导入失败');
    expect(container.querySelector('[data-testid="fla-graphic-instance-error-details"]')?.textContent)
      .toContain('Snapshot rasterization failed');
    await act(async () => click('fla-graphic-instance-reset-preview'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(partPreview).toHaveBeenCalledTimes(2);
    expect(partPreviewCancel).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      generation: 1,
    }));

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onRequestReimport = vi.fn();
    replacePartPreview(vi.fn(async () => previewError('SESSION_NOT_FOUND', 'FLA session no longer exists')));
    await renderWorkbench({ onRequestReimport });
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')?.textContent)
      .toContain('FLA 会话已失效');
    expect(container.querySelector('[data-testid="fla-graphic-instance-reset-preview"]')).toBeNull();
    expect(container.querySelector('[data-testid="fla-graphic-instance-reimport"]')?.textContent)
      .toBe('重新导入 FLA');
    await act(async () => click('fla-graphic-instance-reimport'));
    expect(onRequestReimport).toHaveBeenCalledTimes(1);
  });
});
