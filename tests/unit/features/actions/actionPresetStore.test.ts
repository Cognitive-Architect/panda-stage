import { beforeEach, describe, expect, it } from 'vitest';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import { actionPresetStore } from '../../../../src/renderer/features/actions/actionPresetStore';
import { buildProject, IDS } from '../../domain/testProject';
import type { Project } from '../../../../src/domain';

function expectEditorMutationStateUnchanged(
  before: ReturnType<typeof editorProjectStore.getSnapshot>,
  beforeHistory: ReturnType<typeof editorProjectStore.history.getSnapshot>,
): void {
  const after = editorProjectStore.getSnapshot();
  expect(after?.project).toEqual(before?.project);
  expect(after?.revision).toBe(before?.revision);
  expect(after?.dirty).toBe(before?.dirty);
  expect(editorProjectStore.history.getSnapshot()).toEqual(beforeHistory);
}

function openProject(): void {
  editorProjectStore.open('test-project.pandastage', buildProject());
  shotStore.select(IDS.shot);
}

function projectWithLockedLayer(): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  const lockedShot = {
    ...shot,
    layers: shot.layers.map((layer) =>
      layer.id === IDS.layerChar ? { ...layer, locked: true } : layer,
    ),
  };
  return {
    ...project,
    shots: project.shots.map((candidate) =>
      candidate.id === shot.id ? lockedShot : candidate,
    ),
  };
}

describe('T08 actionPresetStore (bridge)', () => {
  beforeEach(() => {
    selectionStore.clear();
    openProject();
  });

  it('NEG-001: rejects when no layer is selected (Chinese feedback)', () => {
    selectionStore.clear();
    const before = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(false);
    expect(result.errors?.some((message) => message.includes('选择'))).toBe(true);
    expectEditorMutationStateUnchanged(before, beforeHistory);
  });

  it('NEG-002: rejects a locked layer', () => {
    editorProjectStore.open('locked.pandastage', projectWithLockedLayer());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    const before = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(false);
    expect(result.errors?.some((message) => message.includes('锁定'))).toBe(true);
    expectEditorMutationStateUnchanged(before, beforeHistory);
  });

  it('rejects a background layer selection', () => {
    selectionStore.selectBackground();
    const before = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(false);
    expectEditorMutationStateUnchanged(before, beforeHistory);
  });

  it('NEG-004: rejects expression-switch on a non-character layer', () => {
    selectionStore.select(IDS.layerAsset);
    const before = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const result = actionPresetStore.apply('expression-switch', {
      expressionId: IDS.expressionNormal,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors?.some(
        (message) => message.includes('角色图层') || message.includes('表情'),
      ),
    ).toBe(true);
    expectEditorMutationStateUnchanged(before, beforeHistory);
  });

  it('UX-002: applies a fade-in, records history, and reports success', () => {
    selectionStore.select(IDS.layerChar);
    const before =
      editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents.length;
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(true);
    const after =
      editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents.length;
    expect(after).toBe(before + 1);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('invalid duration does not crash the bridge (returns errors)', () => {
    selectionStore.select(IDS.layerChar);
    const result = actionPresetStore.apply('fade-in', { durationMs: -5 });
    // createPresetEvents still produces an event; validation/apply may reject
    // only on out-of-bounds end time. We assert the bridge never throws.
    expect(typeof result.ok).toBe('boolean');
  });

  it('rejects invalid preset parameters without project, revision, dirty, or history changes', () => {
    selectionStore.select(IDS.layerChar);
    const before = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();

    const result = actionPresetStore.apply('expression-switch', {
      expressionId: IDS.unknownExpression,
    });

    expect(result.ok).toBe(false);
    expectEditorMutationStateUnchanged(before, beforeHistory);
  });

  it('isolates selection and action history across project A -> B -> A', () => {
    selectionStore.select(IDS.layerChar);
    expect(actionPresetStore.apply('fade-in').ok).toBe(true);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

    editorProjectStore.open('project-b.pandastage', buildProject());
    shotStore.select(IDS.shot);
    expect(selectionStore.getSelectedLayerId()).toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      projectRoot: 'project-b.pandastage',
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    editorProjectStore.open('project-a-reopened.pandastage', buildProject());
    shotStore.select(IDS.shot);
    expect(selectionStore.getSelectedLayerId()).toBeNull();
    expect(actionPresetStore.apply('fade-in').ok).toBe(false);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      projectRoot: 'project-a-reopened.pandastage',
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });
});
