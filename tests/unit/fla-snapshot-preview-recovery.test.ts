// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlaStaticSnapshotReview } from '../../src/renderer/fla-import/FlaStaticSnapshotReview';
import type { FlaStaticSnapshotPreviewRequest } from '../../src/shared/fla-static-snapshot-api';

const client = vi.hoisted(() => ({ catalog: vi.fn(), preview: vi.fn(), cancel: vi.fn(), commit: vi.fn() }));
vi.mock('../../src/renderer/fla-import/fla-static-snapshot-render', () => ({ flaStaticSnapshotClient: client }));
const target = { renderTargetId: `fla-render-target-${'a'.repeat(64)}`, kind: 'scene',
  userLabel: 'Scene', frameCount: 1, selectedFrameIndex: 0, compatibility: ['exact'] };
const noop = () => undefined;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function flush() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function render(active = true) {
  await act(async () => root.render(createElement(FlaStaticSnapshotReview, {
    active, sessionId: '00000000-0000-4000-8000-000000001107', source: { basename: 'preview.fla', sha256: 'a'.repeat(64) },
    checkedCandidateKeys: new Set<string>(), importLocked: false, onToggleCandidate: noop,
    onCheckCandidates: noop, onClearCandidates: noop, onReconcileCandidates: noop,
    onRegisterImportRunner: noop, onImported: noop,
  })));
  await flush();
}
function ready(request: FlaStaticSnapshotPreviewRequest) {
  return { ok: true, requestId: request.requestId, targetRenderTargetId: target.renderTargetId,
    targetSelectedFrameIndex: 0, width: 12, height: 12, bytes: new Uint8Array([1, 2, 3]), sha256: 'b'.repeat(64) };
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  client.catalog.mockResolvedValue({ ok: true, entries: [{ target, previewSupported: true, isBlank: false }], summary: 'Ready' });
  client.cancel.mockResolvedValue({ accepted: true });
  client.preview.mockImplementation(async (request: FlaStaticSnapshotPreviewRequest) => ready(request));
  let nextUrl = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++nextUrl}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(noop);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 12, height: 12, close: noop })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: noop } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'])));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Snapshot failure recovery (#1107)', () => {
  it('shows one centered recovery group with collapsed diagnostics and retries this candidate', async () => {
    client.preview.mockResolvedValueOnce({ ok: false, error: { code: 'RENDERER_CRASH', message: 'ERR_FAILED raster worker' } });
    await render();
    const body = container.querySelector('.fla-preview-failure-body');
    expect(body?.querySelector('svg')).not.toBeNull();
    expect(body?.querySelector('strong')?.textContent).toBe('预览加载失败');
    const retry = body?.querySelector<HTMLButtonElement>('button');
    expect(retry?.textContent).toBe('请重试');
    expect(retry?.getAttribute('aria-label')).toBe('请重试');
    expect(body?.querySelectorAll('button')).toHaveLength(1);
    const details = container.querySelector<HTMLDetailsElement>('[data-testid="fla-snapshot-error-details"]');
    expect(details?.open).toBe(false); expect(details?.textContent).toContain('ERR_FAILED raster worker');
    const visible = container.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('details').forEach((element) => element.remove());
    expect(visible.textContent).not.toContain('ERR_FAILED');
    await act(async () => retry!.click()); await flush();
    expect(container.querySelector('[data-testid="fla-snapshot-preview-failure"]')).toBeNull();
    expect(container.querySelector('[data-testid="fla-snapshot-preview-image"]')).not.toBeNull();
    expect(client.catalog).toHaveBeenCalledOnce();
    expect(client.preview).toHaveBeenCalledTimes(2);
  });

  it('pauses raster work while the Graphic route is active, then completes the still-needed Snapshot', async () => {
    await render(false);
    expect(client.preview).not.toHaveBeenCalled();
    await render(true);
    expect(client.preview).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="fla-snapshot-preview-image"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="fla-snapshot-preview-failure"]')).toBeNull();
    expect(client.catalog).toHaveBeenCalledOnce();
  });
});
