import { describe, expect, it, vi } from 'vitest';
import {
  commitDialogueGesture,
  isolateDialoguePointerEvent,
  type DialogueGestureContext,
  type DialogueGestureIdentity,
} from '../../src/renderer/features/timeline/dialogueGesture';

const identity: DialogueGestureIdentity = {
  projectRoot: 'D:\\project-a',
  shotId: 'shot-a',
  dialogueId: 'dialogue-a',
};

const current: DialogueGestureContext = {
  projectRoot: identity.projectRoot,
  shotId: identity.shotId,
  selectedDialogueId: identity.dialogueId,
  dialogueIds: [identity.dialogueId],
};

describe('Dialogue gesture target identity', () => {
  it('allows one normal pointerup against the same target identity', () => {
    const commit = vi.fn();
    expect(
      commitDialogueGesture(identity, current, 'pointerup', commit),
    ).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'project switch',
      { ...current, projectRoot: 'D:\\project-b' },
    ],
    ['shot switch', { ...current, shotId: 'shot-b' }],
    ['dialogue deletion', { ...current, dialogueIds: [] }],
    [
      'selection change',
      { ...current, selectedDialogueId: 'dialogue-b' },
    ],
  ])('rejects a stale pointerup after %s', (_label, context) => {
    const commit = vi.fn();
    expect(
      commitDialogueGesture(identity, context, 'pointerup', commit),
    ).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'escape', 'unmount'] as const)(
    'never commits on %s',
    (completion) => {
      const commit = vi.fn();
      expect(
        commitDialogueGesture(identity, current, completion, commit),
      ).toBe(false);
      expect(commit).not.toHaveBeenCalled();
    },
  );
});

describe('Dialogue pointer isolation', () => {
  it('stops clip/handle input before it can reach ruler seeking', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    isolateDialoguePointerEvent(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
});
