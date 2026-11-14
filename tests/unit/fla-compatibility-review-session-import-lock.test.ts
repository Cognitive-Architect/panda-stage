// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import { FlaCompatibilityReviewSession } from '../../src/renderer/fla-import/FlaCompatibilityReviewSession';
import { createFlaWorkbenchCandidates } from '../../src/renderer/fla-import/fla-workbench-candidates';
import {
  describeFlaUnifiedCandidate,
  type FlaUnifiedImportRunner,
  type FlaUnifiedRouteResult,
} from '../../src/renderer/fla-import/fla-unified-import';

const SESSION_ID = '00000000-0000-4000-8000-000000001073';
const SOURCE = { basename: 'sample.fla', sha256: 'a'.repeat(64) };
const TARGET_ID = 'fla-render-target-issue1073-main';
const staticStub = vi.hoisted(() => ({
  candidate: null as unknown,
  runner: null as unknown,
  graphicAcceptedStarts: 0,
  graphicImportingCallback: null as unknown,
}));

vi.mock('../../src/renderer/fla-import/FlaStaticSnapshotReview', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    FlaStaticSnapshotReview: (props: Record<string, unknown>) => {
      useEffect(() => {
        (props.onCandidatesChange as ((candidates: readonly unknown[]) => void) | undefined)?.([
          staticStub.candidate,
        ]);
        (props.onCatalogProgressChange as ((progress: unknown) => void) | undefined)?.({
          phase: 'ready', completed: 1, total: 1, omittedCandidateCount: 0,
        });
        (props.onRegisterImportRunner as ((runner: unknown) => void) | undefined)?.(staticStub.runner);
        (props.onWorkInProgressChange as ((busy: boolean) => void) | undefined)?.(false);
        (props.onTerminalStateChange as ((state: 'active') => void) | undefined)?.('active');
        return () => {
          (props.onRegisterImportRunner as ((runner: unknown) => void) | undefined)?.(null);
        };
      }, []);
      return createElement('div', { 'data-testid': 'fla-test-snapshot-review' });
    },
  };
});

vi.mock('../../src/renderer/fla-import/FlaFrameSequenceReview', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    FlaFrameSequenceReview: (props: Record<string, unknown>) => {
      useEffect(() => {
        (props.onRegisterImportRunner as ((runner: unknown) => void) | undefined)?.(null);
        (props.onWorkInProgressChange as ((busy: boolean) => void) | undefined)?.(false);
        (props.onTerminalStateChange as ((state: 'active') => void) | undefined)?.('active');
      }, []);
      return createElement('div', { 'data-testid': 'fla-test-sequence-review' });
    },
  };
});

vi.mock('../../src/renderer/fla-import/FlaUnifiedWorkbench', async () => {
  const { createElement } = await import('react');
  return {
    FlaUnifiedWorkbench: (props: Record<string, unknown>) => {
      const importFocused = props.onImportFocused as (() => void) | undefined;
      const label = typeof props.singleImportLabel === 'string' ? props.singleImportLabel : '导入素材';
      return createElement('div', null,
        createElement('button', {
          'data-testid': 'fla-test-ordinary-import',
          disabled: props.singleImportDisabled === true || props.locked === true,
          onClick: importFocused,
          type: 'button',
        }, label),
        props.snapshotPreview as ReactNode,
        props.sequencePreview as ReactNode,
      );
    },
  };
});

vi.mock('../../src/renderer/fla-import/FlaGraphicInstanceWorkbench', async () => {
  const { createElement, useState } = await import('react');
  return {
    FlaGraphicInstanceWorkbench: (props: Record<string, unknown>) => {
      const [busy, setBusy] = useState(false);
      const onImportingChange = props.onImportingChange as ((importing: boolean) => boolean | void) | undefined;
      const onImportComplete = props.onImportComplete as (() => void) | undefined;
      staticStub.graphicImportingCallback = onImportingChange;
      const enabled = props.enabled === true && props.importLocked !== true;
      if (busy) {
        return createElement('div', null,
          createElement('button', {
            'data-testid': 'fla-test-graphic-fail',
            onClick: () => {
              setBusy(false);
              onImportingChange?.(false);
            },
            type: 'button',
          }, 'Fail'),
          createElement('button', {
            'data-testid': 'fla-test-graphic-success',
            onClick: () => {
              setBusy(false);
              onImportingChange?.(false);
              onImportComplete?.();
            },
            type: 'button',
          }, 'Success'),
        );
      }
      return createElement('button', {
        'data-testid': 'fla-test-graphic-submit',
        disabled: !enabled,
        onClick: () => {
          if (onImportingChange?.(true) === false) return;
          staticStub.graphicAcceptedStarts += 1;
          setBusy(true);
        },
        type: 'button',
      }, 'Import graphic');
    },
  };
});

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

function inspectionIr(): AnimationImportIR {
  return {
    source: {
      format: 'fla',
      basename: SOURCE.basename,
      byteLength: 1,
      sha256: SOURCE.sha256,
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164',
      },
    },
    document: { width: 1, height: 1, frameRate: 24, backgroundColor: '#fff' },
    media: [],
    timelines: [],
    compatibility: [],
    summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
  };
}

function snapshotCandidate() {
  const entry: FlaRenderableTargetCatalogEntry = {
    target: {
      renderTargetId: TARGET_ID,
      kind: 'scene',
      userLabel: 'Main',
      frameCount: 1,
      selectedFrameIndex: 0,
      compatibility: [],
    },
    catalogRole: 'scene',
    previewSupported: true,
    isBlank: false,
  };
  const candidate = createFlaWorkbenchCandidates({
    context: { sessionId: SESSION_ID, source: SOURCE },
    snapshotEntries: [entry],
    snapshotPreviews: {
      [`${TARGET_ID}:0`]: { status: 'supported', previewUrl: 'blob:main-preview', sha256: 'b'.repeat(64) },
    },
  }).find((item) => item.kind === 'snapshot');
  if (!candidate) throw new Error('Snapshot candidate fixture was not created.');
  if (!candidate.selectable) throw new Error('Snapshot candidate fixture is not importable.');
  return candidate;
}

const currentSnapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue1073',
  project: {} as EditorProjectSnapshot['project'],
  dirty: false,
  revision: 0,
};

let container: HTMLDivElement;
let root: Root;
let onClose = vi.fn(() => undefined);

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function button(testId: string): HTMLButtonElement {
  const target = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!target) throw new Error(`Missing button ${testId}.`);
  return target;
}

async function renderSession(runner: FlaUnifiedImportRunner): Promise<void> {
  staticStub.candidate = snapshotCandidate();
  staticStub.runner = runner;
  const inspection = {
    requestId: '00000000-0000-4000-8000-000000001074',
    inspectionStarted: Promise.resolve(),
    response: Promise.resolve({ ok: true as const, sessionId: SESSION_ID, ir: inspectionIr() }),
  };
  await act(async () => {
    root.render(createElement(FlaCompatibilityReviewSession, {
      inspection,
      snapshot: currentSnapshot,
      onClose,
      graphicImportDisabledReason: null,
      onImportGraphicInstance: vi.fn(async () => undefined),
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flush();
}

describe('FLA review session import locks', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    staticStub.graphicAcceptedStarts = 0;
    staticStub.graphicImportingCallback = null;
    container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);
    root = createRoot(container);
    onClose = vi.fn(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    staticStub.candidate = null;
    staticStub.runner = null;
    staticStub.graphicImportingCallback = null;
    vi.restoreAllMocks();
  });

  it('blocks close, Escape, tab switching, and ordinary import during Graphic submit; failure unlocks and success closes', async () => {
    const never = new Promise<never>(() => undefined);
    const runner = vi.fn(async () => never);
    await renderSession(runner);
    await act(async () => button('fla-review-graphic-tab').click());
    const graphicSubmit = button('fla-test-graphic-submit');

    await act(async () => {
      graphicSubmit.click();
      graphicSubmit.click();
      await Promise.resolve();
    });
    expect(staticStub.graphicAcceptedStarts).toBe(1);
    expect(button('fla-review-cancel').disabled).toBe(true);
    expect(button('fla-review-assets-tab').disabled).toBe(true);
    expect(button('fla-review-graphic-tab').disabled).toBe(true);
    expect(button('fla-test-ordinary-import').disabled).toBe(true);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(button('fla-review-graphic-tab').getAttribute('aria-selected')).toBe('true');
    expect(runner).not.toHaveBeenCalled();

    await act(async () => button('fla-test-graphic-fail').click());
    expect(button('fla-review-cancel').disabled).toBe(false);
    expect(button('fla-review-assets-tab').disabled).toBe(false);
    expect(button('fla-test-ordinary-import').disabled).toBe(false);

    await act(async () => button('fla-test-graphic-submit').click());
    expect(staticStub.graphicAcceptedStarts).toBe(2);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => button('fla-test-graphic-success').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks Graphic entry and acquisition during ordinary import, then releases both locks', async () => {
    const pending = deferred<FlaUnifiedRouteResult>();
    const candidate = snapshotCandidate();
    const item = describeFlaUnifiedCandidate(candidate);
    const runner: FlaUnifiedImportRunner = vi.fn(async () => pending.promise);
    await renderSession(runner);

    expect(button('fla-test-ordinary-import').disabled).toBe(false);
    await act(async () => button('fla-test-ordinary-import').click());
    expect(runner).toHaveBeenCalledTimes(1);
    expect(button('fla-review-cancel').disabled).toBe(true);
    expect(button('fla-review-assets-tab').disabled).toBe(true);
    expect(button('fla-review-graphic-tab').disabled).toBe(true);
    expect(button('fla-test-graphic-submit').disabled).toBe(true);
    const requestGraphicImport = staticStub.graphicImportingCallback as ((importing: boolean) => boolean | void) | null;
    expect(requestGraphicImport).not.toBeNull();
    expect(requestGraphicImport?.(true)).toBe(false);
    expect(staticStub.graphicAcceptedStarts).toBe(0);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    pending.resolve({
      items: [{ ...item, status: 'imported' }],
      snapshot: currentSnapshot,
    });
    await flush();
    expect(button('fla-review-cancel').disabled).toBe(false);
    expect(button('fla-review-graphic-tab').disabled).toBe(false);
    expect(button('fla-test-ordinary-import').disabled).toBe(false);
    expect(requestGraphicImport?.(true)).toBe(true);
    expect(requestGraphicImport?.(false)).toBe(true);
    await flush();
    expect(onClose).not.toHaveBeenCalled();
  });
});
