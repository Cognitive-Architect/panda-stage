// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
  duplicateCharacterActionForInstance,
  upsertCharacterActionEvent,
  type CharacterActionEvent,
  type Project,
} from '../../src/domain';
import { CharacterActionAtTimeControl } from '../../src/renderer/features/properties/CharacterActionAtTimeControl';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { IDS, buildProject } from './domain/testProject';

const ACTION_ID = '71000000-0000-4000-8000-000000000010';
const COPY_ID = '71000000-0000-4000-8000-000000000011';
const EVENT_A = '71000000-0000-4000-8000-000000000012';
const EVENT_B = '71000000-0000-4000-8000-000000000013';

function instanceRig(): { project: Project; layerA: string; layerB: string } {
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 3);
  const base = new CharacterService().createAdaptiveParts(buildProject(), { name: 'Scope UI rig', parts });
  const characterId = base.characters.at(-1)!.id;
  const first = new LayerService().createFromAdaptiveCharacter(base, IDS.shot, characterId, { x: 650, y: 450 });
  const second = new LayerService().createFromAdaptiveCharacter(first.project, IDS.shot, characterId, { x: 1400, y: 450 });
  let project = ProjectSchema.parse({
    ...second.project,
    characters: second.project.characters.map((character) => character.id !== characterId ? character : {
      ...character,
      actions: [{
        id: ACTION_ID,
        name: '招手',
        kind: 'layered' as const,
        tracks: [{
          partId: parts[0]!.partId,
          property: 'transform.rotationDeg' as const,
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
            { timeMs: 1000, value: 20, interpolationToNext: 'linear' as const },
          ],
        }],
      }],
    }),
  });
  project = upsertCharacterActionEvent(project, IDS.shot, first.layer.id, {
    actionId: ACTION_ID, startMs: 0, endMs: 1000,
  }, () => EVENT_A);
  project = upsertCharacterActionEvent(project, IDS.shot, second.layer.id, {
    actionId: ACTION_ID, startMs: 0, endMs: 1000,
  }, () => EVENT_B);
  return { project, layerA: first.layer.id, layerB: second.layer.id };
}

function eventOnLayer(project: Project, layerId: string): CharacterActionEvent {
  return project.shots[0]!.timelineEvents.find(
    (event): event is CharacterActionEvent =>
      event.type === 'character-action' && event.layerId === layerId,
  )!;
}

it('offers another layer private copy neither in the picker nor as a bindable option (#1449)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const rig = instanceRig();
  const project = duplicateCharacterActionForInstance(rig.project, {
    shotId: IDS.shot,
    layerId: rig.layerA,
    eventId: eventOnLayer(rig.project, rig.layerA).id,
  }, () => COPY_ID).project;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const render = async (layerId: string) => {
    const shot = project.shots[0]!;
    await act(async () => root.render(createElement(CharacterActionAtTimeControl, {
      project,
      shot,
      layer: shot.layers.find((layer) => layer.id === layerId)!,
    })));
  };
  const optionValues = () => Array.from(element.querySelectorAll<HTMLOptionElement>('option'))
    .map((option) => option.value);
  const buttonLabels = () => Array.from(element.querySelectorAll('button'))
    .map((button) => button.textContent);
  try {
    // Layer B must not be offered A's private copy.
    await render(rig.layerB);
    expect(optionValues()).toEqual([ACTION_ID]);
    expect(optionValues()).not.toContain(COPY_ID);
    // Same-layer copies stay listed on their owning layer.
    await render(rig.layerA);
    expect(optionValues()).toEqual([ACTION_ID, COPY_ID]);
    expect(buttonLabels()).toContain('恢复共享动作');

    // Legacy corrupt data: B's event references A's private copy. Playback
    // degrades to the shared origin action and the UI offers the formal revert.
    const legacy = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        timelineEvents: shot.timelineEvents.map((event) =>
          event.type === 'character-action' && event.layerId === rig.layerB
            ? { ...event, actionId: COPY_ID }
            : event),
      })),
    });
    const shot = legacy.shots[0]!;
    await act(async () => root.render(createElement(CharacterActionAtTimeControl, {
      project: legacy,
      shot,
      layer: shot.layers.find((layer) => layer.id === rig.layerB)!,
    })));
    expect(optionValues()).not.toContain(COPY_ID);
    expect(buttonLabels()).toContain('恢复共享动作');
    expect(buttonLabels()).not.toContain('复制为可编辑副本');
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
