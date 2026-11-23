// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement, Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  characterCompositeKeyEasing,
  characterCompositeKeyTimes,
  characterMotionValues,
  hasCompositeKeyOutgoingInterval,
  type FlaGraphicDefinition,
} from '../../src/domain';
import { CharacterMotionPart } from '../../src/renderer/features/canvas/CharacterMotionPart';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import {
  previewCharacterMotionKeyGroupShift,
  resolveNearestCharacterMotionKey,
} from '../../src/renderer/features/timeline/characterMotionKeyGesture';
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
  const bases = layer.animationClip?.version === 1 ? layer.animationClip.targetBases : [];
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
          interactionBounds: { x: 0, y: 0, width: 100, height: 100 },
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
              timelineUiStore.revealCharacterMotionPart();
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

  it('selects without seeking when clicking Part label or blank lane (mouse & touch), while keeping key/overview/ruler seek intact (#1135)', async () => {
    const fixture = multiPartMixedFixture();
    const { rightHandId, leftHandId, headId } = fixture;
    editorProjectStore.open('D:/test-v1-01-fix01-seek', fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(250, 3000);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const dispatchPointer = (target: EventTarget, type: string, pointerType: 'mouse' | 'touch', clientX: number,
      overrides: PointerEventInit = {}) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType, pointerId: 1, isPrimary: true, button: 0, clientX,
        ...overrides,
      }));
    };
    const clientWidthSpy = vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId: fixture.layerId })));

      const rulerTrack = host.querySelector<HTMLElement>('[data-testid="timeline-ruler-track"]')!;
      Object.defineProperty(rulerTrack, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(0, 0, 1000, 120),
      });

      // Mouse pointerdown + click on Part label selects without changing playhead (250ms).
      const rightLabel = host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"] .character-motion-part-select`)!;
      await act(async () => {
        dispatchPointer(rightLabel, 'pointerdown', 'mouse', 50);
        dispatchPointer(rightLabel, 'pointerup', 'mouse', 50);
        rightLabel.click();
      });
      expect(selectionStore.getSelectedCharacterPartId()).toBe(rightHandId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(250);

      // Mouse pointerdown + click on blank Part lane selects "左手" without bubbling to ruler seek.
      const leftBlankLane = host.querySelector<HTMLElement>(`[data-testid="character-motion-part-lane"][data-part-id="${leftHandId}"] .character-motion-keys`)!;
      await act(async () => {
        dispatchPointer(leftBlankLane, 'pointerdown', 'mouse', 600);
        dispatchPointer(leftBlankLane, 'pointerup', 'mouse', 600);
        leftBlankLane.click();
      });
      expect(selectionStore.getSelectedCharacterPartId()).toBe(leftHandId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(250);

      // Touch pointerdown + click on blank Part lane selects "头" without seeking.
      const headBlankLane = host.querySelector<HTMLElement>(`[data-testid="character-motion-part-lane"][data-part-id="${headId}"] .character-motion-keys`)!;
      await act(async () => {
        dispatchPointer(headBlankLane, 'pointerdown', 'touch', 750);
        dispatchPointer(headBlankLane, 'pointerup', 'touch', 750);
        headBlankLane.click();
      });
      expect(selectionStore.getSelectedCharacterPartId()).toBe(headId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(250);

      // Clicking overview marker seeks without changing selected Part ("头").
      const overview500 = host.querySelector<HTMLButtonElement>('[data-testid="character-motion-overview-marker"][data-time-ms="500"]')!;
      await act(async () => overview500.click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(headId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);

      // Clicking Composite Key still selects Part + seeks to key time.
      const leftKey1000 = host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${leftHandId}"] button[data-time-ms="1000"]`)!;
      await act(async () => leftKey1000.click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(leftHandId);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);

      // Clicking the ruler itself still seeks normally.
      const ruler = host.querySelector<HTMLElement>('[data-testid="timeline-ruler"]')!;
      await act(async () => {
        dispatchPointer(ruler, 'pointerdown', 'mouse', 0);
        dispatchPointer(ruler, 'pointerup', 'mouse', 0);
      });
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);

      const time = () => timelineUiStore.getSnapshot().currentTimeMs;
      for (const interruption of ['pointercancel', 'lostpointercapture', 'blur']) {
        await act(async () => {
          dispatchPointer(ruler, 'pointerdown', 'touch', 500, { isPrimary: false });
          dispatchPointer(ruler, 'pointerdown', 'mouse', 500, { button: 2 });
        });
        expect(time()).toBe(0);
        await act(async () => {
          dispatchPointer(ruler, 'pointerdown', 'mouse', 0);
          dispatchPointer(ruler, 'pointerdown', 'touch', 800, { pointerId: 2 });
          dispatchPointer(ruler, 'pointermove', 'touch', 800, { pointerId: 2 });
          dispatchPointer(ruler, 'pointerup', 'touch', 800, { pointerId: 2 });
        });
        expect(time()).toBe(0);
        await act(async () => dispatchPointer(ruler, 'pointermove', 'mouse', 450));
        expect(time()).toBeGreaterThan(0);
        const beforeInterruption = time();
        await act(async () => {
          for (let repeat = 0; repeat < 2; repeat++) {
            if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
            else dispatchPointer(ruler, interruption, 'mouse', 950);
          }
          dispatchPointer(ruler, 'pointermove', 'mouse', 950);
          dispatchPointer(ruler, 'pointerup', 'mouse', 950);
        });
        expect(time()).toBe(beforeInterruption);
        await act(async () => {
          dispatchPointer(ruler, 'pointerdown', 'mouse', 0);
          dispatchPointer(ruler, 'pointerup', 'mouse', 0);
        });
        expect(time()).toBe(0);
      }
    } finally {
      await act(async () => root.unmount());
      clientWidthSpy.mockRestore();
      host.remove();
    }
  });

  it('re-expands and reveals the same already-selected Part when clicked again on Canvas (#1135)', async () => {
    const fixture = multiPartMixedFixture();
    const { rightHandId, leftHandId } = fixture;
    editorProjectStore.open('D:/test-v1-01-fix01-reveal', fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    selectionStore.selectCharacterPart(rightHandId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.setScrollPx(160);
    const initialRevision = editorProjectStore.getSnapshot()!.revision;

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const selectionListener = vi.fn();
    const unsubscribeSelection = selectionStore.subscribe(selectionListener);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId: fixture.layerId })));
      const mediaLanes = host.querySelector<HTMLElement>('.timeline-media-lanes')!;
      Object.defineProperty(mediaLanes, 'clientHeight', { configurable: true, value: 40 });
      Object.defineProperty(mediaLanes, 'offsetTop', { configurable: true, value: 0 });
      mediaLanes.scrollTop = 90;

      // Collapse the "人物动作" group while "右手" is already selected.
      const toggle = host.querySelector<HTMLButtonElement>('[data-testid="character-motion-group-toggle"]')!;
      await act(async () => toggle.click());
      expect(host.querySelectorAll('[data-testid="character-motion-part-lane"]')).toHaveLength(0);
      expect(host.querySelector('[data-testid="character-motion-overview-lane"]')?.getAttribute('data-expanded')).toBe('false');

      selectionListener.mockClear();

      // Re-click the ALREADY-SELECTED "右手" on Canvas: no fake selection change, group re-expands and scrolls row into view.
      await act(async () => konvaState.partClicks.get(rightHandId)!());
      expect(selectionListener).not.toHaveBeenCalled();
      expect(selectionStore.getSelectedCharacterPartId()).toBe(rightHandId);
      expect(host.querySelector('[data-testid="character-motion-overview-lane"]')?.getAttribute('data-expanded')).toBe('true');
      const rightRow = host.querySelector<HTMLElement>(`[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"]`)!;
      expect(rightRow).not.toBeNull();
      expect(rightRow.getAttribute('data-selected-part')).toBe('true');
      expect(timelineUiStore.getSnapshot().scrollPx).toBe(160);

      // Even while expanded, if the user scrolled away, re-clicking the same Part scrolls it back into view.
      Object.defineProperty(rightRow, 'offsetTop', { configurable: true, value: 38 });
      Object.defineProperty(rightRow, 'offsetHeight', { configurable: true, value: 38 });
      mediaLanes.scrollTop = 100;
      await act(async () => konvaState.partClicks.get(rightHandId)!());
      expect(mediaLanes.scrollTop).toBe(38);
      expect(selectionListener).not.toHaveBeenCalled();

      // Collapse again and click a different Part ("左手"): still expands and focuses "左手".
      await act(async () => toggle.click());
      expect(host.querySelectorAll('[data-testid="character-motion-part-lane"]')).toHaveLength(0);
      await act(async () => konvaState.partClicks.get(leftHandId)!());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(leftHandId);
      expect(host.querySelector(`[data-testid="character-motion-part-lane"][data-part-id="${leftHandId}"]`)?.getAttribute('data-selected-part')).toBe('true');

      // Zero revision, dirty, or History pollution.
      expect(editorProjectStore.getSnapshot()!.revision).toBe(initialRevision);
      expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    } finally {
      unsubscribeSelection();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('supports key selection, prev/next navigation, delete, drag retime, copy/paste pose, easing, and single-command History (#1130)', async () => {
    const fixture = multiPartMixedFixture();
    const { rightHandId, headId } = fixture;
    editorProjectStore.open('D:/test-v1-02-key-edit', fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    selectionStore.selectCharacterPart(rightHandId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(0, 3000);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const dispatchPointer = (target: EventTarget, type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { configurable: true, value: 'mouse' });
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 9 });
      Object.defineProperty(event, 'button', { configurable: true, value: 0 });
      Object.defineProperty(event, 'clientX', { configurable: true, value: clientX });
      target.dispatchEvent(event);
    };

    const clientWidthSpy = vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(3000);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId: fixture.layerId })));

      // Initially no key selected: next jumps to 0ms, then 500ms; prev returns to 0ms.
      const prevBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-prev-key"]')!;
      const nextBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-next-key"]')!;
      const copyBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-copy-pose"]')!;
      const pasteBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-paste-pose"]')!;
      const deleteBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-delete-key"]')!;
      const easingSelect = () => host.querySelector<HTMLSelectElement>('[data-testid="character-motion-easing"]');
      const keyAt = (partId: string, timeMs: number) =>
        host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${partId}"] button[data-time-ms="${timeMs}"]`)!;

      expect(copyBtn().disabled).toBe(true);
      expect(deleteBtn().disabled).toBe(true);
      expect(easingSelect()).toBeNull();

      // Click 500ms key -> selected state + seeks + easing visible (since wait: 500ms is last key of rightHand!).
      await act(async () => keyAt(rightHandId, 500).click());
      expect(keyAt(rightHandId, 500).getAttribute('data-selected')).toBe('true');
      expect(keyAt(rightHandId, 500).getAttribute('aria-pressed')).toBe('true');
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
      expect(easingSelect()).toBeNull(); // last key has no outgoing interval
      expect(deleteBtn().disabled).toBe(false);
      expect(copyBtn().disabled).toBe(false);

      // Copy pose at 500ms, seek to 1500ms, paste pose -> atomically writes 5 channels with 1 History command.
      await act(async () => copyBtn().click());
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      await act(async () => timelineUiStore.seek(1500, 3000));
      expect(pasteBtn().disabled).toBe(false);
      await act(async () => pasteBtn().click());
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const afterPaste = editorProjectStore.getSnapshot()!.project;
      const layerAfterPaste = afterPaste.shots[0]!.layers.find((l) => l.id === fixture.layerId)!;
      expect(characterCompositeKeyTimes(layerAfterPaste, rightHandId)).toEqual([0, 500, 1500]);
      expect(characterMotionValues(afterPaste, { shotId: IDS.shot, layerId: fixture.layerId, partId: rightHandId, timeMs: 1500, autoKey: true })).toEqual({
        'transform.offsetX': 0,
        'transform.offsetY': 0,
        'transform.rotationDeg': 30,
        'transform.scaleX': 1,
        'transform.scaleY': 1,
      });

      // Prev key jumps back to 500ms; now 500ms has a next key (1500ms), so easing selector appears!
      await act(async () => prevBtn().click());
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
      expect(keyAt(rightHandId, 500).getAttribute('data-selected')).toBe('true');
      expect(easingSelect()).not.toBeNull();
      await act(async () => {
        easingSelect()!.value = 'ease-in-out';
        easingSelect()!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
      expect(
        characterCompositeKeyEasing(
          editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!,
          rightHandId,
          500,
        ),
      ).toBe('ease-in-out');

      // Drag 500ms key to 1000ms (pixelsPerMs = ~0.97 -> compute exact deltaPx from two adjacent keys' left styles).
      const key500 = keyAt(rightHandId, 500);
      const pxPerMs = Number.parseFloat(keyAt(rightHandId, 1500).style.left) / 1500;
      const beforeDrag = editorProjectStore.getSnapshot()!.project;
      await act(async () => dispatchPointer(key500, 'pointerdown', 500 * pxPerMs));
      await act(async () => dispatchPointer(key500, 'pointermove', 750 * pxPerMs));
      expect(host.querySelector('.character-motion-key-time-bubble')).not.toBeNull();
      expect(editorProjectStore.getSnapshot()!.project).toBe(beforeDrag);
      await act(async () => dispatchPointer(key500, 'pointermove', 1000 * pxPerMs));
      await act(async () => dispatchPointer(key500, 'pointerup', 1000 * pxPerMs));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(3);
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);
      expect(
        characterCompositeKeyTimes(
          editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!,
          rightHandId,
        ),
      ).toEqual([0, 1000, 1500]);

      // Undo/Redo restores drag atomically.
      await act(async () => editorProjectStore.undo());
      expect(editorProjectStore.getSnapshot()!.project).toEqual(beforeDrag);
      await act(async () => editorProjectStore.redo());
      expect(
        characterCompositeKeyTimes(
          editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!,
          rightHandId,
        ),
      ).toEqual([0, 1000, 1500]);

      // Next key jumps to 1500ms; Delete removes 1500ms only.
      await act(async () => nextBtn().click());
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1500);
      await act(async () => deleteBtn().click());
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(4);
      expect(
        characterCompositeKeyTimes(
          editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!,
          rightHandId,
        ),
      ).toEqual([0, 1000]);

      // 0ms key can be selected and copied, never deleted or dragged.
      await act(async () => keyAt(rightHandId, 0).click());
      expect(keyAt(rightHandId, 0).getAttribute('data-selected')).toBe('true');
      expect(deleteBtn().disabled).toBe(true);
      expect(copyBtn().disabled).toBe(false);
      await act(async () => dispatchPointer(keyAt(rightHandId, 0), 'pointerdown', 0));
      await act(async () => dispatchPointer(keyAt(rightHandId, 0), 'pointermove', 250 * pxPerMs));
      expect(host.querySelector('.character-motion-key-time-bubble')).toBeNull();
      await act(async () => dispatchPointer(keyAt(rightHandId, 0), 'pointerup', 250 * pxPerMs));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(4);

      // Graphic Part ("头") supports the same selection / copy-paste / easing / delete flow.
      await act(async () => keyAt(headId, 750).click());
      expect(selectionStore.getSelectedCharacterPartId()).toBe(headId);
      await act(async () => copyBtn().click());
      await act(async () => timelineUiStore.seek(1250, 3000));
      await act(async () => pasteBtn().click());
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(5);
      expect(
        characterCompositeKeyTimes(
          editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fixture.layerId)!,
          headId,
        ),
      ).toEqual([0, 750, 1250]);

      // Escape cancels an in-progress drag without modifying Project or History.
      const head750 = keyAt(headId, 750);
      const beforeEscape = editorProjectStore.getSnapshot()!.project;
      await act(async () => dispatchPointer(head750, 'pointerdown', 750 * pxPerMs));
      await act(async () => dispatchPointer(head750, 'pointermove', 500 * pxPerMs));
      expect(host.querySelector('.character-motion-key-time-bubble')).not.toBeNull();
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(host.querySelector('.character-motion-key-time-bubble')).toBeNull();
      await act(async () => dispatchPointer(head750, 'pointerup', 500 * pxPerMs));
      expect(editorProjectStore.getSnapshot()!.project).toBe(beforeEscape);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(5);

      // Stale context / locked layer safely rejects without mutating Project.
      await act(async () => keyAt(headId, 1250).click());
      await act(async () => copyBtn().click());
      const lockedProject = structuredClone(editorProjectStore.getSnapshot()!.project);
      lockedProject.shots[0]!.layers.find((l) => l.id === fixture.layerId)!.locked = true;
      await act(async () => editorProjectStore.open('D:/test-v1-02-locked', lockedProject));
      expect(host.querySelector('[data-testid="character-motion-toolbar"]')).toBeNull();
    } finally {
      clientWidthSpy.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('hides easing selector when no real outgoing interval exists and updates only sparse outgoing keys (#1136)', async () => {
    const base = multiPartMixedFixture();
    const { rightHandId, layerId } = base;
    const service = new CharacterMotionService();
    const baseTarget = { shotId: IDS.shot, layerId, partId: rightHandId };
    const layerOf = (project: typeof base.project) => project.shots[0]!.layers.find((l) => l.id === layerId)!;
    const trackOf = (project: typeof base.project, property: 'transform.rotationDeg' | 'transform.offsetX' | 'transform.offsetY' | 'transform.scaleX' | 'transform.scaleY') =>
      layerOf(project).animationClip!.tracks.find((t) => t.target.kind === 'character-part' && t.target.partId === rightHandId && t.property === property);

    // Case C: rightHand has rotationDeg [0, 500] (terminal at 500) and offsetX [0, 1000] (later composite key, no key at 500).
    const caseCProject = service.apply(base.project, { ...baseTarget, timeMs: 1000, autoKey: true }, {
      'transform.offsetX': 60,
    });
    expect(characterCompositeKeyTimes(layerOf(caseCProject), rightHandId)).toEqual([0, 500, 1000]);
    expect(hasCompositeKeyOutgoingInterval(layerOf(caseCProject), rightHandId, 500)).toBe(false);

    editorProjectStore.open('D:/test-v1-02-fix-01-case-c', caseCProject);
    shotStore.select(IDS.shot);
    selectionStore.select(layerId);
    selectionStore.selectCharacterPart(rightHandId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(0, 3000);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const clientWidthSpy = vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(3000);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId })));
      const easingSelect = () => host.querySelector<HTMLSelectElement>('[data-testid="character-motion-easing"]');
      const keyAt = (timeMs: number) =>
        host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"] button[data-time-ms="${timeMs}"]`)!;

      await act(async () => keyAt(500).click());
      expect(keyAt(500).getAttribute('data-selected')).toBe('true');
      expect(easingSelect()).toBeNull();
      expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

      // Case A + Case B: add offsetX@500 (making 0->500->1000 real outgoing) + spanning scaleX [0, 1500].
      let sparseProject = service.apply(caseCProject, { ...baseTarget, timeMs: 500, autoKey: true }, {
        'transform.offsetX': 25,
      });
      sparseProject = service.apply(sparseProject, { ...baseTarget, timeMs: 1500, autoKey: true }, {
        'transform.scaleX': 1.4,
      });
      sparseProject = structuredClone(sparseProject);
      trackOf(sparseProject, 'transform.rotationDeg')!.keys.find((k) => k.timeMs === 500)!.interpolationToNext = 'step';

      await act(async () => {
        editorProjectStore.open('D:/test-v1-02-fix-01-sparse', sparseProject);
        shotStore.select(IDS.shot);
        selectionStore.select(layerId);
        selectionStore.selectCharacterPart(rightHandId);
      });
      await act(async () => keyAt(500).click());
      expect(easingSelect()).not.toBeNull();
      expect(easingSelect()!.value).toBe('linear');

      // Change easing to ease-in -> updates only offsetX@500, leaves terminal rotationDeg@500 and spanning scaleX untouched.
      await act(async () => {
        easingSelect()!.value = 'ease-in';
        easingSelect()!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const afterEdit = editorProjectStore.getSnapshot()!.project;
      expect(trackOf(afterEdit, 'transform.offsetX')!.keys.find((k) => k.timeMs === 500)?.interpolationToNext).toBe('ease-in');
      expect(trackOf(afterEdit, 'transform.rotationDeg')!.keys.find((k) => k.timeMs === 500)?.interpolationToNext).toBe('step');
      expect(trackOf(afterEdit, 'transform.scaleX')!.keys.map((k) => k.timeMs)).toEqual([0, 1500]);
      expect(trackOf(afterEdit, 'transform.offsetY')).toBeUndefined();
      expect(trackOf(afterEdit, 'transform.scaleY')).toBeUndefined();

      // Re-selecting current easing is a no-op with 0 additional History.
      await act(async () => {
        easingSelect()!.value = 'ease-in';
        easingSelect()!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

      // Mixed outgoing intervals (offsetX='ease-in', offsetY='step') display 混合补间 (value="").
      let mixedProject = service.apply(afterEdit, { ...baseTarget, timeMs: 500, autoKey: true }, { 'transform.offsetY': 15 });
      mixedProject = service.apply(mixedProject, { ...baseTarget, timeMs: 1000, autoKey: true }, { 'transform.offsetY': 45 });
      mixedProject = structuredClone(mixedProject);
      trackOf(mixedProject, 'transform.offsetY')!.keys.find((k) => k.timeMs === 500)!.interpolationToNext = 'step';
      await act(async () => {
        editorProjectStore.open('D:/test-v1-02-fix-01-mixed', mixedProject);
        shotStore.select(IDS.shot);
        selectionStore.select(layerId);
        selectionStore.selectCharacterPart(rightHandId);
      });
      await act(async () => keyAt(500).click());
      expect(hasCompositeKeyOutgoingInterval(layerOf(mixedProject), rightHandId, 500)).toBe(true);
      expect(characterCompositeKeyEasing(layerOf(mixedProject), rightHandId, 500)).toBeNull();
      expect(easingSelect()).not.toBeNull();
      expect(easingSelect()!.value).toBe('');
      expect(easingSelect()!.options[0]?.textContent).toBe('混合补间');
    } finally {
      clientWidthSpy.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('supports Shift multi-key selection and atomic group drag retime on a single Part (#1131)', async () => {
    // Direct gesture math check: keeps frame spacing on 24fps and clamps against unselected neighbors.
    const clampedGroup = previewCharacterMotionKeyGroupShift({
      fromTimesMs: [500, 1000, 1500],
      anchorTimeMs: 1000,
      unselectedTimesMs: [0, 2000],
      deltaPx: 800,
      pixelsPerMs: 1,
      durationMs: 3000,
    });
    expect([...clampedGroup.previewTimesByOrigin.values()]).toEqual([958, 1458, 1958]);

    const fineGroup = previewCharacterMotionKeyGroupShift({
      fromTimesMs: [42, 83],
      anchorTimeMs: 42,
      unselectedTimesMs: [0],
      deltaPx: 42,
      pixelsPerMs: 1,
      durationMs: 3000,
    });
    expect(fineGroup.deltaFrames).toBe(1);
    expect([...fineGroup.previewTimesByOrigin.values()]).toEqual([83, 125]);

    const base = multiPartMixedFixture();
    const { rightHandId, headId, layerId } = base;
    const service = new CharacterMotionService();
    const target = { shotId: IDS.shot, layerId, partId: rightHandId };
    let project = service.apply(base.project, { ...target, timeMs: 500, autoKey: true }, { 'transform.offsetX': 10 });
    project = service.apply(project, { ...target, timeMs: 1000, autoKey: true }, { 'transform.offsetX': 40 });
    project = service.apply(project, { ...target, timeMs: 1500, autoKey: true }, { 'transform.offsetX': 80 });
    project = service.setCompositeKeyEasing(project, { ...target, timeMs: 500, interpolationToNext: 'ease-in-out' });

    editorProjectStore.open('D:/test-v1-03-multi-key', project);
    shotStore.select(IDS.shot);
    selectionStore.select(layerId);
    selectionStore.selectCharacterPart(rightHandId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(0, 3000);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const dispatchPointer = (targetEl: EventTarget, type: string, clientX: number, shiftKey = false) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { configurable: true, value: 'mouse' });
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 11 });
      Object.defineProperty(event, 'button', { configurable: true, value: 0 });
      Object.defineProperty(event, 'clientX', { configurable: true, value: clientX });
      Object.defineProperty(event, 'shiftKey', { configurable: true, value: shiftKey });
      targetEl.dispatchEvent(event);
    };
    const clickKey = (el: HTMLElement, shiftKey = false) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey, detail: 1 });
      el.dispatchEvent(event);
    };

    const clientWidthSpy = vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(3000);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId })));
      const laneContent = host.querySelector<HTMLElement>('.character-motion-keys')!;
      const pxPerMs = Number.parseFloat(laneContent.style.width) / 3000;
      expect(pxPerMs).toBeGreaterThan(0);

      const copyBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-copy-pose"]')!;
      const deleteBtn = () => host.querySelector<HTMLButtonElement>('[data-testid="character-motion-delete-key"]')!;
      const easingSelect = () => host.querySelector<HTMLSelectElement>('[data-testid="character-motion-easing"]');
      const selectionCount = () => host.querySelector<HTMLElement>('[data-testid="character-motion-selection-count"]');
      const keyAt = (partId: string, timeMs: number) =>
        host.querySelector<HTMLButtonElement>(`[data-testid="character-motion-part-lane"][data-part-id="${partId}"] button[data-time-ms="${timeMs}"]`)!;

      // UX-01: tooltips expose Shift multi-select discovery; single selection hides multi-count noise.
      expect(keyAt(rightHandId, 500).title).toContain('Shift 多选');
      expect(keyAt(rightHandId, 0).title).toContain('Shift 多选');
      expect(selectionCount()).toBeNull();

      // Click 500ms -> single selection; Shift+click 1000ms and 1500ms -> live count updates from null -> 2 -> 3.
      await act(async () => clickKey(keyAt(rightHandId, 500), false));
      expect(selectionCount()).toBeNull();
      await act(async () => clickKey(keyAt(rightHandId, 1000), true));
      expect(selectionCount()?.textContent).toContain('已选 2 个关键帧');
      await act(async () => clickKey(keyAt(rightHandId, 1500), true));
      expect(selectionCount()?.textContent).toContain('已选 3 个关键帧');
      expect(selectionCount()?.title).toBe('已选择 3 个关键帧 · 拖动任意一个可整体移动');
      for (const time of [500, 1000, 1500]) {
        expect(keyAt(rightHandId, time).getAttribute('data-selected')).toBe('true');
        expect(keyAt(rightHandId, time).getAttribute('aria-pressed')).toBe('true');
      }
      // Shift+click removes 1500ms -> count drops to 2; Shift+click restores -> back to 3.
      await act(async () => clickKey(keyAt(rightHandId, 1500), true));
      expect(selectionCount()?.textContent).toContain('已选 2 个关键帧');
      await act(async () => clickKey(keyAt(rightHandId, 1500), true));
      expect(selectionCount()?.textContent).toContain('已选 3 个关键帧');
      // Single-key actions disable/hide during multi-key selection.
      expect(copyBtn().disabled).toBe(true);
      expect(deleteBtn().disabled).toBe(true);
      expect(easingSelect()).toBeNull();

      // Drag middle selected key (1000ms) right by +250ms -> live preview moves all 3 keys together, commits ONE History.
      const beforeDrag = editorProjectStore.getSnapshot()!.project;
      const anchorEl = keyAt(rightHandId, 1000);
      await act(async () => dispatchPointer(anchorEl, 'pointerdown', 0));
      await act(async () => dispatchPointer(anchorEl, 'pointermove', 250 * pxPerMs));
      for (const time of [500, 1000, 1500]) {
        const el = keyAt(rightHandId, time);
        expect(el.getAttribute('data-dragging')).toBe('true');
        expect(Number.parseFloat(el.style.left)).toBeCloseTo((time + 250) * pxPerMs, 3);
      }
      expect(host.querySelectorAll('.character-motion-key-time-bubble')).toHaveLength(1);
      await act(async () => dispatchPointer(anchorEl, 'pointerup', 250 * pxPerMs));

      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const afterDrag = editorProjectStore.getSnapshot()!.project;
      const layerAfterDrag = afterDrag.shots[0]!.layers.find((l) => l.id === layerId)!;
      expect(characterCompositeKeyTimes(layerAfterDrag, rightHandId)).toEqual([0, 750, 1250, 1750]);
      expect(characterCompositeKeyEasing(layerAfterDrag, rightHandId, 750)).toBe('ease-in-out');
      for (const time of [750, 1250, 1750]) {
        expect(keyAt(rightHandId, time).getAttribute('data-selected')).toBe('true');
      }

      // Drag release without net frame shift = no-op, zero new History.
      const stayEl = keyAt(rightHandId, 1250);
      await act(async () => dispatchPointer(stayEl, 'pointerdown', 0));
      await act(async () => dispatchPointer(stayEl, 'pointermove', 4));
      await act(async () => dispatchPointer(stayEl, 'pointerup', 0));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

      // UX-03: Selecting [0, 750] and starting drag blocks IMMEDIATELY on drag-start (before pointerup),
      // emits no drag preview, preserves selection across pointerup+click, and shows short protected feedback.
      await act(async () => clickKey(keyAt(rightHandId, 750), false));
      await act(async () => clickKey(keyAt(rightHandId, 0), true));
      expect(keyAt(rightHandId, 0).getAttribute('data-selected')).toBe('true');
      expect(keyAt(rightHandId, 750).getAttribute('data-selected')).toBe('true');
      expect(selectionCount()?.textContent).toContain('已选 2 个关键帧');
      const blockedEl = keyAt(rightHandId, 750);
      await act(async () => dispatchPointer(blockedEl, 'pointerdown', 0));
      await act(async () => dispatchPointer(blockedEl, 'pointermove', 125 * pxPerMs));
      // Immediately rejected BEFORE pointerup!
      expect(host.querySelector('[role="alert"]')?.textContent).toBe('基础姿势不能批量移动');
      expect(keyAt(rightHandId, 750).getAttribute('data-dragging')).toBe('false');
      expect(keyAt(rightHandId, 0).getAttribute('data-protected')).toBe('true');
      expect(host.querySelector('.character-motion-key-time-bubble')).toBeNull();
      await act(async () => {
        dispatchPointer(blockedEl, 'pointerup', 125 * pxPerMs);
        clickKey(blockedEl, false);
      });
      // Selection [0, 750] is preserved and Project/History stay untouched.
      expect(keyAt(rightHandId, 0).getAttribute('data-selected')).toBe('true');
      expect(keyAt(rightHandId, 750).getAttribute('data-selected')).toBe('true');
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      expect(editorProjectStore.getSnapshot()!.project).toEqual(afterDrag);

      // Undo / Redo reverts and reapplies entire group atomically.
      await act(async () => editorProjectStore.undo());
      expect(editorProjectStore.getSnapshot()!.project).toEqual(beforeDrag);
      await act(async () => editorProjectStore.redo());
      expect(editorProjectStore.getSnapshot()!.project).toEqual(afterDrag);

      // Shift+clicking another Part's key switches Part and clears prior multi-selection feedback immediately.
      await act(async () => clickKey(keyAt(headId, 750), true));
      expect(selectionStore.getSelectedCharacterPartId()).toBe(headId);
      expect(keyAt(headId, 750).getAttribute('data-selected')).toBe('true');
      expect(selectionCount()).toBeNull();
    } finally {
      clientWidthSpy.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps Key/Overview sibling DOM compact on Cloud Touch while keeping 44px group toggle (#1137 / #1138)', () => {
    const css = readFileSync(
      path.resolve('src/renderer/styles/features/canvas/character-motion.css'),
      'utf8',
    );
    // Desktop compact sizing stays intact.
    expect(css).toMatch(/\.character-motion-keys button\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/u);
    expect(css).toMatch(/\.character-motion-overview-marker\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/u);
    expect(css).toMatch(/\.character-motion-group-toggle\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*28px;/u);
    // Overview glyph dot & focus ring stay restrained and crisp.
    expect(css).toMatch(/\.character-motion-overview-marker > span\s*\{[\s\S]*?width:\s*7px;[\s\S]*?height:\s*7px;/u);
    expect(css).toMatch(/\.character-motion-group-toggle:focus-visible\s*\{[\s\S]*?outline:\s*2px solid/u);
    // Cloud Touch landscape keeps standalone group toggle at 44x44px, and must NOT widen Key/Overview DOM siblings to 44px.
    expect(css).toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\]\s+\.character-motion-group-toggle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?min-height:\s*44px;/u,
    );
    expect(css).not.toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\]\s+\.character-motion-keys button[\s\S]*?width:\s*44px;/u,
    );
    expect(css).not.toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\]\s+\.character-motion-overview-marker[\s\S]*?width:\s*44px;/u,
    );
  });

  it('resolves dense touch hits (<44px apart) to a unique nearest owner without sibling stealing or desktop snapping (#1138)', async () => {
    // Pure resolver contract: <44px center spacing, overlap nearest-hit, deterministic tie-break, +/-22px cutoff.
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 100,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBe(100);
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 114,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBe(114);
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 105,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBe(100);
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 109,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBe(114);
    // Exact midpoint tie breaks deterministically to earlier timestamp regardless of input order.
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 107,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [114, 100],
      }),
    ).toBe(100);
    // Reach within +/-22px hits; beyond 22px returns null.
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 135,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBe(114);
    expect(
      resolveNearestCharacterMotionKey({
        pointerX: 137,
        trackLeft: 0,
        pixelsPerMs: 1,
        timesMs: [100, 114],
      }),
    ).toBeNull();

    const base = multiPartMixedFixture();
    const { rightHandId, layerId } = base;
    const service = new CharacterMotionService();
    const target = { shotId: IDS.shot, layerId, partId: rightHandId };
    // Dense frames: 500ms & 542ms + isolated key at 1000ms.
    let project = service.apply(base.project, { ...target, timeMs: 542, autoKey: true }, { 'transform.rotationDeg': 60 });
    project = service.apply(project, { ...target, timeMs: 1000, autoKey: true }, { 'transform.rotationDeg': 90 });

    editorProjectStore.open('D:/test-v1-polish-dense-touch', project);
    shotStore.select(IDS.shot);
    selectionStore.select(layerId);
    selectionStore.selectCharacterPart(rightHandId);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(0, 3000);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const dispatchPointer = (
      targetEl: EventTarget,
      type: string,
      pointerType: 'touch' | 'mouse',
      clientX: number,
      shiftKey = false,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { configurable: true, value: pointerType });
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 21 });
      Object.defineProperty(event, 'button', { configurable: true, value: 0 });
      Object.defineProperty(event, 'clientX', { configurable: true, value: clientX });
      Object.defineProperty(event, 'shiftKey', { configurable: true, value: shiftKey });
      targetEl.dispatchEvent(event);
    };
    const clickEl = (el: HTMLElement, shiftKey = false) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey, detail: 1 }));
    };

    // Mock clientWidth=900 (~0.27-0.30 px/ms on 3000ms Shot) so 500ms & 542ms sit ~12px (<44px) apart.
    const clientWidthSpy = vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId })));
      const lane = host.querySelector<HTMLElement>(
        `[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"] .character-motion-keys`,
      )!;
      const overviewLane = host.querySelector<HTMLElement>('.character-motion-overview-keys')!;
      const pxPerMs = Number.parseFloat(lane.style.width) / 3000;
      const center500 = 500 * pxPerMs;
      const center542 = 542 * pxPerMs;
      const center1000 = 1000 * pxPerMs;
      expect(center542 - center500).toBeGreaterThan(0);
      expect(center542 - center500).toBeLessThan(20);

      const keyAt = (timeMs: number) =>
        host.querySelector<HTMLButtonElement>(
          `[data-testid="character-motion-part-lane"][data-part-id="${rightHandId}"] button[data-time-ms="${timeMs}"]`,
        )!;
      const overviewAt = (timeMs: number) =>
        host.querySelector<HTMLButtonElement>(
          `[data-testid="character-motion-overview-marker"][data-time-ms="${timeMs}"]`,
        )!;

      // Even when sibling keyB (542ms) is the DOM target at center500, touch resolves unique owner Key A (500ms).
      await act(async () => {
        dispatchPointer(keyAt(542), 'pointerdown', 'touch', center500);
        dispatchPointer(keyAt(542), 'pointerup', 'touch', center500);
        clickEl(keyAt(542), false);
      });
      expect(keyAt(500).getAttribute('data-selected')).toBe('true');
      expect(keyAt(542).getAttribute('data-selected')).toBe('false');
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);

      // Touch closer to 542ms selects 542ms cleanly.
      const closerToB = (center500 + center542) / 2 + 2;
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', closerToB);
        dispatchPointer(lane, 'pointerup', 'touch', closerToB);
      });
      expect(keyAt(542).getAttribute('data-selected')).toBe('true');
      expect(keyAt(500).getAttribute('data-selected')).toBe('false');
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(542);

      // Shift+touch near 500ms adds 500ms to multi-selection ([500, 542]).
      await act(async () => {
        dispatchPointer(keyAt(542), 'pointerdown', 'touch', center500, true);
        dispatchPointer(keyAt(542), 'pointerup', 'touch', center500, true);
        clickEl(keyAt(542), true);
      });
      expect(keyAt(500).getAttribute('data-selected')).toBe('true');
      expect(keyAt(542).getAttribute('data-selected')).toBe('true');

      // Touch within +/-22px wide reach (center1000 + 18px) selects isolated 1000ms key.
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', center1000 + 18);
        dispatchPointer(lane, 'pointerup', 'touch', center1000 + 18);
      });
      expect(keyAt(1000).getAttribute('data-selected')).toBe('true');
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);

      // Touch on blank lane far from any key does NOT seek (preserves #1135).
      const blankX = 2200 * pxPerMs;
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', blankX);
        dispatchPointer(lane, 'pointerup', 'touch', blankX);
        clickEl(lane);
      });
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);

      // Desktop mouse 18px away from 1000ms on blank lane does NOT snap to 1000ms.
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'mouse', center1000 + 18);
        dispatchPointer(lane, 'pointerup', 'mouse', center1000 + 18);
        clickEl(lane);
      });
      expect(keyAt(1000).getAttribute('data-selected')).toBe('false');
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1000);

      // Touch drag starting at 542ms keeps unique owner 542ms even when moving far right, committing once cleanly.
      await act(async () => dispatchPointer(lane, 'pointerdown', 'touch', center542));
      await act(async () => dispatchPointer(lane, 'pointermove', 'touch', center542 + 250 * pxPerMs));
      expect(keyAt(542).getAttribute('data-dragging')).toBe('true');
      expect(keyAt(500).getAttribute('data-dragging')).toBe('false');
      await act(async () => dispatchPointer(lane, 'pointerup', 'touch', center542 + 250 * pxPerMs));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const layerAfterDrag = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerId)!;
      expect(characterCompositeKeyTimes(layerAfterDrag, rightHandId)).toEqual([0, 500, 792, 1000]);

      // Overview markers: touch at center500 dispatched on sibling overview500 or overview542 resolves unique 500ms!
      await act(async () => {
        dispatchPointer(overviewAt(500), 'pointerdown', 'touch', center500);
        dispatchPointer(overviewAt(500), 'pointerup', 'touch', center500);
        clickEl(overviewAt(500), false);
      });
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
      await act(async () => {
        dispatchPointer(overviewLane, 'pointerdown', 'touch', 792 * pxPerMs + 10);
        dispatchPointer(overviewLane, 'pointerup', 'touch', 792 * pxPerMs + 10);
      });
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(792);

      // Touch Shift-selects [500, 792] and group-drags together (1 more History); then [0, 625] blocks at drag-start.
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', center500, false);
        dispatchPointer(lane, 'pointerup', 'touch', center500, false);
      });
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', 792 * pxPerMs, true);
        dispatchPointer(lane, 'pointerup', 'touch', 792 * pxPerMs, true);
      });
      await act(async () => dispatchPointer(lane, 'pointerdown', 'touch', center500));
      await act(async () => dispatchPointer(lane, 'pointermove', 'touch', center500 + 125 * pxPerMs));
      expect(keyAt(500).getAttribute('data-dragging')).toBe('true');
      expect(keyAt(792).getAttribute('data-dragging')).toBe('true');
      await act(async () => dispatchPointer(lane, 'pointerup', 'touch', center500 + 125 * pxPerMs));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
      const afterTouchBatch = editorProjectStore.getSnapshot()!.project;
      expect(
        characterCompositeKeyTimes(
          afterTouchBatch.shots[0]!.layers.find((l) => l.id === layerId)!,
          rightHandId,
        ),
      ).toEqual([0, 625, 917, 1000]);

      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', 625 * pxPerMs, false);
        dispatchPointer(lane, 'pointerup', 'touch', 625 * pxPerMs, false);
      });
      await act(async () => {
        dispatchPointer(lane, 'pointerdown', 'touch', 0, true);
        dispatchPointer(lane, 'pointerup', 'touch', 0, true);
      });
      await act(async () => dispatchPointer(lane, 'pointerdown', 'touch', 625 * pxPerMs));
      await act(async () => dispatchPointer(lane, 'pointermove', 'touch', 625 * pxPerMs + 40));
      expect(host.querySelector('[role="alert"]')?.textContent).toBe('基础姿势不能批量移动');
      expect(keyAt(625).getAttribute('data-dragging')).toBe('false');
      await act(async () => dispatchPointer(lane, 'pointerup', 'touch', 625 * pxPerMs + 40));
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    } finally {
      clientWidthSpy.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
