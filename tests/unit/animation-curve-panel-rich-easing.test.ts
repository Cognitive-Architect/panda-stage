// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  ProjectSchema,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { AnimationCurvePanel } from '../../src/renderer/features/timeline/AnimationCurvePanel';
import type { AnimationCurveDraft } from '../../src/renderer/features/timeline/AnimationCurveDraft';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/rich-easing-panel.pandastage';

let container: HTMLDivElement;
let root: Root;
let layerId: string;
let drafts: Array<AnimationCurveDraft | null>;

function selectByTestId(testId: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing select ${testId}`);
  return el;
}

function buttonByTestId(testId: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing button ${testId}`);
  return el;
}

async function setSelectValue(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function Harness({ onDraft }: { onDraft: (draft: AnimationCurveDraft | null) => void }) {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const currentShotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const selectedLayerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  const shot = snapshot?.project.shots.find((candidate) => candidate.id === currentShotId);
  const layer = shot?.layers.find((candidate) => candidate.id === selectedLayerId);
  if (!snapshot || !shot || !layer) return null;
  return createElement(AnimationCurvePanel, {
    snapshot,
    shot,
    layer,
    onDraft,
    onClose: () => undefined,
  });
}

function buildAuthoredProject(): { project: Project; layerId: string; opacityEventId: string } {
  const base = graphicFaceProject();
  const placed = new LayerService().createFromAnimation(base, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  const motion = new LayerMotionService();
  let project = motion.applyKeys(
    placed.project,
    { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 0 },
    { 'transform.offsetX': 0 },
  );
  project = motion.applyKeys(
    project,
    { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 500 },
    { 'transform.offsetX': 200 },
  );
  project = motion.applyKeys(
    project,
    { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 1_000 },
    { 'transform.offsetX': 400 },
  );
  const opacityEventId = '93000000-0000-4000-8000-000000000911';
  const opacityEvent: TimelineEvent = {
    id: opacityEventId,
    type: 'opacity',
    layerId: placed.layer.id,
    startMs: 0,
    endMs: 1_000,
    from: 1,
    to: 0.2,
    easing: 'linear',
  };
  project = ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === IDS.shot ? { ...shot, timelineEvents: [...shot.timelineEvents, opacityEvent] } : shot,
    ),
  });
  return { project, layerId: placed.layer.id, opacityEventId };
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  drafts = [];
  const authored = buildAuthoredProject();
  layerId = authored.layerId;
  editorProjectStore.open(PROJECT_ROOT, authored.project);
  shotStore.select(IDS.shot);
  selectionStore.select(layerId);
  timelineUiStore.seek(0, 2_000);

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { onDraft: (draft) => drafts.push(draft) }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  selectionStore.clear();
  editorProjectStore.clear();
});

describe('AnimationCurvePanel Rich Easing (#1292 C01)', () => {
  it('exposes all 6 families x 3 directions, previews draft cleanly, and cancels without store or History mutation', async () => {
    const familySelect = selectByTestId('rich-easing-family');
    const directionSelect = selectByTestId('rich-easing-direction');
    expect(Array.from(familySelect.options).map((o) => o.value)).toEqual([
      'sin', 'cubic', 'circle', 'quint', 'back', 'bounce',
    ]);
    expect(Array.from(directionSelect.options).map((o) => o.value)).toEqual([
      'in', 'out', 'in-out',
    ]);
    expect(container.querySelector('[data-testid="rich-easing-scope"]')?.textContent).toContain('替换 1 段');

    const beforeProject = editorProjectStore.getSnapshot()!.project;
    await setSelectValue(familySelect, 'back');
    await setSelectValue(directionSelect, 'out');

    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('active');
    expect(drafts.at(-1)).not.toBeNull();
    expect(drafts.at(-1)?.project).not.toEqual(beforeProject);
    // Draft preview must not mutate EditorProjectStore, revision, dirty, or History.
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0, project: beforeProject });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    // Cancel clears draft without touching store or History.
    await act(async () => buttonByTestId('rich-easing-cancel').click());
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('idle');
    expect(drafts.at(-1)).toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({ dirty: false, revision: 0, project: beforeProject });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });

  it('bakes multi-segment scope in exactly one History entry with exact 1-step Undo and Redo', async () => {
    const beforeProject = editorProjectStore.getSnapshot()!.project;
    await setSelectValue(selectByTestId('rich-easing-start'), '0');
    await setSelectValue(selectByTestId('rich-easing-end'), '1000');
    expect(container.querySelector('[data-testid="rich-easing-scope"]')?.textContent).toContain('替换 2 段');

    await setSelectValue(selectByTestId('rich-easing-family'), 'bounce');
    await setSelectValue(selectByTestId('rich-easing-direction'), 'out');
    await act(async () => buttonByTestId('rich-easing-apply').click());

    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(drafts.at(-1)).toBeNull();

    const layer = after.project.shots[0]!.layers.find((candidate) => candidate.id === layerId)!;
    const track = layer.animationClip?.tracks.find((candidate) => candidate.property === 'transform.offsetX');
    expect(track).toBeDefined();
    expect(track!.keys.length).toBeGreaterThan(3);
    // Anchor keyframes at 0, 500, 1000 preserved.
    expect(track!.keys.find((k) => k.timeMs === 0)?.value).toBe(0);
    expect(track!.keys.find((k) => k.timeMs === 500)?.value).toBe(200);
    expect(track!.keys.find((k) => k.timeMs === 1_000)?.value).toBe(400);

    // 1 Undo restores exact pre-bake state; 1 Redo restores exact post-bake state.
    await act(async () => {
      expect(editorProjectStore.undo()).toBe(true);
    });
    expect(editorProjectStore.getSnapshot()!.project).toEqual(beforeProject);
    await act(async () => {
      expect(editorProjectStore.redo()).toBe(true);
    });
    expect(editorProjectStore.getSnapshot()!.project).toEqual(after.project);
  });

  it('locally disables rich easing for opacity with hint without blocking existing opacity edits, and disables when locked', async () => {
    const trackSelect = container.querySelector<HTMLSelectElement>('.animation-curve-fields select')!;
    const opacityOption = Array.from(trackSelect.options).find((o) => o.textContent?.includes('透明度'));
    expect(opacityOption).toBeDefined();
    await setSelectValue(trackSelect, opacityOption!.value);

    expect(container.querySelector('[data-testid="rich-easing-inapplicable"]')?.textContent?.length).toBeGreaterThan(0);
    expect(selectByTestId('rich-easing-family').disabled).toBe(true);
    expect(selectByTestId('rich-easing-direction').disabled).toBe(true);
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(true);

    // Existing opacity interpolation editing still works cleanly.
    const interpSelect = Array.from(container.querySelectorAll<HTMLSelectElement>('.animation-curve-fields select'))
      .find((s) => Array.from(s.options).some((o) => o.value === 'ease-in'));
    expect(interpSelect).toBeDefined();
    expect(interpSelect!.disabled).toBe(false);
    await setSelectValue(interpSelect!, 'ease-out');
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents.find((e) => e.type === 'opacity')?.easing).toBe('ease-out');

    // Switch back to transform.offsetX and lock layer.
    const offsetXOption = Array.from(trackSelect.options).find((o) => o.textContent?.includes('位置 X'));
    await setSelectValue(trackSelect, offsetXOption!.value);
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(false);

    await act(async () => {
      layerStore.setLocked(layerId, true);
    });
    expect(container.querySelector('[data-testid="rich-easing-locked"]')?.textContent).toContain('已锁定');
    expect(selectByTestId('rich-easing-family').disabled).toBe(true);
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(true);
  });
});
