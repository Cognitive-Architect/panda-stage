// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CharacterMotionService, CharacterService, LayerService, saveCharacterBodyPose } from '../../src/domain';
import { CharacterBodyPoseControl } from '../../src/renderer/features/properties/CharacterBodyPoseControl';
import { AnimationCurveDraftDispatch } from '../../src/renderer/features/timeline/AnimationCurveDraft';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

it('expires a pose preview on seek and applies a fresh preview exactly once', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 2);
  const base = new CharacterService().createAdaptiveParts(buildProject(), { name: 'Actor', parts });
  const { project, layer } = new LayerService().createFromAdaptiveCharacter(
    base, IDS.shot, base.characters.at(-1)!.id, { x: 650, y: 450 },
  );
  const address = { shotId: IDS.shot, layerId: layer.id, timeMs: 500 };
  const partId = parts[0]!.partId;
  const moved = new CharacterMotionService().apply(project, { ...address, partId, autoKey: true }, { 'transform.offsetX': 35 });
  const posed = saveCharacterBodyPose(moved, address, 'Reach', [partId]);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const preview = vi.fn();
  const button = (name: string) => [...host.querySelectorAll('button')].find(entry => entry.textContent === name);
  try {
    editorProjectStore.open('D:/body-pose-preview', posed);
    const before = editorProjectStore.getSnapshot()!;
    const shot = posed.shots.find(entry => entry.id === IDS.shot)!;
    await act(async () => {
      timelineUiStore.seek(0, shot.durationMs);
      root.render(createElement(AnimationCurveDraftDispatch.Provider, { value: preview },
        createElement(CharacterBodyPoseControl, { snapshot: before, shot, layer: shot.layers.find(entry => entry.id === layer.id)! })));
    });
    await act(async () => {
      const section = host.querySelector('details')!;
      section.open = true;
      section.dispatchEvent(new Event('toggle'));
    });
    const card = host.querySelector<HTMLButtonElement>('[data-testid="body-pose-card"]')!;
    await act(async () => card.click());
    expect(button('应用并落键')).toBeDefined();
    expect(preview.mock.lastCall?.[0]).toMatchObject({ timeMs: 0 });

    await act(async () => timelineUiStore.seek(250, shot.durationMs));
    expect(preview.mock.lastCall?.[0]).toBeNull();
    await act(async () => timelineUiStore.seek(0, shot.durationMs));
    expect(button('应用并落键')).toBeUndefined();
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    await act(async () => card.click());
    await act(async () => button('取消预览')!.click());
    expect(preview.mock.lastCall?.[0]).toBeNull();
    await act(async () => card.click());
    await act(async () => button('应用并落键')!.click());
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()?.project).toEqual(before.project);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    editorProjectStore.clear();
    vi.unstubAllGlobals();
  }
});
