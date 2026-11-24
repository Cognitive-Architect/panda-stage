// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayerService, ProjectSchema, ShotService } from '../../src/domain';
import { ProjectToolsDrawer } from '../../src/renderer/shell/ProjectToolsDrawer';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/grid-array-panel.pandastage';

let container: HTMLDivElement;
let root: Root;
let sourceLayerId: string;

function inputByTestId(testId: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing input ${testId}`);
  return el;
}

function buttonByTestId(testId: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing button ${testId}`);
  return el;
}

async function setInputValue(testId: string, value: string): Promise<void> {
  const input = inputByTestId(testId);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('HTMLInputElement.value setter missing');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const base = graphicFaceProject();
  const placed = new LayerService().createFromAnimation(base, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  sourceLayerId = placed.layer.id;
  const withSecondShot = new ShotService().create(placed.project, {
    name: 'Shot 2',
    durationMs: 2_000,
  });
  editorProjectStore.open(PROJECT_ROOT, withSecondShot);
  shotStore.select(IDS.shot);
  selectionStore.select(sourceLayerId);

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(ProjectToolsDrawer, { onClose: () => undefined }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  selectionStore.clear();
});

describe('ProjectToolsDrawer -> GridArrayPanel (#1268 A01)', () => {
  it('opens from Tools, keeps draft/cancel clean, generates 3x4 grid in one History entry, and retains source selection', async () => {
    await act(async () => buttonByTestId('project-tools-grid-array').click());
    expect(container.querySelector('[data-testid="grid-array-panel"]')).not.toBeNull();
    expect(container.querySelector('#project-tools-heading')?.textContent).toBe('排兵布阵');
    expect(inputByTestId('grid-array-rows').value).toBe('3');
    expect(inputByTestId('grid-array-cols').value).toBe('4');
    expect(inputByTestId('grid-array-spacing-x').value).toBe('100');
    expect(inputByTestId('grid-array-spacing-y').value).toBe('80');

    // Editing draft and cancelling does not touch Project, dirty, revision, or History.
    await setInputValue('grid-array-rows', '2');
    await setInputValue('grid-array-cols', '3');
    await act(async () => buttonByTestId('grid-array-cancel').click());
    expect(container.querySelector('[data-testid="project-tools-home"]')).not.toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    // Re-open and submit default 3x4 (100, 80).
    await act(async () => buttonByTestId('project-tools-grid-array').click());
    const layersBefore = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;
    await act(async () => {
      buttonByTestId('grid-array-submit').click();
    });

    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(after.project.shots[0]!.layers).toHaveLength(layersBefore + 11);
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
    expect(() => ProjectSchema.parse(after.project)).not.toThrow();
  });

  it('disables unused axis spacing on 1-row/1-col and rejects invalid or out-of-bounds inputs without writing Project', async () => {
    await act(async () => buttonByTestId('project-tools-grid-array').click());

    await setInputValue('grid-array-rows', '1');
    expect(inputByTestId('grid-array-spacing-y').disabled).toBe(true);
    expect(inputByTestId('grid-array-spacing-x').disabled).toBe(false);

    await setInputValue('grid-array-rows', '3');
    await setInputValue('grid-array-cols', '1');
    expect(inputByTestId('grid-array-spacing-x').disabled).toBe(true);
    expect(inputByTestId('grid-array-spacing-y').disabled).toBe(false);

    // Decimal rows rejected.
    await setInputValue('grid-array-rows', '2.5');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('整数');

    // Over-100 count rejected.
    await setInputValue('grid-array-rows', '10');
    await setInputValue('grid-array-cols', '11');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('100');

    // Out-of-bounds spacing rejected.
    await setInputValue('grid-array-rows', '3');
    await setInputValue('grid-array-cols', '4');
    await setInputValue('grid-array-spacing-x', '600');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('超出画布范围');

    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });

  it('blocks submission when selection is cleared, locked, deleted, or shot switches', async () => {
    await act(async () => buttonByTestId('project-tools-grid-array').click());
    expect(buttonByTestId('grid-array-submit').disabled).toBe(false);

    // Lock source -> submit disabled with clear status.
    await act(async () => {
      layerStore.setLocked(sourceLayerId, true);
    });
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('已锁定');

    // Unlock, then switch shot -> submit disabled, never commits to stale target.
    await act(async () => {
      layerStore.setLocked(sourceLayerId, false);
    });
    expect(buttonByTestId('grid-array-submit').disabled).toBe(false);

    const secondShotId = editorProjectStore.getSnapshot()!.project.shots[1]!.id;
    await act(async () => {
      shotStore.select(secondShotId);
    });
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);

    // Switch back, select source, then delete source -> submit disabled.
    await act(async () => {
      shotStore.select(IDS.shot);
      selectionStore.select(sourceLayerId);
      layerStore.deleteLayer(sourceLayerId);
    });
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
  });
});
