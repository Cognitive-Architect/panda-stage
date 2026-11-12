// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';
import {
  createFlaGraphicInstanceWorkbenchCandidates,
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

function readyPreview(): EditableFlaGraphicInstancePreview {
  const image = part('part-native', 'occ-aaaaaaaaaaaaaaaaaaaaaaaa', 'native', 'shape-occurrence', 0).image;
  return {
    ok: true,
    status: 'PREVIEW_READY',
    capability: 'EDITABLE_PARTS_READY',
    requestId: '00000000-0000-4000-8000-000000001074',
    sessionId: SESSION_ID,
    generation: 1,
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
    partPreview = vi.fn(async () => previewResponse);
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
      .toBe('导入到舞台');
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

  it('commits only the focused occurrence through the existing import callback and returns to the stage', async () => {
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
  });
});
