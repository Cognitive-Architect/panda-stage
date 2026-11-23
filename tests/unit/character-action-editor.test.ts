// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CharacterAction, CharacterActionDraft } from '../../src/domain';
import { CharacterActionEditor } from '../../src/renderer/features/characters/CharacterActionEditor';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

vi.mock(import('../../src/renderer/features/assets/AnimationLibraryPanel'), async (importOriginal) => ({
  ...await importOriginal(),
  AnimationPreview: () => createElement('div', { 'data-testid': 'animation-preview' }),
}));

it('keeps action edits local until Save is submitted', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const project = buildProjectWithAnimation();
  const character = project.characters[0]!;
  const onSave = vi.fn((draft: CharacterActionDraft) => ({
    ...draft,
    id: draft.id ?? '71000000-0000-4000-8000-000000000001',
    placement: draft.placement ?? { offsetX: 0, offsetY: 0, scale: 1 },
  } as CharacterAction));
  const onDelete = vi.fn(() => true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CharacterActionEditor, {
      character,
      project,
      projectRoot: 'D:/test-project',
      disabled: false,
      onSave,
      onDelete,
    })));
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelector('[data-testid="animation-preview"]')).toBeNull();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(onSave).not.toHaveBeenCalled();

    const name = container.querySelector<HTMLInputElement>('.character-action-form label input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(name, '挥手');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      setValue.call(search, '没有对应动作');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('没有匹配的动画');
    await act(async () => {
      setValue.call(search, project.animations[0]!.name);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.character-action-sources button')!.click());
    expect(container.querySelector('[data-testid="animation-preview"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    const useSource = [...container.querySelectorAll('button')].find((button) => button.textContent === '使用此动画')!;
    await act(async () => useSource.click());
    await act(async () => container.querySelector<HTMLFormElement>('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: '挥手',
      animationId: IDS.animation,
      placement: { offsetX: 0, offsetY: 0, scale: 1 },
    }));
    expect(onDelete).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
