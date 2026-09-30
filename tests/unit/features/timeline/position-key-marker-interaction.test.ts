import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, ShotService, recognizePositionChain } from '../../../../src/domain';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../../../src/renderer/features/timeline/timelineUiStore';
import { buildProject, IDS } from '../../domain/testProject';

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
  refIndex: 0,
  stateIndex: 0,
  effects: [] as Array<() => unknown>,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      return hooks.refs[index] ??= { current: initial };
    },
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
    },
    useLayoutEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  };
});

vi.mock('react-dom', () => ({
  createPortal: (children: unknown) => ({ type: 'test-portal', props: { children } }),
}));

import { PositionKeyMarker, type PositionKeyMarkerProps } from '../../../../src/renderer/features/timeline/PositionKeyMarker';

function setup(): PositionKeyMarkerProps {
  const base = buildProject();
  const layer = base.shots[0]!.layers.find((candidate) => candidate.id === IDS.layerChar)!;
  const project = ProjectSchema.parse({
    ...base,
    shots: [{
      ...base.shots[0]!,
      timelineEvents: [
        { id: '90000000-0000-4000-8000-000000000801', type: 'move', layerId: layer.id,
          startMs: 0, endMs: 1_000, from: { x: layer.x, y: layer.y },
          to: { x: 600, y: 650 }, easing: 'linear' },
        { id: '90000000-0000-4000-8000-000000000802', type: 'move', layerId: layer.id,
          startMs: 1_000, endMs: 2_000, from: { x: 600, y: 650 },
          to: { x: 700, y: 700 }, easing: 'linear' },
      ],
    }],
  });
  const withSecondShot = new ShotService().duplicate(project, project.shots[0]!.id);
  editorProjectStore.open('D:/pk06-pointer-tests.pandastage', withSecondShot);
  const snapshot = editorProjectStore.getSnapshot()!;
  const shot = snapshot.project.shots[0]!;
  shotStore.select(shot.id);
  selectionStore.select(layer.id);
  timelineUiStore.seek(0, shot.durationMs);
  const recognition = recognizePositionChain({ shot, layer: shot.layers.find((candidate) => candidate.id === layer.id)! });
  if (recognition.status !== 'editable') throw new Error('Expected editable Position chain');
  return {
    point: recognition.chain.points[1]!, current: false,
    durationMs: shot.durationMs, pixelsPerMs: 0.2,
    shotId: shot.id, layerId: layer.id,
    previousTimeMs: 0, nextTimeMs: 2_000,
    snapshot, onError: vi.fn(),
  };
}

type TestPointer = ReturnType<typeof pointer>;
type TestButton = { props: {
  onClick: (event: { stopPropagation: () => void; detail: number }) => void;
  disabled: boolean;
  onPointerDown: (event: TestPointer) => void;
  onPointerMove: (event: TestPointer) => void;
  onPointerUp: (event: TestPointer) => void;
  onPointerCancel: (event: TestPointer) => void;
  onLostPointerCapture: (event: TestPointer) => void;
} };
type TestPortal = { type: string; props: { children: {
  props: { children: { props: { onClick: () => void } } };
} } } | null;

function marker(props: PositionKeyMarkerProps): { button: TestButton; portal: TestPortal } {
  hooks.refIndex = 0;
  hooks.stateIndex = 0;
  hooks.effects = [];
  const rendered = PositionKeyMarker(props);
  const children = rendered.props.children as unknown[];
  return { button: children[0] as TestButton, portal: children[2] as TestPortal };
}

function pointer(x: number) {
  const currentTarget = {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  return {
    pointerId: 647, pointerType: 'mouse', button: 0, clientX: x,
    stopPropagation: vi.fn(), currentTarget,
  };
}

beforeEach(() => {
  hooks.refs = [];
  hooks.states = [];
  vi.stubGlobal('window', { setTimeout: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('document', { body: {} });
});

afterEach(() => {
  selectionStore.clear();
  editorProjectStore.clear();
  vi.unstubAllGlobals();
});

describe('Issue #647 Position marker pointer lifecycle', () => {
  it('cancels an unfinished retime when Preview takes interaction ownership', () => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    expect(hooks.states[0]).not.toBeNull();
    marker({ ...props, productPreviewOpen: true });
    for (const effect of hooks.effects) effect();
    button.props.onPointerUp(pointer(120));
    expect(hooks.states[0]).toBeNull();
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('dismisses Delete for Preview, rejects its retained handler, and requires explicit reopening after close', () => {
    const props = { ...setup(), current: true };
    timelineUiStore.seek(props.point.timeMs, props.durationMs);
    hooks.states[1] = { top: 20, left: 20, below: false };
    const opened = marker(props);
    expect(opened.portal).not.toBeNull();
    const retainedDelete = opened.portal!.props.children.props.children.props.onClick;
    hooks.refs[0]!.current = {
      getBoundingClientRect: () => ({ top: 600, left: 300, right: 312, bottom: 612, width: 12, height: 12 }),
      closest: () => null,
    };

    const previewProps = { ...props, productPreviewOpen: true };
    expect(marker(previewProps).portal).toBeNull();
    for (const effect of hooks.effects) effect();
    const isolated = marker(previewProps);
    expect(isolated.button.props.disabled).toBe(true);
    retainedDelete();
    isolated.button.props.onClick({ stopPropagation: vi.fn(), detail: 0 });
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    expect(marker(props).portal).toBeNull();
    for (const effect of hooks.effects) effect();
    const closed = marker(props);
    expect(closed.button.props.disabled).toBe(false);
    expect(closed.portal).toBeNull();
    retainedDelete();
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);

    closed.button.props.onClick({ stopPropagation: vi.fn(), detail: 0 });
    marker(props);
    for (const effect of hooks.effects) effect();
    const reopened = marker(props);
    expect(reopened.portal).not.toBeNull();
    reopened.portal!.props.children.props.children.props.onClick();
    expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('previews without a write, then releases exactly one retime and one Undo unit', () => {
    const props = setup();
    const { button } = marker(props);
    const down = pointer(100);
    button.props.onPointerDown(down);
    expect(down.stopPropagation).toHaveBeenCalledOnce();
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(647);
    button.props.onPointerMove(pointer(109));
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
    expect(hooks.states[0]).toBe(1_042);

    const up = pointer(109);
    button.props.onPointerUp(up);
    expect(up.currentTarget.releasePointerCapture).toHaveBeenCalledWith(647);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_042);
    button.props.onLostPointerCapture(pointer(109));
    expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
  });

  it.each(['cancel', 'lost'])('%s before release makes zero Project or History writes', (termination) => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    if (termination === 'cancel') button.props.onPointerCancel(pointer(120));
    else button.props.onLostPointerCapture(pointer(120));
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('rejects a switched Layer before release without a stale write', () => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    selectionStore.clear();
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    expect(props.onError).toHaveBeenCalledOnce();
  });

  it('rejects a switched Shot before release without a stale write', () => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    shotStore.select(props.snapshot.project.shots[1]!.id);
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(props.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    expect(props.onError).toHaveBeenCalledOnce();
  });

  it('rejects a changed revision without adding a stale retime write', () => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    editorProjectStore.updateProject({ ...props.snapshot.project, name: 'Renamed during drag' });
    const changed = editorProjectStore.getSnapshot();
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(changed);
    expect(changed?.revision).toBe(1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    expect(props.onError).toHaveBeenCalledOnce();
  });

  it('rejects a reopened Project instance even at the same path and revision', () => {
    const props = setup();
    const { button } = marker(props);
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    editorProjectStore.open(props.snapshot.projectRoot, props.snapshot.project);
    const reopened = editorProjectStore.getSnapshot();
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(reopened);
    expect(reopened?.revision).toBe(0);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    expect(props.onError).toHaveBeenCalledOnce();
  });

  it('shows a current Key-attached Delete action and commits one deletion', () => {
    const props = { ...setup(), current: true };
    timelineUiStore.seek(1_000, props.durationMs);
    hooks.states[1] = { top: 20, left: 20, below: false };
    const { portal } = marker(props);
    if (!portal) throw new Error('Current Key Delete action was not rendered');
    expect(portal.type).toBe('test-portal');
    const action = portal.props.children;
    const deleteButton = action.props.children;
    deleteButton.props.onClick();
    const after = editorProjectStore.getSnapshot()!;
    expect(after).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    const shot = after.project.shots[0]!;
    const layer = shot.layers.find((candidate) => candidate.id === props.layerId)!;
    const recognition = recognizePositionChain({ shot, layer });
    expect(recognition.status).toBe('editable');
    if (recognition.status === 'editable') {
      expect(recognition.chain.points.map((point) => point.timeMs)).toEqual([0, 2_000]);
    }
  });

  it('keeps the Base protected from retime and Delete', () => {
    const key = setup();
    const shot = key.snapshot.project.shots[0]!;
    const layer = shot.layers.find((candidate) => candidate.id === key.layerId)!;
    const chain = recognizePositionChain({ shot, layer });
    if (chain.status !== 'editable') throw new Error('Missing chain');
    const props = { ...key, point: chain.chain.points[0]!, current: true, previousTimeMs: null };
    hooks.states[1] = { top: 20, left: 20, below: false };
    const { button, portal } = marker(props);
    expect(portal).toBeNull();
    button.props.onPointerDown(pointer(100));
    button.props.onPointerMove(pointer(120));
    button.props.onPointerUp(pointer(120));
    expect(editorProjectStore.getSnapshot()).toBe(key.snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });
});
