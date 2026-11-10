// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  type Project,
} from '../../../../src/domain';
import type { PartPoseEditorUi } from '../../../../src/renderer/features/part-pose/partPoseEditorTypes';
import { PartPoseTimeline } from '../../../../src/renderer/features/timeline/PartPoseTimeline';
import { snapToFrame } from '../../../../src/renderer/features/timeline/timeGeometry';
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
    parts: adaptivePartsFixture(IDS.assetChar).map((part, index) => ({
      ...part,
      displayName: index === 0
        ? 'Torso'
        : index === 1
          ? 'My custom part'
          : part.displayName,
    })),
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
  values: {
    pointerId: number;
    clientX: number;
    button: number;
    pointerType?: string;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

async function doubleClickAt(
  target: HTMLElement,
  clientX: number,
  pointerType = 'mouse',
): Promise<void> {
  await act(async () => {
    for (const [index, pointerId] of [41, 42].entries()) {
      const values = { pointerId, clientX, button: 0, pointerType };
      target.dispatchEvent(pointerEvent('pointerdown', values));
      target.dispatchEvent(pointerEvent('pointerup', values));
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: index + 1,
        clientX,
      }));
    }
    target.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      detail: 2,
      clientX,
    }));
  });
}

async function clickAt(target: HTMLElement, clientX: number): Promise<void> {
  await act(async () => {
    const values = { pointerId: 61, clientX, button: 0, pointerType: 'mouse' };
    target.dispatchEvent(pointerEvent('pointerdown', values));
    target.dispatchEvent(pointerEvent('pointerup', values));
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX,
    }));
  });
}

function setPartLaneGeometry(element: HTMLElement, width = 3_000): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, width, 38),
  });
}

let container: HTMLDivElement;
let rootMount: HTMLDivElement;
let toolbarHost: HTMLDivElement;
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
    rootMount = document.createElement('div');
    toolbarHost = document.createElement('div');
    container.append(rootMount, toolbarHost);
    document.body.append(container);
    root = createRoot(rootMount);
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
      toolbarHost,
      shot,
      layer,
      snapshot: editorProjectStore.getSnapshot()!,
      currentTimeMs,
      pixelsPerMs: 1,
      trackWidth: shot.durationMs,
    })));
    expect(project.id).toBe(editorProjectStore.getSnapshot()?.project.id);
  };

  const openMoreActions = async (): Promise<void> => {
    const details = container.querySelector<HTMLDetailsElement>(
      '[data-testid="part-pose-more-actions"]',
    );
    if (!details || details.open) return;
    await act(async () => details.querySelector('summary')?.click());
  };

  it('keeps the overview read-only and collapses the selected Part without losing state', async () => {
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

    await act(async () => timelineUiStore.seek(1_500, 3_000));
    await renderTimeline(fixture.partIds[0]!, 1_500, onSelectPart);
    const selectedMarker = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    const playheadMarker = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="1500"]`,
    )!;
    expect(selectedMarker.getAttribute('aria-pressed')).toBe('true');
    expect(selectedMarker.getAttribute('aria-current')).toBeNull();
    expect(playheadMarker.getAttribute('aria-pressed')).toBe('false');
    expect(playheadMarker.getAttribute('aria-current')).toBe('time');

    const groupToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-group-toggle"]',
    )!;
    await act(async () => groupToggle.click());
    expect(groupToggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[data-testid="part-pose-part-lane"]'))
      .toHaveLength(0);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_500);
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);

    await act(async () => groupToggle.click());
    expect(groupToggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="part-pose-part-lane"]'))
      .toHaveLength(1);
    expect(container.querySelector(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="1500"]`,
    )?.getAttribute('aria-pressed')).toBe('false');

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

  it('uses the Chinese default Part label and preserves custom names', async () => {
    await renderTimeline();
    const selectedLane = container.querySelector(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"]`,
    );
    expect(selectedLane?.querySelector('.timeline-lane-label-text')?.textContent)
      .toBe('身体');

    const expandOtherParts = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-expand-others"]',
    )!;
    await act(async () => expandOtherParts.click());
    const customLane = container.querySelector(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[1]}"]`,
    );
    expect(customLane?.querySelector('.timeline-lane-label-text')?.textContent)
      .toBe('My custom part');
  });

  it('activates an expanded other Part key and keeps the project read-only', async () => {
    let selectedPartId = fixture.partIds[0]!;
    const onSelectPart = vi.fn((partId: string) => {
      selectedPartId = partId;
    });
    await renderTimeline(selectedPartId, 0, onSelectPart);
    const snapshot = editorProjectStore.getSnapshot();
    const history = editorProjectStore.history.getSnapshot();
    const expandOtherParts = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-expand-others"]',
    )!;
    await act(async () => expandOtherParts.click());

    const otherKey = container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[1]}"][data-time-ms="1000"]`,
    )!;
    await act(async () => otherKey.click());
    expect(onSelectPart).toHaveBeenCalledWith(fixture.partIds[1]);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_000);
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(history);

    await renderTimeline(selectedPartId, 1_000, onSelectPart);
    expect(container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[1]}"][data-time-ms="1000"]`,
    )?.getAttribute('aria-pressed')).toBe('true');
  });

  it('adds one snapped key on a blank selected Part lane double-click', async () => {
    await renderTimeline();
    const laneContent = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"] .timeline-lane-content`,
    )!;
    setPartLaneGeometry(laneContent);
    const revision = editorProjectStore.getSnapshot()!.revision;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;

    await doubleClickAt(laneContent, 750);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.map((key) => key.timeMs)).toContain(750);
    expect(editorProjectStore.getSnapshot()?.revision).toBe(revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount + 1);

    await renderTimeline(fixture.partIds[0]!, 750);
    expect(container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="750"]`,
    )?.getAttribute('aria-pressed')).toBe('true');

    const existingKey = currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.find((key) => key.timeMs === 750);
    const existingRevision = editorProjectStore.getSnapshot()!.revision;
    const existingUndoCount = editorProjectStore.history.getSnapshot().undoCount;
    await doubleClickAt(laneContent, 750);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.find((key) => key.timeMs === 750)).toEqual(existingKey);
    expect(editorProjectStore.getSnapshot()?.revision).toBe(existingRevision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(existingUndoCount);
  });

  it('snaps double-clicks to an aligned Shot end or the last legal frame', async () => {
    await renderTimeline();
    let laneContent = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"] .timeline-lane-content`,
    )!;
    setPartLaneGeometry(laneContent);
    await doubleClickAt(laneContent, 2_999);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.map((key) => key.timeMs)).toContain(3_000);

    const { project } = currentLayer(fixture.layerId);
    const longerProject = {
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === IDS.shot ? { ...shot, durationMs: 3_050 } : shot,
      ),
    };
    await act(async () => {
      editorProjectStore.open(PROJECT_ROOT, longerProject);
      shotStore.select(IDS.shot);
      selectionStore.select(fixture.layerId);
      timelineUiStore.seek(0, 3_050);
    });
    await renderTimeline(fixture.partIds[0]!, 0);
    laneContent = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"] .timeline-lane-content`,
    )!;
    setPartLaneGeometry(laneContent, 3_050);
    await doubleClickAt(laneContent, 3_049);
    const endKeys = currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.map((key) => key.timeMs);
    expect(endKeys).toContain(3_042);
    expect(endKeys).not.toContain(3_050);
  });

  it('does not add keys from 0ms, occupied markers, overview, touch, or other Parts', async () => {
    await renderTimeline();
    const laneContent = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"] .timeline-lane-content`,
    )!;
    setPartLaneGeometry(laneContent);
    const revision = editorProjectStore.getSnapshot()!.revision;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;

    await doubleClickAt(laneContent, 0);
    expect(container.querySelector<HTMLButtonElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="0"]`,
    )?.getAttribute('aria-pressed')).toBe('true');

    const occupiedMarker = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-key-marker"][data-part-id="${fixture.partIds[0]}"][data-time-ms="500"]`,
    )!;
    await doubleClickAt(occupiedMarker, 500);
    const overviewMarker = container.querySelector<HTMLElement>(
      '[data-testid="part-pose-overview-marker"][data-time-ms="1000"]',
    )!;
    await doubleClickAt(overviewMarker, 1_000);
    await doubleClickAt(laneContent, 750, 'touch');

    const expandOtherParts = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-expand-others"]',
    )!;
    await act(async () => expandOtherParts.click());
    const otherLane = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[1]}"] .timeline-lane-content`,
    )!;
    setPartLaneGeometry(otherLane);
    await doubleClickAt(otherLane, 750);

    expect(editorProjectStore.getSnapshot()?.revision).toBe(revision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);
    expect(currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys.map((key) => key.timeMs)).toEqual([0, 500, 1_500]);
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
    const toolbarHost = container.querySelector('[data-testid="timeline-pose-toolbar-host"]');
    const poseToolbar = toolbarHost?.querySelector('[data-testid="part-pose-toolbar"]');
    expect(poseToolbar).not.toBeNull();
    expect(poseToolbar?.closest('.timeline-ruler-scroll')).toBeNull();
    expect(container.querySelector('[data-testid="timeline-timecode"]')).not.toBeNull();
    expect(container.querySelector('.timeline-zoom')).not.toBeNull();

    const snapshot = editorProjectStore.getSnapshot();
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;
    for (const lane of [
      container.querySelector<HTMLElement>('[data-testid="timeline-subtitle-track"]'),
      container.querySelector<HTMLElement>('[data-testid="timeline-audio-track"]'),
      container.querySelector<HTMLElement>('[data-testid="position-lane"]'),
    ]) {
      const content = lane?.querySelector<HTMLElement>('.timeline-lane-content');
      if (content) await doubleClickAt(content, 750);
    }
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);
  });

  it('routes active Part blank mouse seeks and double-clicks through the lane in TimelineDock', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 3_000,
    });
    try {
      await act(async () => root.render(createElement(
        PendingDialoguePlacementProvider,
        null,
        createElement(TimelineDock as ComponentType<TimelineDockProps>, {
          partPoseEditor: editorUi(fixture.layerId, fixture.partIds[0]!),
          presentation: 'landscape',
        }),
      )));
    } finally {
      if (originalClientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          'clientWidth',
          originalClientWidth,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      }
    }

    const laneContent = container.querySelector<HTMLElement>(
      `[data-testid="part-pose-part-lane"][data-part-id="${fixture.partIds[0]}"] .timeline-lane-content`,
    )!;
    const rulerTrack = container.querySelector<HTMLElement>(
      '[data-testid="timeline-ruler-track"]',
    )!;
    setPartLaneGeometry(laneContent);
    const laneSetCapture = vi.fn();
    const laneReleaseCapture = vi.fn();
    Object.defineProperty(laneContent, 'setPointerCapture', {
      configurable: true,
      value: laneSetCapture,
    });
    Object.defineProperty(laneContent, 'hasPointerCapture', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(laneContent, 'releasePointerCapture', {
      configurable: true,
      value: laneReleaseCapture,
    });
    const rulerSetCapture = vi.fn();
    Object.defineProperty(rulerTrack, 'setPointerCapture', {
      configurable: true,
      value: rulerSetCapture,
    });

    const revision = editorProjectStore.getSnapshot()!.revision;
    const undoCount = editorProjectStore.history.getSnapshot().undoCount;
    await clickAt(laneContent, 400);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(snapToFrame(400));
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);

    await act(async () => {
      laneContent.dispatchEvent(pointerEvent('pointerdown', {
        pointerId: 62,
        clientX: 200,
        button: 0,
        pointerType: 'mouse',
      }));
      laneContent.dispatchEvent(pointerEvent('pointermove', {
        pointerId: 62,
        clientX: 650,
        button: 0,
        pointerType: 'mouse',
      }));
      laneContent.dispatchEvent(pointerEvent('pointerup', {
        pointerId: 62,
        clientX: 650,
        button: 0,
        pointerType: 'mouse',
      }));
    });
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(snapToFrame(650));
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount);

    await doubleClickAt(laneContent, 750);
    const keys = currentLayer(fixture.layerId).layer.poseAnimation!.tracks.find(
      (track) => track.partId === fixture.partIds[0],
    )!.keys;
    expect(keys.filter((key) => key.timeMs === 750)).toHaveLength(1);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoCount + 1);
    expect(laneSetCapture).toHaveBeenCalledTimes(4);
    expect(laneReleaseCapture).toHaveBeenCalledTimes(4);
    expect(rulerSetCapture).not.toHaveBeenCalled();
  });

  it('keeps essential controls and Part actions in the narrow Timeline toolbar row', async () => {
    await act(async () => root.render(createElement(
      PendingDialoguePlacementProvider,
      null,
      createElement(TimelineDock as ComponentType<TimelineDockProps>, {
        partPoseEditor: editorUi(fixture.layerId, fixture.partIds[0]!),
        presentation: 'landscape',
      }),
    )));
    const toolbar = container.querySelector<HTMLElement>(
      '[data-testid="timeline-toolbar"]',
    )!;
    expect(toolbar.querySelector('[data-testid="timeline-timecode"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="timeline-return-to-start"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="timeline-zoom-in"]')).not.toBeNull();
    const details = toolbar.querySelector<HTMLDetailsElement>(
      '[data-testid="part-pose-more-actions"]',
    )!;
    const trigger = details.querySelector<HTMLElement>('summary')!;
    const menu = details.querySelector<HTMLElement>(
      '.timeline-pose-overflow-content',
    )!;
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(300, 40, 44, 32),
    });
    Object.defineProperty(menu, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 160, 60),
    });
    await openMoreActions();
    await act(async () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    expect(menu.dataset.positioned).toBe('true');
    expect(menu.style.left).toBe('184px');
    expect(menu.style.top).toBe('77px');

    const css = readFileSync(
      'src/renderer/styles/features/timeline/part-pose-lanes.css',
      'utf8',
    );
    expect(css).toMatch(/\.timeline-dock \.timeline-header\.timeline-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.timeline-pose-overflow-content\s*\{[^}]*position:\s*fixed/s);
    expect(css).toContain(".timeline-pose-overflow-content[data-positioned='false']");
    expect(css).toContain('flex-basis: 220px;');
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
    await openMoreActions();
    const copy = container.querySelector<HTMLButtonElement>(
      '[aria-label="复制当前 Part 姿势关键帧"]',
    )!;
    await act(async () => copy.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(initialUndoCount);

    timelineUiStore.seek(750, 3_000);
    await renderTimeline(fixture.partIds[0]!, 750);
    await openMoreActions();
    const paste = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-paste"]',
    )!;
    expect(paste.disabled).toBe(false);
    await act(async () => paste.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(initialRevision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(initialUndoCount + 1);

    await renderTimeline(fixture.partIds[0]!, 750);
    await openMoreActions();
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
    await openMoreActions();
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
    await openMoreActions();
    const copy = container.querySelector<HTMLButtonElement>(
      '[aria-label="复制当前 Part 姿势关键帧"]',
    )!;
    await act(async () => copy.click());

    timelineUiStore.seek(3_000, 3_000);
    await renderTimeline(fixture.partIds[0]!, 3_000);
    await openMoreActions();
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
