// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayerMotionService, LayerService, ProjectSchema, ShotService } from '../../src/domain';
import { ProjectToolsDrawer } from '../../src/renderer/shell/ProjectToolsDrawer';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/afterimage-panel.pandastage';

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
  const moving = new LayerMotionService().applyCurveMotion(placed.project, {
    shotId: IDS.shot,
    layerId: sourceLayerId,
    startFrame: 0,
    endFrame: 24,
    p1: { x: 450, y: 120 },
    p2: { x: 850, y: 120 },
    p3: { x: 900, y: 300 },
    speedMode: 'constant',
  });
  const withSecondShot = new ShotService().create(moving, {
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

describe('ProjectToolsDrawer -> AfterimagePanel (#1271 A03)', () => {
  it('opens from Tools, keeps draft/cancel clean, generates 4 afterimages in one History entry, and retains source selection', async () => {
    await act(async () => buttonByTestId('project-tools-afterimage').click());
    expect(container.querySelector('[data-testid="afterimage-panel"]')).not.toBeNull();
    expect(container.querySelector('#project-tools-heading')?.textContent).toBe('残影');
    expect(inputByTestId('afterimage-count').value).toBe('4');
    expect(inputByTestId('afterimage-delay').value).toBe('2');
    expect(inputByTestId('afterimage-decay').value).toBe('0.6');

    await setInputValue('afterimage-count', '5');
    await act(async () => buttonByTestId('afterimage-cancel').click());
    expect(container.querySelector('[data-testid="project-tools-home"]')).not.toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    await act(async () => buttonByTestId('project-tools-afterimage').click());
    const layersBefore = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;
    await act(async () => buttonByTestId('afterimage-submit').click());

    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(after.project.shots[0]!.layers).toHaveLength(layersBefore + 4);
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
    expect(() => ProjectSchema.parse(after.project)).not.toThrow();
  });

  it('rejects invalid parameters, short span, locked source, and switched shot without writing Project', async () => {
    await act(async () => buttonByTestId('project-tools-afterimage').click());

    await setInputValue('afterimage-count', '2');
    expect(buttonByTestId('afterimage-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="afterimage-status"]')?.textContent).toContain('3–8');

    await setInputValue('afterimage-count', '4');
    await setInputValue('afterimage-decay', '1.0');
    expect(buttonByTestId('afterimage-submit').disabled).toBe(true);

    await setInputValue('afterimage-decay', '0.6');
    await setInputValue('afterimage-end-frame', '6');
    expect(buttonByTestId('afterimage-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="afterimage-status"]')?.textContent).toContain('时段长度不足');

    await setInputValue('afterimage-end-frame', '24');
    expect(buttonByTestId('afterimage-submit').disabled).toBe(false);

    await act(async () => {
      layerStore.setLocked(sourceLayerId, true);
    });
    expect(buttonByTestId('afterimage-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="afterimage-status"]')?.textContent).toContain('已锁定');

    await act(async () => {
      layerStore.setLocked(sourceLayerId, false);
    });
    const secondShotId = editorProjectStore.getSnapshot()!.project.shots[1]!.id;
    await act(async () => {
      shotStore.select(secondShotId);
    });
    expect(buttonByTestId('afterimage-submit').disabled).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.filter((l) => l.name.includes('残影'))).toHaveLength(0);
  });
});
