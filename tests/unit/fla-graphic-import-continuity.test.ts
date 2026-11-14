// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject } from './domain/testProject';

vi.mock('../../src/renderer/fla-import/FlaCompatibilityReviewSession', () => ({
  FlaCompatibilityReviewSession: (props: { graphicImportDisabledReason: string | null }) => createElement(
    'button', { 'data-testid': 'graphic-import', disabled: Boolean(props.graphicImportDisabledReason) },
    '导入此元件',
  ),
}));

afterEach(() => {
  editorProjectStore.clear();
  vi.restoreAllMocks();
});

describe('Graphic import project prerequisites (#1105)', () => {
  it('keeps dirty/no-shot import enabled and the inspection alive across edits and ordinary saves', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const prior = Object.getOwnPropertyDescriptor(window, 'pandaStage');
    const project = ProjectSchema.parse({ ...buildProject(), shots: [], assets: [], characters: [], voiceProfiles: [] });
    const projectRoot = 'D:\\acceptance\\graphic-import.pandastage';
    editorProjectStore.open(projectRoot, project);
    let notifyStarted: ((event: { requestId: string }) => void) | null = null;
    const chooseAndInspect = vi.fn(async (requestId: string) => {
      notifyStarted?.({ requestId });
      return { ok: true, sessionId: '00000000-0000-4000-8000-000000001105' };
    });
    const cancel = vi.fn(async () => ({ ok: true }));
    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: { fla: {
        chooseAndInspect, cancel,
        onInspectionStarted: (callback: typeof notifyStarted) => {
          notifyStarted = callback;
          return () => { notifyStarted = null; };
        },
      } },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onImportGraphicInstance = vi.fn(async () => undefined);
    const render = async () => act(async () => {
      root.render(createElement(AssetLibrary, { snapshot: editorProjectStore.getSnapshot(), onImportGraphicInstance }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    try {
      await render();
      await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="asset-import-fla"]')!.click());
      const button = container.querySelector<HTMLButtonElement>('[data-testid="graphic-import"]');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
      await act(async () => editorProjectStore.updateProject({ ...project, name: 'Latest unsaved title' }));
      await render();
      expect(container.querySelector('[data-testid="graphic-import"]')).toBe(button);
      expect(button?.disabled).toBe(false);
      const edited = editorProjectStore.getSnapshot()!;
      await act(async () => editorProjectStore.markSaved(edited.project, edited.revision));
      await render();
      expect(container.querySelector('[data-testid="graphic-import"]')).toBe(button);
      expect(chooseAndInspect).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      // Same path/project ID reopened is a different editing instance and must invalidate.
      await act(async () => editorProjectStore.open(projectRoot, edited.project));
      await render();
      expect(container.querySelector('[data-testid="graphic-import"]')).toBeNull();
      expect(cancel).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      if (prior) Object.defineProperty(window, 'pandaStage', prior);
      else Reflect.deleteProperty(window, 'pandaStage');
    }
  });
});
