// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  type Project,
} from '../../src/domain';
import { PartPoseEditorPanel } from '../../src/renderer/features/properties/PartPoseEditorPanel';
import {
  createPartPoseGestureContextKey,
  type PartPoseEditorUi,
  type PartPoseGestureContextIdentity,
} from '../../src/renderer/features/part-pose/partPoseEditorTypes';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/part-pose-editor.pandastage';

function adaptiveLayerProject(): {
  project: Project;
  layerId: string;
  partIds: string[];
} {
  const project = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Part pose editor Character',
    parts: adaptivePartsFixture(IDS.assetChar),
  });
  const character = project.characters.at(-1)!;
  if (character.mode !== 'adaptive-parts') {
    throw new Error('Expected an Adaptive Parts Character.');
  }
  const placed = new LayerService().createFromAdaptiveCharacter(
    project,
    IDS.shot,
    character.id,
    { x: 700, y: 500 },
  );
  return {
    project: placed.project,
    layerId: placed.layer.id,
    partIds: character.parts.map((part) => part.partId),
  };
}

function currentShot() {
  const project = editorProjectStore.getSnapshot()?.project;
  const shot = project?.shots.find((candidate) => candidate.id === IDS.shot);
  if (!project || !shot) throw new Error('Pose editor fixture Shot is missing.');
  return { project, shot };
}

function currentLayer(layerId: string) {
  const { shot } = currentShot();
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error('Pose editor fixture Layer is missing.');
  return layer;
}

function editorUi(
  layerId: string | null,
  partId: string | null,
): PartPoseEditorUi {
  return {
    activeLayerId: layerId,
    selectedPartId: partId,
    calibratingPivot: false,
    pivotDraft: null,
    onStart: () => undefined,
    onExit: () => undefined,
    onSelectPart: () => undefined,
    onStartPivot: () => undefined,
    onCancelPivot: () => undefined,
    onSetPivot: () => undefined,
    onPivotUsed: () => undefined,
  };
}

function context(): PartPoseGestureContextIdentity {
  return {
    projectInstanceId: 1,
    projectId: 'project',
    projectRoot: PROJECT_ROOT,
    revision: 0,
    shotId: IDS.shot,
    selectedLayerId: 'layer',
    activeLayerId: 'layer',
    selectedPartId: 'arm',
    timeMs: 1_000,
  };
}

let container: HTMLDivElement;
let root: Root;
let fixture: ReturnType<typeof adaptiveLayerProject>;

describe('Part pose editor UI', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    fixture = adaptiveLayerProject();
    editorProjectStore.open(PROJECT_ROOT, fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    const { shot } = currentShot();
    timelineUiStore.seek(0, shot.durationMs);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    editorProjectStore.clear();
  });

  it('shows the action entry only for Adaptive Parts and keeps opening/seeking read-only', async () => {
    const { project, shot } = currentShot();
    const layer = currentLayer(fixture.layerId);
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer,
      editor: editorUi(null, null),
    })));
    expect(container.querySelector('[data-testid="part-pose-editor-entry"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-edit-action"]'))
      .not.toBeNull();

    const ordinaryLayer = {
      ...layer,
      source: { kind: 'asset' as const, assetId: project.assets[0]!.id },
    };
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: ordinaryLayer,
      editor: editorUi(null, null),
    })));
    expect(container.querySelector('[data-testid="part-pose-editor-entry"]'))
      .toBeNull();

    timelineUiStore.seek(1_000, shot.durationMs);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('atomically adds the first key from the panel and leaves other base pivots calibratable', async () => {
    const { shot } = currentShot();
    timelineUiStore.seek(1_000, shot.durationMs);
    const firstPartId = fixture.partIds[0]!;
    const props = {
      project: fixture.project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, firstPartId),
    };
    await act(async () => root.render(createElement(PartPoseEditorPanel, props)));

    const addKey = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    );
    expect(addKey?.disabled).toBe(false);
    await act(async () => addKey?.click());

    const snapshot = editorProjectStore.getSnapshot()!;
    expect(snapshot).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    const layer = currentLayer(fixture.layerId);
    expect(layer.poseAnimation!.tracks.every(
      (track) => track.keys[0]!.timeMs === 0,
    )).toBe(true);
    expect(layer.poseAnimation!.tracks.find(
      (track) => track.partId === firstPartId,
    )!.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);

    const secondPartId = fixture.partIds[1]!;
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      ...props,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, secondPartId),
    })));
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(false);

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      ...props,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, firstPartId),
    })));
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(true);
  });
});

describe('Part pose gesture context', () => {
  it('changes when the project session, revision, selection, or time changes', () => {
    const initial = context();
    const initialKey = createPartPoseGestureContextKey(initial);
    expect(createPartPoseGestureContextKey({ ...initial, revision: 1 }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, projectInstanceId: 2 }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, selectedLayerId: 'other' }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, selectedPartId: 'other' }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, timeMs: 500 }))
      .not.toBe(initialKey);
  });
});
