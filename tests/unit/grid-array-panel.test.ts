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
  it('opens and submits all Wave B tools from the drawer and resets orbit references on shot changes', async () => {
    const project = structuredClone(editorProjectStore.getSnapshot()!.project);
    const shot = project.shots[0]!;
    shot.durationMs = 3000;
    const source = shot.layers.find((layer) => layer.id === sourceLayerId)!;
    source.animationPlayback = { mode: 'single-frame', endBehavior: 'hold' };
    source.scaleX = 3.2;
    source.scaleY = 2;
    const background = shot.layers.find((layer) => layer.id === shot.backgroundLayerId)!;
    shot.layers = [{ ...background, zIndex: 0 }, { ...source, zIndex: 1 }];
    shot.timelineEvents = [];
    const reference = new LayerService().createFromAnimation(project, shot.id, {
      animationId: FACE_GRAPHIC_ID, position: { x: 960, y: 540 }, startTimeMs: 0,
    });
    await act(async () => {
      editorProjectStore.open(PROJECT_ROOT, reference.project);
      shotStore.select(shot.id);
      selectionStore.select(sourceLayerId);
    });
    const form = () => container.querySelector('form')!;
    const generate = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const goBack = () => act(async () => buttonByTestId('project-tools-back').click());
    await act(async () => buttonByTestId('project-tools-background-tiles').click());
    expect(form().textContent).toContain('9 个副本');
    await goBack();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    await act(async () => buttonByTestId('project-tools-background-tiles').click());
    await act(async () => generate().click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(12);
    await goBack();
    await act(async () => buttonByTestId('project-tools-orbit-flight').click());
    expect(generate().disabled).toBe(true);
    const selectReference = () => act(async () => {
      const select = form().querySelector('select')!;
      select.value = reference.layer.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await selectReference();
    expect(generate().disabled).toBe(false);
    await act(async () => shotStore.select(project.shots[1]!.id));
    expect(container.querySelector('form')).toBeNull();
    await act(async () => {
      shotStore.select(shot.id);
      selectionStore.select(sourceLayerId);
    });
    expect(generate().disabled).toBe(true);
    await selectReference();
    await act(async () => generate().click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(18);
    await goBack();
    await act(async () => buttonByTestId('project-tools-converging-flight').click());
    await act(async () => generate().click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(30);
    await goBack();
    await act(async () => buttonByTestId('project-tools-diffusion-ghost').click());
    await act(async () => generate().click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(34);
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 4 });
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
  });

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

  it('accepts generated radial and Bézier points on the exact stage boundary (#1286)', async () => {
    await act(async () => buttonByTestId('project-tools-grid-array').click());
    await act(async () => buttonByTestId('array-mode-radial').click());
    await setInputValue('radial-array-count', '2');
    await setInputValue('radial-array-center-y', '50');
    await setInputValue('radial-array-radius', '100');
    await setInputValue('radial-array-start-angle', '330');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(false);
    await act(async () => buttonByTestId('grid-array-submit').click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.at(-2)!.y).toBe(0);

    await act(async () => buttonByTestId('array-mode-path').click());
    await setInputValue('path-array-count', '4');
    for (const [index, x] of [300, 600, 900, 1200].entries()) {
      await setInputValue(`path-array-p${index}-x`, String(x));
      await setInputValue(`path-array-p${index}-y`, '1080');
    }
    expect(buttonByTestId('grid-array-submit').disabled).toBe(false);
    await act(async () => buttonByTestId('grid-array-submit').click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.slice(-4).map((layer) => layer.y))
      .toEqual([1080, 1080, 1080, 1080]);
  });

  it('supports radial and along-path array modes cleanly in Tools without writing Project on mode switch/draft/cancel (#1281 B01)', async () => {
    await act(async () => buttonByTestId('project-tools-grid-array').click());
    expect(buttonByTestId('array-mode-grid').getAttribute('aria-pressed')).toBe('true');

    // Switch to radial mode: draft & mode switch leave Project/History clean.
    await act(async () => buttonByTestId('array-mode-radial').click());
    expect(inputByTestId('radial-array-count').value).toBe('8');
    expect(inputByTestId('radial-array-center-x').value).toBe('400');
    expect(inputByTestId('radial-array-center-y').value).toBe('300');
    expect(inputByTestId('radial-array-radius').value).toBe('240');
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    // Out-of-bounds radial target disables submit.
    await setInputValue('radial-array-radius', '500');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('超出画布范围');

    // Valid radial submit with align orientation creates 8 replicas in 1 History entry & keeps source selected.
    await setInputValue('radial-array-center-x', '960');
    await setInputValue('radial-array-center-y', '540');
    await setInputValue('radial-array-radius', '240');
    const radialSelect = container.querySelector<HTMLSelectElement>('[data-testid="radial-array-orientation"]')!;
    await act(async () => {
      radialSelect.value = 'align';
      radialSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const layersBefore = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;
    await act(async () => buttonByTestId('grid-array-submit').click());
    const afterRadial = editorProjectStore.getSnapshot()!;
    expect(afterRadial).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(afterRadial.project.shots[0]!.layers).toHaveLength(layersBefore + 8);
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);

    // Switch to path mode, verify zero-length rejection, then submit valid open curve with align.
    await act(async () => buttonByTestId('array-mode-path').click());
    await setInputValue('path-array-p0-x', '400');
    await setInputValue('path-array-p0-y', '300');
    await setInputValue('path-array-p1-x', '400');
    await setInputValue('path-array-p1-y', '300');
    await setInputValue('path-array-p2-x', '400');
    await setInputValue('path-array-p2-y', '300');
    await setInputValue('path-array-p3-x', '400');
    await setInputValue('path-array-p3-y', '300');
    expect(buttonByTestId('grid-array-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="grid-array-status"]')?.textContent).toContain('退化路径');

    await setInputValue('path-array-count', '6');
    await setInputValue('path-array-p1-x', '450');
    await setInputValue('path-array-p1-y', '80');
    await setInputValue('path-array-p2-x', '850');
    await setInputValue('path-array-p2-y', '80');
    await setInputValue('path-array-p3-x', '900');
    await setInputValue('path-array-p3-y', '300');
    const pathSelect = container.querySelector<HTMLSelectElement>('[data-testid="path-array-orientation"]')!;
    await act(async () => {
      pathSelect.value = 'align';
      pathSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => buttonByTestId('grid-array-submit').click());
    const afterPath = editorProjectStore.getSnapshot()!;
    expect(afterPath).toMatchObject({ dirty: true, revision: 2 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });
    expect(afterPath.project.shots[0]!.layers).toHaveLength(layersBefore + 8 + 6);
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
  });
});
