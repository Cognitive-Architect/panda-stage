// @vitest-environment happy-dom
import { act, createElement, Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  type FlaGraphicDefinition,
} from '../../src/domain';
import { CharacterMotionPart } from '../../src/renderer/features/canvas/CharacterMotionPart';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { PendingDialoguePlacementProvider } from '../../src/renderer/features/timeline/PendingDialoguePlacement';
import { TimelineDock } from '../../src/renderer/features/timeline/TimelineDock';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { RightInspector, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

const konvaState = vi.hoisted(() => ({
  partClicks: new Map<string, () => void>(),
}));

vi.mock('react-konva', async () => {
  const { createElement: element } = await import('react');
  const primitive = (props: Record<string, unknown>) => {
    if (typeof props.id === 'string' && props.id.endsWith(':body') && typeof props.onClick === 'function') {
      const [, partId] = props.id.split(':');
      if (partId) konvaState.partClicks.set(partId, () => (props.onClick as (event: unknown) => void)({ cancelBubble: false }));
    }
    return element('div', { 'data-konva-name': props.name, 'data-konva-id': props.id }, props.children as never);
  };
  return { Group: primitive, Rect: primitive, Circle: primitive, Line: primitive };
});

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function multiPartMixedFixture() {
  const initial = graphicFaceProject();
  const definition = initial.animations[0] as FlaGraphicDefinition;
  definition.source.sourceFps = 4;
  definition.durationMs = 1000;
  definition.frames = definition.frames.map((frame, ordinal) => ({ ...frame, startMs: ordinal * 250, durationMs: 250 }));
  const baseParts = adaptivePartsFixture(IDS.assetChar);
  const parts = [
    { ...baseParts[0]!, displayName: '右手' },
    { ...baseParts[1]!, displayName: '左手' },
    {
      ...baseParts[2]!,
      displayName: '头',
      assetId: undefined,
      imageMapping: undefined,
      visualSource: { kind: 'fla-graphic' as const, animationId: FACE_GRAPHIC_ID },
    },
    { ...baseParts[3]!, displayName: '身体' },
  ];
  const created = new CharacterService().createAdaptiveParts(ProjectSchema.parse(initial), {
    name: 'Four Part Mixed Character',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts,
  });
  const characterId = created.characters.at(-1)!.id;
  const placed = new LayerService().createFromAdaptiveCharacter(created, IDS.shot, characterId, { x: 960, y: 540 });
  const [rightHandId, leftHandId, headId, bodyId] = parts.map((part) => part.partId) as [string, string, string, string];
  const service = new CharacterMotionService();
  let project = service.apply(
    placed.project,
    { shotId: IDS.shot, layerId: placed.layer.id, partId: rightHandId, timeMs: 500, autoKey: true },
    { 'transform.rotationDeg': 30 },
  );
  project = service.apply(
    project,
    { shotId: IDS.shot, layerId: placed.layer.id, partId: leftHandId, timeMs: 1000, autoKey: true },
    { 'transform.offsetX': 40 },
  );
  project = service.apply(
    project,
    { shotId: IDS.shot, layerId: placed.layer.id, partId: headId, timeMs: 750, autoKey: true },
    { 'transform.scaleX': 1.2, 'transform.scaleY': 1.2 },
  );
  return { project, layerId: placed.layer.id, rightHandId, leftHandId, headId, bodyId };
}

function CanvasMotionStub({ layerId }: { layerId: string }) {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot)!;
  const selectedPartId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const layer = snapshot.project.shots[0]!.layers.find((candidate) => candidate.id === layerId)!;
  const bases = layer.animationClip?.targetBases ?? [];
  return createElement(
    'div',
    { 'data-testid': 'canvas-stub' },
    bases.map((basis) => {
      const partId = basis.target.partId;
      const isSelected = partId === selectedPartId;
      return createElement(
        'div',
        { key: partId, 'data-canvas-part-id': partId, 'data-canvas-selected': String(isSelected) },
        createElement(CharacterMotionPart, {
          part: {
            partId,
            ownerLayerId: layerId,
            slot: 'body',
            source: basis.visualSource.kind === 'fla-graphic'
              ? { kind: 'adaptive-part-fla-graphic', characterPartId: partId, animationId: basis.visualSource.animationId }
              : { kind: 'adaptive-part', characterPartId: partId, assetId: basis.visualSource.assetId },
            localRect: { x: 0, y: 0, width: 100, height: 100 },
            rotationDeg: 0,
            flipX: false,
            drawOrder: basis.drawOrder,
            ownerZIndex: 1,
          },
          motion: {
            selectedPartId,
            contextKey: 'ctx',
            enabled: true,
            pivot: () => ({ x: 50, y: 50 }),
            select: (id) => {
              selectionStore.select(layerId);
              selectionStore.selectCharacterPart(id);
            },
            begin: (id) =>
              new CharacterMotionGesture(
                editorProjectStore,
                { shotId: IDS.shot, layerId, partId: id, timeMs: timelineUiStore.getSnapshot().currentTimeMs, autoKey: true },
                () => true,
              ),
            error: () => undefined,
          },
          owner: { current: null },
          children: null,
        }),
      );
    }),
  );
}

function EditorTriadHarness({ layerId }: { layerId: string }) {
  return createElement(
    PendingDialoguePlacementProvider,
    null,
    createElement(
      Fragment,
      null,
      createElement(CanvasMotionStub, { layerId }),
      createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' }),
      createElement(TimelineDock),
    ),
  );
}

describe('Character Motion multi-part Timeline & bidirectional selection (#1129)', () => {
  afterEach(() => {
    konvaState.partClicks.clear();
    selectionStore.clear();
    editorProjectStore.clear();
    timelineUiStore.setCharacterMotionAutoKey(false);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(0, 3000);
  });

  it('shows 3+ mixed Image/Graphic authored parts + current Part only, and syncs Canvas <-> Timeline <-> Inspector', async () => {
    const fixture = multiPartMixedFixture();
    const { rightHandId, leftHandId, headId, bodyId } = fixture;
    editorProjectStore.open('D:/test-v1-01-timeline', fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    timelineUiStore.seek(0, 3000);
    timelineUiStore.setExpanded(true);
    const initialRevision = editorProjectStore.getSnapshot()!.revision;

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId: fixture.layerId })));

      // No Part selected yet: only the 3 authored parts (Image + Graphic) appear, not the un-authored 4th part ("身体").
      const partRows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="character-motion-part-lane"]')];
      expect(partRows().map((row) => row.dataset.partId)).toEqual([rightHandId, leftHandId, headId]);
      expect(partRows().map((row) => row.querySelector('.timeline-lane-label-text')!.textContent)).toEqual(['右手', '左手', '头']);
      expect(host.querySelector('[data-testid="character-motion-overview-lane"]')).not.toBeNull();
      expect(
        [...host.querySelectorAll<HTMLElement>('[data-testid="character-motion-overview-marker"]')].map((el) => Number(el.dataset.timeMs)),
      ).toEqual([0, 500, 750, 1000]);

      // PositionLane, subtitle, and audio lanes stay intact.
      expect(host.querySelector('[data-testid="position-lane"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="timeline-subtitle-track"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="timeline-audio-track"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="timeline-sfx-track"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="timeline-bgm-track"]')).not.toBeNull();

      // Canvas selects un-authored Part ("身体"): Timeline adds & focuses "身体" without flooding all un-authored parts, Inspector syncs.
      await act(async () => konvaState.partClicks.get(bodyId)!());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(bodyId);
      expect(partRows().map((row) => row.dataset.partId)).toEqual([rightHandId, leftHandId, headId, bodyId]);
      expect(host.querySelector(`[data-testid="character-motion-part-lane"][data-part-id="${bodyId}"]`)?.getAttribute('data-selected-part')).toBe('true');
      expect(host.querySelector('[data-testid="right-inspector-part-context"] strong')?.textContent).toBe('身体');
      expect(host.querySelector<HTMLSelectElement>('select[aria-label="人物动作部件"]')?.value).toBe(bodyId);
      expect(host.querySelector(`[data-canvas-part-id="${bodyId}"] [data-konva-name="character-motion-selection"]`)).not.toBeNull();

      // Timeline clicks "左手" Composite Key at 1000ms: Canvas highlights "左手", Inspector syncs, Playhead seeks to 1000ms, un-authored "身体" drops out.
      const leftHandKey1000 = host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${leftHandId}"] button[data-time-ms="1000"]`)!;
      await act(async () => leftHandKey1000.click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(leftHandId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);
      expect(leftHandKey1000.getAttribute('aria-current')).toBe('true');
      expect(partRows().map((row) => row.dataset.partId)).toEqual([rightHandId, leftHandId, headId]);
      expect(host.querySelector(`[data-testid="character-motion-part-lane"][data-part-id="${leftHandId}"]`)?.getAttribute('data-selected-part')).toBe('true');
      expect(host.querySelector(`[data-canvas-part-id="${leftHandId}"] [data-konva-name="character-motion-selection"]`)).not.toBeNull();
      expect(host.querySelector(`[data-canvas-part-id="${rightHandId}"] [data-konva-name="character-motion-selection"]`)).toBeNull();
      expect(host.querySelector('[data-testid="right-inspector-part-context"] strong')?.textContent).toBe('左手');

      // Timeline clicks Graphic Part ("头") label button: Canvas & Inspector switch to "头" without changing playhead.
      const headLabelButton = host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${headId}"] .character-motion-part-select`)!;
      await act(async () => headLabelButton.click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(headId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);
      expect(host.querySelector(`[data-testid="character-motion-part-lane"][data-part-id="${headId}"]`)?.getAttribute('data-selected-part')).toBe('true');
      expect(host.querySelector(`[data-canvas-part-id="${headId}"] [data-konva-name="character-motion-selection"]`)).not.toBeNull();
      expect(host.querySelector('[data-testid="right-inspector-part-context"] strong')?.textContent).toBe('头');

      // 0ms key click on "右手" selects "右手" and seeks to 0ms.
      const rightHandKey0 = host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"] button[data-time-ms="0"]`)!;
      await act(async () => rightHandKey0.click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(rightHandId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
      expect(rightHandKey0.getAttribute('aria-current')).toBe('true');

      // Collapse group hides part rows, Canvas selection re-expands & focuses the selected row.
      const toggle = host.querySelector<HTMLButtonElement>('[data-testid="character-motion-group-toggle"]')!;
      await act(async () => toggle.click());
      expect(partRows()).toHaveLength(0);
      await act(async () => konvaState.partClicks.get(headId)!());
      expect(partRows().map((row) => row.dataset.partId)).toEqual([rightHandId, leftHandId, headId]);
      expect(host.querySelector(`[data-testid="character-motion-part-lane"][data-part-id="${headId}"]`)?.getAttribute('data-selected-part')).toBe('true');

      // Selection/seek are pure transient UI state: zero revision, dirty, history, or composite persistence.
      expect(editorProjectStore.getSnapshot()!.revision).toBe(initialRevision);
      expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      expect(JSON.stringify(editorProjectStore.getSnapshot()!.project)).not.toMatch(/compositeKeys|poseKeys|poseAnimation/);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('auto-scrolls the vertical media lane viewport to bring Canvas-selected Part into view without resetting horizontal scroll', async () => {
    const fixture = multiPartMixedFixture();
    editorProjectStore.open('D:/test-v1-01-scroll', fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.setScrollPx(180);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(PendingDialoguePlacementProvider, null, createElement(TimelineDock))));
      const mediaLanes = host.querySelector<HTMLElement>('.timeline-media-lanes')!;
      const headRow = host.querySelector<HTMLElement>(`[data-testid="character-motion-part-lane"][data-part-id="${fixture.headId}"]`)!;
      Object.defineProperty(mediaLanes, 'clientHeight', { configurable: true, value: 40 });
      Object.defineProperty(mediaLanes, 'offsetTop', { configurable: true, value: 0 });
      Object.defineProperty(headRow, 'offsetTop', { configurable: true, value: 114 });
      Object.defineProperty(headRow, 'offsetHeight', { configurable: true, value: 38 });
      mediaLanes.scrollTop = 0;

      await act(async () => selectionStore.selectCharacterPart(fixture.headId));
      expect(mediaLanes.scrollTop).toBe(112);
      expect(timelineUiStore.getSnapshot().scrollPx).toBe(180);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
