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

const PROJECT_ROOT = 'D:/curve-motion-panel.pandastage';

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

describe('ProjectToolsDrawer -> CurveMotionPanel (#1269 A02)', () => {
  it('opens from Tools, displays read-only P0, keeps draft/cancel clean, and bakes 25 explicit keys in one History entry', async () => {
    await act(async () => buttonByTestId('project-tools-curve-motion').click());
    expect(container.querySelector('[data-testid="curve-motion-panel"]')).not.toBeNull();
    expect(container.querySelector('#project-tools-heading')?.textContent).toBe('曲线运动');
    expect(container.querySelector('[data-testid="curve-motion-p0"]')?.textContent).toContain('400, 300');
    expect(container.querySelector('[data-testid="curve-motion-preview"]')).not.toBeNull();

    // Draft edits and cancel do not write Project/dirty/revision/History.
    await setInputValue('curve-motion-p3-x', '880');
    await act(async () => buttonByTestId('curve-motion-cancel').click());
    expect(container.querySelector('[data-testid="project-tools-home"]')).not.toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    // Re-open, enter arch parameters, select ease-in-out, and submit.
    await act(async () => buttonByTestId('project-tools-curve-motion').click());
    await setInputValue('curve-motion-start-frame', '0');
    await setInputValue('curve-motion-end-frame', '24');
    await setInputValue('curve-motion-p1-x', '450');
    await setInputValue('curve-motion-p1-y', '80');
    await setInputValue('curve-motion-p2-x', '850');
    await setInputValue('curve-motion-p2-y', '80');
    await setInputValue('curve-motion-p3-x', '900');
    await setInputValue('curve-motion-p3-y', '300');
    const easeTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="curve-motion-speed"] [role="tab"]'),
    ).find((btn) => btn.textContent?.trim() === '缓入缓出');
    expect(easeTab).toBeDefined();
    await act(async () => easeTab!.click());

    await act(async () => buttonByTestId('curve-motion-submit').click());
    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(selectionStore.getSelectedLayerId()).toBe(sourceLayerId);
    expect(() => ProjectSchema.parse(after.project)).not.toThrow();

    const layer = after.project.shots[0]!.layers.find((l) => l.id === sourceLayerId)!;
    expect(layer.animationClip?.version).toBe(2);
    if (layer.animationClip?.version !== 2) throw new Error('Expected v2 Clip');
    expect(layer.animationClip.tracks.find((t) => t.property === 'transform.offsetX')?.keys).toHaveLength(25);
    expect(layer.animationClip.tracks.find((t) => t.property === 'transform.offsetY')?.keys).toHaveLength(25);

    // Now that layer has X/Y keys, conflict prevents overwriting.
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="curve-motion-status"]')?.textContent).toContain('已有 X/Y 位移关键帧');
  });

  it('rejects invalid frames, out-of-bounds points, zero-length path, and stale/locked/switched targets', async () => {
    await act(async () => buttonByTestId('project-tools-curve-motion').click());

    // Zero-length path rejected.
    await setInputValue('curve-motion-p1-x', '400');
    await setInputValue('curve-motion-p1-y', '300');
    await setInputValue('curve-motion-p2-x', '400');
    await setInputValue('curve-motion-p2-y', '300');
    await setInputValue('curve-motion-p3-x', '400');
    await setInputValue('curve-motion-p3-y', '300');
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="curve-motion-status"]')?.textContent).toContain('长度为 0');

    // Out-of-bounds coordinate rejected.
    await setInputValue('curve-motion-p3-x', '2500');
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="curve-motion-status"]')?.textContent).toContain('画布范围');

    // Restore valid coords, then test invalid frame range.
    await setInputValue('curve-motion-p3-x', '900');
    await setInputValue('curve-motion-end-frame', '0');
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="curve-motion-status"]')?.textContent).toContain('晚于起帧');

    // Lock source -> disabled.
    await setInputValue('curve-motion-end-frame', '24');
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(false);
    await act(async () => {
      layerStore.setLocked(sourceLayerId, true);
    });
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(container.querySelector('[data-testid="curve-motion-status"]')?.textContent).toContain('已锁定');

    // Unlock, switch shot -> disabled (never applies stale draft).
    await act(async () => {
      layerStore.setLocked(sourceLayerId, false);
    });
    const secondShotId = editorProjectStore.getSnapshot()!.project.shots[1]!.id;
    await act(async () => {
      shotStore.select(secondShotId);
    });
    expect(buttonByTestId('curve-motion-submit').disabled).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === sourceLayerId)?.animationClip).toBeUndefined();
  });
});
