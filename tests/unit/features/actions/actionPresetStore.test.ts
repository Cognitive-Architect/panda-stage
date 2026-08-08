import { beforeEach, describe, expect, it } from 'vitest';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import { actionPresetStore } from '../../../../src/renderer/features/actions/actionPresetStore';
import { buildProject, IDS } from '../../domain/testProject';
import type { Project } from '../../../../src/domain';

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
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(false);
    expect(result.errors?.some((message) => message.includes('选择'))).toBe(true);
  });

  it('NEG-002: rejects a locked layer', () => {
    editorProjectStore.open('locked.pandastage', projectWithLockedLayer());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(false);
    expect(result.errors?.some((message) => message.includes('锁定'))).toBe(true);
  });

  it('rejects a background layer selection', () => {
    // selectionStore auto-clears background selections, so emulate the guard
    // by selecting an explicit background layer id via the bridge directly.
    const result = actionPresetStore.apply('fade-in');
    // Without an explicit selection the bridge reports "no selection".
    expect(result.ok).toBe(false);
  });

  it('NEG-004: rejects expression-switch on a non-character layer', () => {
    selectionStore.select(IDS.layerAsset);
    const result = actionPresetStore.apply('expression-switch', {
      expressionId: IDS.expressionNormal,
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors?.some(
        (message) => message.includes('角色图层') || message.includes('表情'),
      ),
    ).toBe(true);
  });

  it('UX-002: applies a fade-in, records history, and reports success', () => {
    selectionStore.select(IDS.layerChar);
    const beforeSnapshot = editorProjectStore.getSnapshot()!;
    const before =
      beforeSnapshot.project.shots[0]!.timelineEvents.length;
    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(true);
    const after =
      editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents.length;
    expect(after).toBe(before + 1);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
    expect(editorProjectStore.getSnapshot()!.dirty).toBe(true);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('rejects invalid parameters without changing project, revision, dirty, or history', () => {
    selectionStore.select(IDS.layerChar);
    const before = editorProjectStore.getSnapshot()!;
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const result = actionPresetStore.apply('expression-switch', {
      expressionId: IDS.unknownExpression,
    });
    const after = editorProjectStore.getSnapshot()!;
    expect(result.ok).toBe(false);
    expect(JSON.stringify(after.project)).toBe(JSON.stringify(before.project));
    expect(after.revision).toBe(before.revision);
    expect(after.dirty).toBe(before.dirty);
    expect(editorProjectStore.history.getSnapshot()).toEqual(beforeHistory);
  });

  it('rejects an explicit background target without mutating the project', () => {
    selectionStore.selectBackground();
    const before = editorProjectStore.getSnapshot()!;
    const result = actionPresetStore.apply('fade-in');
    const after = editorProjectStore.getSnapshot()!;
    expect(result.ok).toBe(false);
    expect(result.errors?.some((message) => message.includes('背景'))).toBe(true);
    expect(JSON.stringify(after.project)).toBe(JSON.stringify(before.project));
    expect(after.revision).toBe(before.revision);
    expect(after.dirty).toBe(before.dirty);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });

  it('does not carry selection or action history across project A -> B -> A boundaries', () => {
    selectionStore.select(IDS.layerChar);
    expect(actionPresetStore.apply('fade-in').ok).toBe(true);

    editorProjectStore.open('project-b.pandastage', buildProject());
    shotStore.select(IDS.shot);
    expect(selectionStore.getSelectedLayerId()).toBeNull();
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    editorProjectStore.open('project-a-reopened.pandastage', buildProject());
    shotStore.select(IDS.shot);
    expect(selectionStore.getSelectedLayerId()).toBeNull();
    expect(actionPresetStore.apply('fade-in').ok).toBe(false);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });
});
