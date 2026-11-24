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
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/radial-burst-panel.pandastage';

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
    position: { x: 960, y: 540 },
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
  timelineUiStore.seek(0, 2_000);

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

describe('ProjectToolsDrawer -> RadialBurstPanel (#1273 A04)', () => {
  it('opens from Tools, keeps draft/cancel clean, generates 12 burst replicas in one History entry, and retains source selection', async () => {
    await act(async () => buttonByTestId('project-tools-radial-burst').click());
    expect(container.querySelector('[data-testid="radial-burst-panel"]')).not.toBeNull();
    expect(container.querySelector('#project-tools-heading')?.textContent).toBe('径向爆炸');
    expect(inputByTestId('radial-burst-count').value).toBe('12');
    expect(inputByTestId('radial-burst-radius').value).toBe('240');
    expect(inputByTestId('radial-burst-center-x').value).toBe('960');
    expect(inputByTestId('radial-burst-center-y').value).toBe('540');
    expect(inputByTestId('radial-burst-seed').value).toBe('42');

    await setInputValue('radial-burst-count', '8');
    await act(async () => buttonByTestId('radial-burst-cancel').click());
    expect(container.querySelector('[data-testid="project-tools-home"]')).not.toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    await act(async () => buttonByTestId('project-tools-radial-burst').click());
    const layersBefore = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;
    await act(async () => buttonByTestId('radial-burst-submit').click());

    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(after.project.shots[0]!.layers).toHaveLength(layersBefore + 12);
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
    expect(() => ProjectSchema.parse(after.project)).not.toThrow();
  });

  it('rejects invalid params, over-shot end frame, locked source, and switched shot without writing Project', async () => {
    await act(async () => buttonByTestId('project-tools-radial-burst').click());

    await setInputValue('radial-burst-count', '33');
    expect(buttonByTestId('radial-burst-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="radial-burst-status"]')?.textContent).toContain('1–32');

    await setInputValue('radial-burst-count', '12');
    await setInputValue('radial-burst-duration', '100');
    expect(buttonByTestId('radial-burst-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="radial-burst-status"]')?.textContent).toContain('超出当前镜头');

    await setInputValue('radial-burst-duration', '12');
    expect(buttonByTestId('radial-burst-submit').disabled).toBe(false);

    await act(async () => {
      layerStore.setLocked(sourceLayerId, true);
    });
    expect(buttonByTestId('radial-burst-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="radial-burst-status"]')?.textContent).toContain('已锁定');

    await act(async () => {
      layerStore.setLocked(sourceLayerId, false);
    });
    const secondShotId = editorProjectStore.getSnapshot()!.project.shots[1]!.id;
    await act(async () => {
      shotStore.select(secondShotId);
    });
    expect(buttonByTestId('radial-burst-submit').disabled).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.filter((l) => l.name.includes('爆炸'))).toHaveLength(0);
  });
});
