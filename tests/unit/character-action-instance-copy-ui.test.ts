// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
  upsertCharacterActionEvent,
  type CharacterActionEvent,
} from '../../src/domain';
import { CharacterActionAtTimeControl } from '../../src/renderer/features/properties/CharacterActionAtTimeControl';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { IDS, buildProject } from './domain/testProject';

const ACTION_ID = '71000000-0000-4000-8000-000000000010';
const EVENT_ID = '71000000-0000-4000-8000-000000000012';

it('copies a shared action segment to an editable copy and restores it through the existing control', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 3);
  let project = new CharacterService().createAdaptiveParts(buildProject(), { name: 'Copy UI rig', parts });
  const characterId = project.characters.at(-1)!.id;
  const placed = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, characterId, { x: 650, y: 450 });
  const armId = parts[0]!.partId;
  project = ProjectSchema.parse({
    ...placed.project,
    characters: placed.project.characters.map((character) => character.id !== characterId ? character : {
      ...character,
      actions: [{
        id: ACTION_ID,
        name: '招手',
        kind: 'layered' as const,
        tracks: [{
          partId: armId,
          property: 'transform.rotationDeg' as const,
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
            { timeMs: 1000, value: 20, interpolationToNext: 'linear' as const },
          ],
        }],
      }],
    }),
  });
  project = upsertCharacterActionEvent(project, IDS.shot, placed.layer.id, {
    actionId: ACTION_ID, startMs: 0, endMs: 1000,
  }, () => EVENT_ID);

  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const button = (label: string) => Array.from(element.querySelectorAll('button'))
    .find((entry) => entry.textContent === label);
  const currentEvent = (): CharacterActionEvent => editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents
    .find((event): event is CharacterActionEvent => event.id === EVENT_ID)!;
  const draw = () => {
    const snapshot = editorProjectStore.getSnapshot()!;
    const shot = snapshot.project.shots[0]!;
    root.render(createElement(CharacterActionAtTimeControl, {
      project: snapshot.project,
      shot,
      layer: shot.layers.find((layer) => layer.id === placed.layer.id)!,
    }));
  };
  try {
    editorProjectStore.open('D:/action-copy-ui-test', project);
    shotStore.select(IDS.shot);
    selectionStore.select(placed.layer.id);
    timelineUiStore.seek(500, 3000);
    await act(async () => draw());

    expect(button('复制为可编辑副本')).toBeDefined();
    await act(async () => button('复制为可编辑副本')!.click());
    const copyId = currentEvent().actionId as string;
    expect(copyId).not.toBe(ACTION_ID);
    const character = editorProjectStore.getSnapshot()!.project.characters.find((entry) => entry.id === characterId)!;
    expect(character.actions?.find((action) => action.id === copyId)).toMatchObject({
      kind: 'layered',
      instanceScope: { layerId: placed.layer.id },
    });

    await act(async () => draw());
    expect(button('恢复共享动作')).toBeDefined();
    await act(async () => button('恢复共享动作')!.click());
    expect(currentEvent().actionId).toBe(ACTION_ID);
    const restored = editorProjectStore.getSnapshot()!.project.characters.find((entry) => entry.id === characterId)!;
    expect(restored.actions ?? []).toHaveLength(1);

    // Undo/Redo keeps the copy transaction atomic.
    editorProjectStore.undo();
    expect(currentEvent().actionId).toBe(copyId);
    editorProjectStore.redo();
    expect(currentEvent().actionId).toBe(ACTION_ID);
  } finally {
    await act(async () => root.unmount());
    element.remove();
    selectionStore.clear();
    editorProjectStore.clear();
    vi.unstubAllGlobals();
  }
});
