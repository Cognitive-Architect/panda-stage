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
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject } from './domain/testProject';

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
    vi.useRealTimers();
    editorProjectStore.clear();
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

  it('confirms a completed import once in a floating status and dismisses it after three seconds (#1108)', async () => {
    const pending = deferred<void>();
    const onImportComplete = vi.fn();
    await renderWorkbench({ onImportGraphicInstance: () => pending.promise, onImportComplete });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
    vi.useFakeTimers();
    await act(async () => pending.resolve());
    const notice = document.querySelector('[data-testid="fla-graphic-instance-success"]');
    expect(notice?.textContent).toBe('已导入元件');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.parentElement).toBe(document.body);
    expect(notice?.querySelector('button')).toBeNull();
    expect(container.querySelector('.fla-c03-import-footer')?.textContent).not.toContain('已导入元件');
    expect(onImportComplete).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBe(notice);
    await act(async () => vi.advanceTimersByTime(1));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
  });

  it('inherits hover/focus pause and resumes only when both have left the confirmation', async () => {
    await renderWorkbench({ onImportGraphicInstance: async () => undefined });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    vi.useFakeTimers();
    await act(async () => click('fla-graphic-instance-import'));
    const notice = document.querySelector<HTMLOutputElement>('[data-testid="fla-graphic-instance-success"]')!;
    await act(async () => vi.advanceTimersByTime(1_000));
    await act(async () => {
      notice.dispatchEvent(new Event('pointerover', { bubbles: true }));
      notice.focus();
    });
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBe(notice);
    await act(async () => notice.dispatchEvent(new Event('pointerout', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBe(notice);
    await act(async () => notice.blur());
    await act(async () => vi.advanceTimersByTime(1_999));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBe(notice);
    await act(async () => vi.advanceTimersByTime(1));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
  });

  it.each([
    { dirty: false, hasShot: true },
    { dirty: true, hasShot: false },
  ])('confirms success for dirty=$dirty hasShot=$hasShot without persisting feedback', async ({ dirty, hasShot }) => {
    const project = buildProject();
    editorProjectStore.open('D:\\acceptance\\issue1108.pandastage', { ...project, shots: hasShot ? project.shots : [] });
    if (dirty) editorProjectStore.updateProject({ ...editorProjectStore.getSnapshot()!.project, name: 'Unsaved edits' });
    const before = editorProjectStore.getSnapshot();
    const onImportGraphicInstance = vi.fn(async () => {
      expect(editorProjectStore.getSnapshot()?.dirty).toBe(dirty);
      expect(Boolean(editorProjectStore.getSnapshot()?.project.shots.length)).toBe(hasShot);
    });
    await renderWorkbench({ onImportGraphicInstance });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(onImportGraphicInstance).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-testid="fla-graphic-instance-success"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')?.textContent).toBe('已导入元件');
    expect(editorProjectStore.getSnapshot()).toBe(before);
  });

  it('replaces the confirmation for repeated successful reuse and clears it before a later failure', async () => {
    const onImportComplete = vi.fn();
    const onImportGraphicInstance = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new FlaGraphicImportError('ASSET_COMMIT_FAILED', 'Disk full'));
    await renderWorkbench({ onImportGraphicInstance, onImportComplete });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    vi.useFakeTimers();
    await act(async () => click('fla-graphic-instance-import'));
    await act(async () => vi.advanceTimersByTime(2_000));
    await act(async () => click('fla-graphic-instance-import'));
    expect(document.querySelectorAll('[data-testid="fla-graphic-instance-success"]')).toHaveLength(1);
    expect(onImportComplete).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(document.querySelectorAll('[data-testid="fla-graphic-instance-success"]')).toHaveLength(1);
    await act(async () => click('fla-graphic-instance-import'));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')?.textContent).toContain('导入失败');
    expect(onImportComplete).toHaveBeenCalledTimes(2);
    expect(partPreview).toHaveBeenCalledOnce();
  });

  it.each([
    'ASSET_COMMIT_FAILED', 'ROLLBACK_FAILED', 'STALE_PROJECT_REVISION', 'STALE_PLAN',
    'PROJECT_NOT_TRACKED', 'UNSUPPORTED_SOURCE',
  ] as const)('does not confirm an unsuccessful %s import', async (code) => {
    const onImportComplete = vi.fn();
    await renderWorkbench({
      onImportGraphicInstance: async () => { throw new FlaGraphicImportError(code, 'Rejected commit'); },
      onImportComplete,
    });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')).not.toBeNull();
  });

  it('does not confirm a cancelled operation', async () => {
    await renderWorkbench({ onImportGraphicInstance: async () => { throw new Error('Import cancelled'); } });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(document.querySelector('[data-testid="fla-graphic-instance-success"]')).toBeNull();
  });

  it('keeps rollback recovery persistent without reset or another commit, and directs Project reopen (#1107)', async () => {
    const onImportGraphicInstance = vi.fn(async () => {
      throw new FlaGraphicImportError('ROLLBACK_FAILED', 'Project rollback left residual files');
    });
    const onRecoveryRequired = vi.fn();
    await renderWorkbench({ onImportGraphicInstance, onRecoveryRequired });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(onRecoveryRequired).toHaveBeenCalledOnce();
    const failure = container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]');
    expect(failure?.textContent).toContain('导入未能安全恢复');
    expect(failure?.textContent).toContain('重新打开当前项目');
    expect(failure?.textContent).not.toContain('请重试');
    expect(failure?.querySelector('button')).toBeNull();
    expect(failure?.querySelector('details')?.open).toBe(false);
    expect(failure?.querySelector('pre')?.textContent).toContain('residual files');
    await act(async () => {
      click('fla-graphic-instance-candidate-part-graphic2');
      click('fla-graphic-instance-import');
    });
    expect(onImportGraphicInstance).toHaveBeenCalledOnce();
    expect(partPreview).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')).toBe(failure);
  });

  it('submits one source-addressed Graphic from the Graphic preview request', async () => {
    const onImportGraphicInstance = vi.fn(async () => {});
    replacePartPreview(vi.fn(async () => ({
      ...readyPreview(),
      capability: 'GRAPHIC_INSTANCES_READY',
      partPreviews: [readyPreview().partPreviews[0]],
      reassembledPreview: null,
    })));
    await renderWorkbench({ onImportGraphicInstance });
    expect(partPreview).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'graphic-instance' }));
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-import'));
    expect(onImportGraphicInstance).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'GRAPHIC_INSTANCES_READY', planId: PLAN_ID }),
      'part-graphic1',
    );
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
    const retry = container.querySelector('[data-testid="fla-graphic-instance-reset-preview"]');
    expect(retry?.textContent).toBe('请重试');
    expect(retry?.querySelector('svg')).not.toBeNull();
    expect(retry?.closest('.fla-preview-failure-body')?.querySelector('strong')?.textContent).toBe('预览加载失败');
    expect(retry?.closest('.fla-c03-import-footer')).toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('重试预览')))
      .toBe(false);
    expect(container.textContent).not.toContain('请稍后重试');
    expect(container.querySelector('[data-testid="fla-graphic-instance-reset-preview"]')?.getAttribute('aria-label'))
      .toBe('请重试');
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
    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')?.textContent)
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

  it('creates an adaptive character from the selected Graphic without altering 导入此元件 (#1203 V1-B)', async () => {
    const pendingCreate = deferred<{
      ok: true;
      animationId: string;
      characterId: string;
      characterName: string;
      partCount: number;
      skipped: readonly [];
      warnings: readonly [];
    }>();
    const onCreateCharacterFromGraphic = vi.fn()
      .mockImplementationOnce(() => pendingCreate.promise);
    const onCharacterCreated = vi.fn();
    const onImportGraphicInstance = vi.fn(async () => undefined);
    const onImportingChange = vi.fn();

    await renderWorkbench({
      onImportGraphicInstance,
      onCreateCharacterFromGraphic,
      onCharacterCreated,
      onImportingChange,
    });

    const createButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="fla-graphic-instance-create-character"]',
    );
    const importButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="fla-graphic-instance-import"]',
    );
    expect(createButton).not.toBeNull();
    expect(createButton?.textContent).toBe('创建为角色');
    expect(createButton?.disabled).toBe(true);
    expect(importButton?.textContent).toBe('导入此元件');

    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    expect(createButton?.disabled).toBe(false);
    expect(importButton?.disabled).toBe(false);

    await act(async () => {
      click('fla-graphic-instance-create-character');
      click('fla-graphic-instance-create-character');
    });
    expect(onCreateCharacterFromGraphic).toHaveBeenCalledTimes(1);
    expect(onCreateCharacterFromGraphic).toHaveBeenCalledWith(expect.objectContaining({
      unitId: 'part-graphic1',
      characterName: 'MyGraphic',
      poseFrameOrdinal: 0,
    }));
    expect(onImportingChange).toHaveBeenCalledWith(true);

    await act(async () => {
      pendingCreate.resolve({
        ok: true,
        animationId: 'anim-1',
        characterId: 'char-1',
        characterName: 'MyGraphic',
        partCount: 12,
        skipped: [],
        warnings: [],
      });
      await pendingCreate.promise;
    });

    expect(onImportingChange).toHaveBeenLastCalledWith(false);
    expect(onCharacterCreated).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      characterId: 'char-1',
      partCount: 12,
    }));

    // Existing "导入此元件" still works normally alongside "创建为角色".
    await act(async () => click('fla-graphic-instance-import'));
    expect(onImportGraphicInstance).toHaveBeenCalledTimes(1);
  });

  it('preserves saved Definition animationId and reuses it on retry after character creation failure (#1203 V1-B)', async () => {
    const onCreateCharacterFromGraphic = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        kind: 'character-create-failed' as const,
        animationId: 'anim-saved-1',
        message: '角色写入失败，请重试。',
      })
      .mockResolvedValueOnce({
        ok: true as const,
        animationId: 'anim-saved-1',
        characterId: 'char-retried-1',
        characterName: 'MyGraphic',
        partCount: 10,
        skipped: [],
        warnings: [],
      });
    const onCharacterCreated = vi.fn();

    await renderWorkbench({
      onCreateCharacterFromGraphic,
      onCharacterCreated,
    });
    await act(async () => click('fla-graphic-instance-candidate-part-graphic1'));
    await act(async () => click('fla-graphic-instance-create-character'));

    expect(container.querySelector('[data-testid="fla-graphic-instance-preview-failure"]')?.textContent)
      .toContain('导入失败');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')?.disabled)
      .toBe(false);

    await act(async () => click('fla-graphic-instance-create-character'));
    expect(onCreateCharacterFromGraphic).toHaveBeenCalledTimes(2);
    expect(onCreateCharacterFromGraphic.mock.calls[1]?.[0]).toMatchObject({
      unitId: 'part-graphic1',
      reusedAnimationId: 'anim-saved-1',
    });
    expect(onCharacterCreated).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 'char-retried-1',
    }));
    expect(partPreview).toHaveBeenCalledTimes(1);
  });
});
