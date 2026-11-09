// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  type Project,
} from '../../../../src/domain';
import type { PartPoseEditorUi } from '../../../../src/renderer/features/part-pose/partPoseEditorTypes';
import { PartPoseTimeline } from '../../../../src/renderer/features/timeline/PartPoseTimeline';
import {
  TimelineDock,
  type TimelineDockProps,
} from '../../../../src/renderer/features/timeline/TimelineDock';
import { PendingDialoguePlacementProvider } from '../../../../src/renderer/features/timeline/PendingDialoguePlacement';
import { timelineUiStore } from '../../../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../../../src/renderer/stores/layerStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import { adaptivePartsFixture } from '../../../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from '../../domain/testProject';

const PROJECT_ROOT = 'D:/part-pose-timeline.pandastage';

function adaptiveLayerProject(): {
  project: Project;
  layerId: string;
  partIds: string[];
} {
  const project = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Timeline Pose Character',
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

function editorUi(layerId: string, selectedPartId: string): PartPoseEditorUi {
  return {
    actionSectionOpen: false,
    onActionSectionOpenChange: () => undefined,
    activeLayerId: layerId,
    selectedPartId,
    calibratingPivot: false,
    pivotDraft: null,
    onStart: () => undefined,
    onExit: () => undefined,
    onSelectPart: () => undefined,
    onStartPivot: () => undefined,
    onCancelPivot: () => undefined,
    onSetPivot: () => undefined,
    onCommitPivotDrag: () => undefined,
    onPivotUsed: () => undefined,
  };
}

function currentLayer(layerId: string) {
  const project = editorProjectStore.getSnapshot()?.project;
  const shot = project?.shots.find((candidate) => candidate.id === IDS.shot);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!project || !shot || !layer) throw new Error('Pose fixture is missing.');
  return { project, shot, layer };
}

function pointerEvent(
  type: string,
  values: { pointerId: number; clientX: number; button: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

let container: HTMLDivElement;
let root: Root;
let fixture: ReturnType<typeof adaptiveLayerProject>;

describe('Part Pose Timeline lanes', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    fixture = adaptiveLayerProject();
    editorProjectStore.open(PROJECT_ROOT, fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    await act(async () => {
      layerStore.createPartPoseAnimation(fixture.layerId);
      layerStore.addPartPoseKeyframe(fixture.layerId, fixture.partIds[0]!, 500);
      layerStore.addPartPoseKeyframe(fixture.layerId, fixture.partIds[0]!, 1_500);
      layerStore.addPartPoseKeyframe(fixture.layerId, fixture.partIds[1]!, 1_000);
    });
    timelineUiStore.seek(0, 3_000);
    timelineUiStore.setExpanded(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    editorProjectStore.clear();
  });

  const renderTimeline = async (
    selectedPartId = fixture.partIds[0]!,
    currentTimeMs = timelineUiStore.getSnapshot().currentTimeMs,
    onSelectPart: (partId: string) => void = () => undefined,
  ): Promise<void> => {
    const { project, shot, layer } = currentLayer(fixture.layerId);
    await act(async () => root.render(createElement(PartPoseTimeline, {
      partPoseEditor: {
        ...editorUi(fixture.layerId, selectedPartId),
        onSelectPart,
      },
      shot,
      layer,
      snapshot: editorProjectStore.getSnapshot()!,
      currentTimeMs,
      pixelsPerMs: 1,
      trackWidth: 3_000,
      laneLabelWidth: 82,
    })));
    expect(project.id).toBe(editorProjectStore.getSnapshot()?.project.id);
  };

  it('deduplicates the overview and keeps seek and Part selection read-only', async () => {
    const onSelectPart = vi.fn();
    await renderTimeline(fixture.partIds[0]!, 0, onSelectPart);
    const snapshot = editorProjectStore.getSnapshot()!;
    const history = editorProjectStore.history.getSnapshot();

    expect(container.querySelectorAll('[data-testid="part-pose-overview-marker"]'))
      .toHaveLength(4);
    expect(
      container.querySelector('[data-testid="part-pose-overview-lane"]')?.textContent,
    ).toContain('人物动作');
    const overviewMarker = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-overview-marker"][data-time-ms="1000"]',
    )!;
    await act(async () => overviewMarker.click());
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_000);
    expect(onSelectPart).not.toHaveBeenCalled();
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);

    const partKey = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    await act(async () => partKey.click());
    expect(onSelectPart).toHaveBeenCalledWith(fixture.partIds[0]);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);

    await act(async () => timelineUiStore.seek(750, 3_000));
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);

    const expandOtherParts = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-expand-others"]',
    )!;
    await act(async () => expandOtherParts.click());
    expect(container.querySelectorAll('[data-testid="part-pose-part-lane"]'))
      .toHaveLength(2);
    expect(container.querySelector(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[1]}"]`,
    )).not.toBeNull();
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);
  });

  it('moves between keys on the selected Part only', async () => {
    const onSelectPart = vi.fn();
    timelineUiStore.seek(1_000, 3_000);
    await renderTimeline(fixture.partIds[0]!, 1_000, onSelectPart);
    const previous = container.querySelector<HTMLButtonElement>(
      '[aria-label="上一个 Part 姿势关键帧"]',
    )!;
    const next = container.querySelector<HTMLButtonElement>(
      '[aria-label="下一个 Part 姿势关键帧"]',
    )!;
    const snapshot = editorProjectStore.getSnapshot()!;
    const history = editorProjectStore.history.getSnapshot();

    await act(async () => previous.click());
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
    expect(onSelectPart).toHaveBeenCalledWith(fixture.partIds[0]);
    await act(async () => next.click());
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_500);
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);
    expect(container.querySelector('[data-testid="part-pose-easing"]')).toBeNull();
  });

  it('keeps Pose lanes in the existing media stack beside Subtitle and Audio', async () => {
    await act(async () => root.render(createElement(
      PendingDialoguePlacementProvider,
      null,
      createElement(TimelineDock as ComponentType<TimelineDockProps>, {
        partPoseEditor: editorUi(fixture.layerId, fixture.partIds[0]!),
        presentation: 'landscape',
      }),
    )));
    expect(container.querySelectorAll('[data-testid="timeline-ruler-track"]'))
      .toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="timeline-playhead"]'))
      .toHaveLength(1);
    const media = container.querySelector('[data-testid="timeline-audio-track"]')
      ?.closest('.timeline-media-lanes');
    expect(media?.querySelector('[data-testid="part-pose-overview-lane"]'))
      .not.toBeNull();
    expect(media?.querySelector('[data-testid="timeline-subtitle-track"]'))
      .not.toBeNull();
    expect(media?.querySelector('[data-testid="timeline-audio-track"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-testid="position-lane"]')
      ?.closest('.timeline-media-lanes')).toBeNull();
  });

  it('previews a drag without writing, then commits one retime command on release', async () => {
    await renderTimeline();
    const marker = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    Object.defineProperty(marker, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(marker, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    const snapshot = editorProjectStore.getSnapshot()!;
    const revision = snapshot.revision;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;

    await act(async () => marker.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 7, clientX: 100, button: 0,
    })));
    await act(async () => marker.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 7, clientX: 150, button: 0,
    })));
    expect(marker.dataset.dragging).toBe('true');
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);

    await act(async () => marker.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 7, clientX: 150, button: 0,
    })));
    const movedTrack = currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!;
    expect(movedTrack.keys.map((key) => key.timeMs)).toEqual([0, 542, 1_500]);
    expect(editorProjectStore.getSnapshot()?.revision).toBe(revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount + 1);
  });

  it('copies locally and gives paste, easing, and delete one Project update each', async () => {
    await renderTimeline();
    const source = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    await act(async () => source.click());
    const initialRevision = editorProjectStore.getSnapshot()!.revision;
    const initialUndoCount = editorProjectStore.history.getSnapshot().undoCount;
    const copy = container.querySelector<HTMLButtonElement>(
      '[aria-label="复制当前 Part 姿势关键帧"]',
    )!;
    await act(async () => copy.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(initialUndoCount);

    timelineUiStore.seek(750, 3_000);
    await renderTimeline(fixture.partIds[0]!, 750);
    const paste = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-paste"]',
    )!;
    expect(paste.disabled).toBe(false);
    await act(async () => paste.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(initialUndoCount + 1);

    await renderTimeline(fixture.partIds[0]!, 750);
    const easing = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-easing"]',
    )!;
    easing.value = 'step';
    await act(async () => easing.dispatchEvent(new Event('change', { bubbles: true })));
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision + 2);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.find((key) => key.timeMs === 750)?.easingToNext).toBe('step');

    await renderTimeline(fixture.partIds[0]!, 750);
    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="删除当前 Part 姿势关键帧"]',
    )!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision + 3);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(initialUndoCount + 3);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.some((key) => key.timeMs === 750)).toBe(false);

    await renderTimeline(fixture.partIds[1]!, 750);
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-paste"]',
    )?.disabled).toBe(true);
  });

  it('allows paste at the frame-aligned Shot duration boundary', async () => {
    await renderTimeline();
    const source = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    await act(async () => source.click());
    const copy = container.querySelector<HTMLButtonElement>(
      '[aria-label="复制当前 Part 姿势关键帧"]',
    )!;
    await act(async () => copy.click());

    timelineUiStore.seek(3_000, 3_000);
    await renderTimeline(fixture.partIds[0]!, 3_000);
    const paste = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-paste"]',
    )!;
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(3_000);
    expect(paste.disabled).toBe(false);

    const revision = editorProjectStore.getSnapshot()!.revision;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => paste.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount + 1);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.some((key) => key.timeMs === 3_000)).toBe(true);
  });

  it('cancels a pointer-cancelled preview without changing Project or History', async () => {
    await renderTimeline();
    const marker = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    Object.defineProperty(marker, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    const snapshot = editorProjectStore.getSnapshot()!;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => marker.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 9, clientX: 100, button: 0,
    })));
    await act(async () => marker.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 9, clientX: 150, button: 0,
    })));
    await act(async () => marker.dispatchEvent(pointerEvent('pointercancel', {
      pointerId: 9, clientX: 150, button: 0,
    })));
    expect(marker.dataset.dragging).toBe('false');
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);
  });

  it('cancels on Escape and rejects a drag after the Project revision changes', async () => {
    await renderTimeline();
    const marker = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    Object.defineProperty(marker, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(marker, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    const snapshot = editorProjectStore.getSnapshot()!;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => marker.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 12, clientX: 100, button: 0,
    })));
    await act(async () => marker.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, clientX: 150, button: 0,
    })));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true,
    })));
    expect(marker.dataset.dragging).toBe('false');
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);

    await act(async () => marker.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 13, clientX: 100, button: 0,
    })));
    await act(async () => marker.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 13, clientX: 150, button: 0,
    })));
    await act(async () => {
      layerStore.addPartPoseKeyframe(fixture.layerId, fixture.partIds[1]!, 1_250);
    });
    const revisionAfterOtherEdit = editorProjectStore.getSnapshot()!.revision;
    const undoCountAfterOtherEdit = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => marker.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 13, clientX: 150, button: 0,
    })));
    expect(editorProjectStore.getSnapshot()?.revision).toBe(revisionAfterOtherEdit);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCountAfterOtherEdit);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.map((key) => key.timeMs)).toEqual([0, 500, 1_500]);
  });
});
