// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  ProjectSchema,
  editAnimationPropertyKey,
  retimeAnimationPropertyRange,
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

  it('blocks silent fallback when explicit 500->1000ms segment endpoints move after retime, then allows baking after re-selection (#1376 P2-01)', async () => {
    await setSelectValue(selectByTestId('rich-easing-start'), '500');
    await setSelectValue(selectByTestId('rich-easing-end'), '1000');
    await setSelectValue(selectByTestId('rich-easing-family'), 'back');
    await setSelectValue(selectByTestId('rich-easing-direction'), 'out');
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('active');

    // Retime 500..1000ms forward by 1 frame -> 542..1042ms while panel stays open.
    await act(async () => {
      const state = editorProjectStore.getSnapshot()!;
      const retimed = retimeAnimationPropertyRange(
        state.project,
        { shotId: IDS.shot, target: { kind: 'layer', layerId }, property: 'transform.offsetX' },
        { startMs: 500, endMs: 1_000, mode: 'move', frames: 1 },
      );
      editorProjectStore.updateProject(retimed, '调整属性选段时间');
    });

    const afterRetime = editorProjectStore.getSnapshot()!;
    const historyAfterRetime = editorProjectStore.history.getSnapshot();
    expect(afterRetime.revision).toBe(1);
    // Stale preview draft must be cleared and Apply must be disabled (no silent fallback to 0->542ms).
    expect(drafts.at(-1)).toBeNull();
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(true);
    expect(container.querySelector('[data-testid="rich-easing-scope"]')?.textContent).toContain('重新选择');

    // Clicking Apply while stale must not mutate revision, History, or keys.
    await act(async () => buttonByTestId('rich-easing-apply').click());
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: afterRetime.revision, project: afterRetime.project });
    expect(editorProjectStore.history.getSnapshot()).toEqual(historyAfterRetime);

    // Re-selecting the new valid segment 542->1042ms re-enables Apply and bakes only 542..1042ms.
    await setSelectValue(selectByTestId('rich-easing-start'), '542');
    await setSelectValue(selectByTestId('rich-easing-end'), '1042');
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(false);

    await act(async () => buttonByTestId('rich-easing-apply').click());
    const afterBake = editorProjectStore.getSnapshot()!;
    expect(afterBake.revision).toBe(afterRetime.revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(historyAfterRetime.undoCount + 1);

    const bakedTrack = afterBake.project.shots[0]!.layers
      .find((candidate) => candidate.id === layerId)!
      .animationClip!.tracks.find((candidate) => candidate.property === 'transform.offsetX')!;
    // Earlier segment 0..542ms must have NO baked intermediate keys.
    expect(bakedTrack.keys.filter((k) => k.timeMs > 0 && k.timeMs < 542)).toEqual([]);
    // Selected segment 542..1042ms must have baked intermediate keys and preserve endpoints.
    expect(bakedTrack.keys.filter((k) => k.timeMs > 542 && k.timeMs < 1_042).length).toBeGreaterThan(0);
    expect(bakedTrack.keys.find((k) => k.timeMs === 542)?.value).toBe(200);
    expect(bakedTrack.keys.find((k) => k.timeMs === 1_042)?.value).toBe(400);
  });

  it('invalidates active draft when project revision changes (anchor edit or Undo/Redo) even if endpoints remain (#1376 P2-01)', async () => {
    await setSelectValue(selectByTestId('rich-easing-start'), '500');
    await setSelectValue(selectByTestId('rich-easing-end'), '1000');
    await setSelectValue(selectByTestId('rich-easing-family'), 'back');
    await setSelectValue(selectByTestId('rich-easing-direction'), 'out');
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('active');

    // Edit anchor value at 500ms (endpoints 0/500/1000 still exist, but revision increments).
    await act(async () => {
      const state = editorProjectStore.getSnapshot()!;
      const edited = editAnimationPropertyKey(
        state.project,
        { shotId: IDS.shot, target: { kind: 'layer', layerId }, property: 'transform.offsetX', keyTimeMs: 500 },
        { value: 260 },
      );
      editorProjectStore.updateProject(edited, '编辑属性曲线');
    });

    const afterEdit = editorProjectStore.getSnapshot()!;
    const historyAfterEdit = editorProjectStore.history.getSnapshot();
    expect(afterEdit.revision).toBe(1);
    expect(drafts.at(-1)).toBeNull();
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('stale');
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(true);

    // Clicking Apply does not silently commit stale draft against new revision.
    await act(async () => buttonByTestId('rich-easing-apply').click());
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: afterEdit.revision, project: afterEdit.project });
    expect(editorProjectStore.history.getSnapshot()).toEqual(historyAfterEdit);

    // Re-previewing refreshes draft for revision 1 and allows applying cleanly.
    await act(async () => buttonByTestId('rich-easing-repreview').click());
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('active');
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(false);

    // Undo also invalidates the fresh draft; Cancel clears stale state so user can continue.
    await act(async () => {
      expect(editorProjectStore.undo()).toBe(true);
    });
    expect(drafts.at(-1)).toBeNull();
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(true);

    await act(async () => buttonByTestId('rich-easing-cancel').click());
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('idle');
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(false);
  });

  it('preserves direct apply without preview draft on initial default segment (#1376 P2-01)', async () => {
    const beforeProject = editorProjectStore.getSnapshot()!.project;
    expect(container.querySelector('[data-testid="rich-easing-section"]')?.getAttribute('data-rich-easing-draft')).toBe('idle');
    expect(buttonByTestId('rich-easing-apply').disabled).toBe(false);

    await act(async () => buttonByTestId('rich-easing-apply').click());
    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ dirty: true, revision: 1 });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    const track = after.project.shots[0]!.layers
      .find((candidate) => candidate.id === layerId)!
      .animationClip!.tracks.find((candidate) => candidate.property === 'transform.offsetX')!;
    expect(track.keys.filter((k) => k.timeMs > 0 && k.timeMs < 500).length).toBeGreaterThan(0);

    await act(async () => {
      expect(editorProjectStore.undo()).toBe(true);
    });
    expect(editorProjectStore.getSnapshot()!.project).toEqual(beforeProject);
  });
});
