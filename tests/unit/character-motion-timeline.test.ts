// @vitest-environment happy-dom
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
    const dispatchPointer = (target: EventTarget, type: string, pointerType: 'mouse' | 'touch', clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { configurable: true, value: pointerType });
      Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
      Object.defineProperty(event, 'button', { configurable: true, value: 0 });
      Object.defineProperty(event, 'clientX', { configurable: true, value: clientX });
      target.dispatchEvent(event);
    };
    try {
      await act(async () => root.render(createElement(EditorTriadHarness, { layerId: fixture.layerId })));

      const rulerScroll = host.querySelector<HTMLElement>('[data-testid="timeline-ruler-scroll"]')!;
      const rulerTrack = host.querySelector<HTMLElement>('[data-testid="timeline-ruler-track"]')!;
      Object.defineProperty(rulerScroll, 'clientWidth', { configurable: true, value: 1000 });
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
    } finally {
      await act(async () => root.unmount());
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
});
