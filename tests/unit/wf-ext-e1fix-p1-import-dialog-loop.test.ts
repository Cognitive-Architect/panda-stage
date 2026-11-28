// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectResourceImportDialog } from '../../src/renderer/features/assets/ProjectResourceImportDialog';
import type { ProjectResourceImportOption } from '../../src/shared/project-resource-import-api';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';

const OPTIONS: ProjectResourceImportOption[] = [
  {
    kind: 'character',
    id: 'char-1',
    name: '角色甲',
    supported: true,
    mode: 'single-image',
    dependencyAnimationCount: 0,
    dependencyAssetCount: 1,
  },
  {
    kind: 'character',
    id: 'char-2',
    name: '角色乙',
    supported: true,
    mode: 'single-image',
    dependencyAnimationCount: 0,
    dependencyAssetCount: 1,
  },
] as unknown as ProjectResourceImportOption[];

function buildSnapshot(): EditorProjectSnapshot {
  return {
    projectRoot: 'D:/fake-project',
    revision: 0,
    dirty: false,
    project: {
      id: 'proj-1',
      schemaVersion: 1,
      name: '测试工程',
      assets: [],
      characters: [],
      voiceProfiles: [],
      subtitleStyles: [],
      shots: [],
      scenes: [],
    },
  } as unknown as EditorProjectSnapshot;
}

function emptyPreviewResponse() {
  return {
    ok: true as const,
    selectedCount: 0,
    characterCount: 0,
    animationCount: 0,
    assetCount: 0,
    reusableAssetCount: 0,
    newFileCount: 0,
    nameConflicts: [],
    issues: [],
  };
}

describe('P1-01: ProjectResourceImportDialog empty-selection stability', () => {
  let root: Root;
  let container: HTMLDivElement;
  let previewCalls: number;

  beforeEach(() => {
    previewCalls = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    (window as unknown as Record<string, unknown>).pandaStage = {
      projectResourceImport: {
        preview: vi.fn(async () => {
          previewCalls += 1;
          return emptyPreviewResponse();
        }),
        apply: vi.fn(),
      },
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  function renderDialog(overrides: Record<string, unknown> = {}): void {
    const props = {
      snapshot: buildSnapshot(),
      session: {
        sourceToken: 'src-token',
        sourceProjectName: '源工程',
        items: OPTIONS,
      },
      onClose: vi.fn(),
      onImported: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(createElement(ProjectResourceImportDialog, props));
    });
  }

  it('does not loop or call preview when the selection is empty on open', async () => {
    renderDialog();
    // Let effects settle.
    await act(async () => {
      await Promise.resolve();
    });
    // The empty-selection branch must not fire the IPC preview at all.
    expect(previewCalls).toBe(0);
    // Component is stable: no crash, and the hint text is shown.
    expect(document.body.textContent).toContain('勾选需要复用');
  });

  it('deselecting all items returns to a stable empty state without extra preview calls', async () => {
    renderDialog();
    await act(async () => {
      await Promise.resolve();
    });

    // Select one item via the checkbox.
    const itemCheckbox = document.body.querySelector<HTMLInputElement>(
      '.project-resource-import-item input[type="checkbox"]',
    );
    expect(itemCheckbox).toBeDefined();
    await act(async () => {
      itemCheckbox!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(previewCalls).toBe(1);

    // Deselect the same item → back to empty selection.
    await act(async () => {
      itemCheckbox!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Preview is not called again for the empty state, and no loop occurs
    // (the test would time out or grow previewCalls if it looped).
    expect(previewCalls).toBe(1);
    expect(document.body.textContent).toContain('勾选需要复用');
  });

  it('re-selecting after clearing the selection starts a fresh preview', async () => {
    renderDialog();
    await act(async () => {
      await Promise.resolve();
    });

    const itemCheckbox = document.body.querySelector<HTMLInputElement>(
      '.project-resource-import-item input[type="checkbox"]',
    );
    expect(itemCheckbox).toBeDefined();

    // Select → deselect → select again.
    await act(async () => {
      itemCheckbox!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      itemCheckbox!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(previewCalls).toBe(1);

    await act(async () => {
      itemCheckbox!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(previewCalls).toBe(2);
  });
});
