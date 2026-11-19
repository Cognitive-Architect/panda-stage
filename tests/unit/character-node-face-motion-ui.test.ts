// @vitest-environment happy-dom
import { act, createElement, Fragment, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  characterNodeMotionScaleBounds,
  evaluateCompositeFacePoseAtTime,
  evaluateShotAtTime,
  ProjectSchema,
  resolveLayerVisualParts,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { CharacterMotionPart, type CharacterMotionCanvas } from '../../src/renderer/features/canvas/CharacterMotionPart';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import { resolveCharacterView } from '../../src/renderer/features/characters/characterView';
import * as alphaBounds from '../../src/renderer/features/characters/measureImageVisibleBounds';
import { CharacterMotionLane } from '../../src/renderer/features/timeline/CharacterMotionLane';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import {
  getRightInspectorLayerSummary,
  RightInspector,
  type RightInspectorProps,
} from '../../src/renderer/shell/RightInspector';
import { EditorProjectStore, editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { buildProject, IDS } from './domain/testProject';

const konvaNodes = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const konvaOrder = vi.hoisted(() => [] as string[]);

vi.mock('react-konva', async () => {
  const { createElement: element } = await import('react');
  const makePrimitive = (kind: string) =>
    function KonvaMock(props: Record<string, unknown>) {
      const key =
        typeof props.name === 'string'
          ? typeof props.id === 'string' && props.name === 'character-motion-part'
            ? `${props.name}:${props.id}`
            : props.name
          : kind;
      if (typeof props.name === 'string') {
        konvaNodes.set(key, props);
        konvaOrder.push(key);
      }
      return element('div', { 'data-konva-kind': kind, 'data-konva-name': props.name ?? kind }, props.children as never);
    };
  return {
    Group: makePrimitive('Group'),
    Rect: makePrimitive('Rect'),
    Circle: makePrimitive('Circle'),
    Line: makePrimitive('Line'),
    Image: makePrimitive('Image'),
    Text: makePrimitive('Text'),
    Transformer: makePrimitive('Transformer'),
  };
});

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const HEAD_ASSET_ID = '10000000-0000-4000-8000-000000000097';

afterEach(() => {
  vi.restoreAllMocks();
  konvaNodes.clear();
  konvaOrder.length = 0;
  selectionStore.clear();
  editorProjectStore.clear();
  timelineUiStore.seek(0, 2_000);
  timelineUiStore.setCharacterMotionAutoKey(false);
});

function reactProps(node: Element) {
  return (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[
    Object.keys(node).find((key) => key.startsWith('__reactProps$'))!
  ]!;
}

function compositeUiProject(faceKind: 'image' | 'graphic', head = true) {
  const base = faceKind === 'graphic' ? graphicFaceProject() : buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: HEAD_ASSET_ID,
        kind: 'image',
        name: '头部',
        relativePath: 'head.png',
        mimeType: 'image/png',
        width: 300,
        height: 280,
        usage: 'character',
        keywords: [],
      },
    ],
    characters: base.characters.map((character) =>
      character.id !== IDS.character || character.mode === 'adaptive-parts'
        ? character
        : {
            id: character.id,
            name: character.name,
            mode: 'composite' as const,
            ...(faceKind === 'graphic'
              ? { baseAssetId: undefined }
              : { baseAssetId: character.baseAssetId }),
            bodyAssetId: IDS.assetChar2,
            bodyPlacement: { offsetX: 0, offsetY: 50, scale: 1 },
            facePlacement: { offsetX: 10, offsetY: -10, scale: 1.2, rotationDeg: 15, flipX: false },
            ...(head
              ? {
                  head: {
                    assetId: HEAD_ASSET_ID,
                    placement: { offsetX: 0, offsetY: -40, scale: 1, rotationDeg: 0, flipX: false },
                    pivot: { x: 0, y: 15 },
                  },
                }
              : {}),
            defaultVoiceProfileId: character.defaultVoiceProfileId,
            defaultExpressionId: IDS.expressionNormal,
            expressions:
              faceKind === 'graphic'
                ? [
                    { id: IDS.expressionNormal, name: '平静', visualSource: faceSource(0) },
                    { id: IDS.expressionAngry, name: '生气', visualSource: faceSource(2) },
                  ]
                : character.expressions,
            defaultScale: character.defaultScale,
            defaultFlipX: character.defaultFlipX,
          },
    ),
    shots: base.shots.map((shot) => ({ ...shot, durationMs: 2_000 })),
  });
}

function fakeImages(project: ReturnType<typeof compositeUiProject>) {
  const map = new Map<string, HTMLImageElement>();
  for (const asset of project.assets) {
    if (asset.kind === 'image') {
      map.set(asset.id, {
        complete: true,
        naturalWidth: asset.width,
        naturalHeight: asset.height,
        width: asset.width,
        height: asset.height,
      } as HTMLImageElement);
    }
  }
  return map;
}

describe('Composite Face Node Motion Canvas + Inspector + Timeline UI (#1158)', () => {
  it.each(['image', 'graphic'] as const)(
    'Canvas %s Face exposes CharacterMotionPart on top of Body/Head, commits one gesture command, and uses headGroup pointer space',
    async (faceKind) => {
      vi.spyOn(alphaBounds, 'measureImageVisibleBounds').mockReturnValue({
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
      });
      const project = compositeUiProject(faceKind, true);
      const editor = new EditorProjectStore();
      editor.open('D:/test-composite-canvas-ui', project);
      const shot = editor.getSnapshot()!.project.shots[0]!;
      const layer = shot.layers.find((entry) => entry.id === IDS.layerChar)!;

      // Test SelectableLayer render structure with characterMotion active (mirrors CanvasStage):
      // body & head must render before face without stealing face clicks!
      const evaluated = evaluateShotAtTime(shot, 500, project);
      const evalLayer = {
        ...evaluated.layers.find((entry) => entry.id === IDS.layerChar)!,
        headGroupTransform: { translateX: 6, translateY: -4, scaleX: 1, scaleY: 1, rotationDeg: 5 },
      };
      const visual = resolveLayerVisualParts(project, shot, evalLayer, 500);
      const view = resolveCharacterView(project, layer, visual)!;

      const motionCanvas: CharacterMotionCanvas = {
        selectedPartId: null,
        selectedTargetId: 'face',
        contextKey: 'ctx-1',
        enabled: true,
        capabilities: (targetId) => view.nodes.find((n) => n.id === targetId)!.capabilities,
        scaleBounds: () =>
          characterNodeMotionScaleBounds(editor.getSnapshot()!.project, {
            shotId: IDS.shot,
            layerId: IDS.layerChar,
            nodeId: 'face',
            autoKey: true,
          }),
        pivot: () => {
          const pose = evaluateCompositeFacePoseAtTime(editor.getSnapshot()!.project, layer, 500)!;
          return { x: pose.offsetX, y: pose.offsetY };
        },
        select: vi.fn(),
        begin: () =>
          new CharacterMotionGesture(
            editor,
            { shotId: IDS.shot, layerId: IDS.layerChar, nodeId: 'face', timeMs: 500, autoKey: true },
            () => true,
          ),
        error: (msg) => {
          throw new Error(msg);
        },
      };

      const stageModel = buildEditorTemporalCanvasModel({
        project,
        shot,
        currentTimeMs: 500,
        readyAssetIds: new Set(project.assets.map((asset) => asset.id)),
        missingAssetIds: new Set(),
        previousVisuals: new Map(),
      }).stageModel;
      const renderInstruction = stageModel.layers.find((entry) => entry.layer.id === layer.id)!.render;

      const element = document.createElement('div');
      document.body.append(element);
      const root = createRoot(element);
      try {
        await act(async () =>
          root.render(
            createElement(SelectableLayer, {
              images: fakeImages(project),
              layer,
              nodeRef: { current: null },
              render: renderInstruction,
              selected: true,
              visual,
              characterView: view,
              selectedCharacterNodeId: 'face',
              characterMotion: motionCanvas,
              onSelect: vi.fn(),
              onCommitPosition: vi.fn(),
              onCommitTransform: vi.fn(),
              onError: vi.fn(),
            }),
          ),
        );

        // Order: selectable-canvas-visual -> body hit area -> selectable-canvas-head-group -> head hit area -> CharacterMotionPart (`face`) -> handles
        expect(konvaNodes.has('character-motion-selection')).toBe(true);
        expect(konvaNodes.has('character-motion-rotate')).toBe(true);
        expect(konvaNodes.has('character-motion-scale')).toBe(true);
        const visualGroupProps = konvaNodes.get('selectable-canvas-visual')!;
        expect(visualGroupProps.listening).toBe(true);
        expect(konvaOrder.indexOf('selectable-canvas-head-group')).toBeGreaterThan(
          konvaOrder.indexOf('composite-visual-hit-area'),
        );
        expect(konvaOrder.indexOf(`character-motion-part:${IDS.layerChar}:face:body`)).toBeGreaterThan(
          konvaOrder.indexOf('composite-visual-hit-area'),
        );

        // Now verify pointer manipulation with CharacterMotionPart + pointerOwner (headGroupRef vs owner)
        // commits one command per gesture (60 move/rotate/scale updates) and syncs Undo/Redo + Export.
        konvaNodes.clear();
        for (const kind of ['move', 'rotate', 'scale'] as const) {
          let pointer = kind === 'rotate' ? { x: 10, y: -70 } : kind === 'scale' ? { x: 70, y: -10 } : { x: 10, y: -10 };
          const owner = { current: { getRelativePointerPosition: () => ({ x: 9999, y: 9999 }) } };
          const headGroupRef = { current: { getRelativePointerPosition: () => pointer } };
          const facePart = visual.parts.find((part) => part.slot === 'face')!;

          await act(async () =>
            root.render(
              createElement(CharacterMotionPart, {
                part: facePart,
                targetId: 'face',
                capabilities: view.nodes.find((n) => n.id === 'face')!.capabilities,
                interactionBounds: { x: 0, y: 0, width: facePart.localRect.width, height: facePart.localRect.height },
                motion: motionCanvas,
                owner: owner as never,
                pointerOwner: headGroupRef as never,
                children: createElement('span'),
              }),
            ),
          );

          let pos = { x: 0, y: 0 };
          const node = {
            position(next?: typeof pos) {
              if (next) pos = next;
              return pos;
            },
            stopDrag: vi.fn(),
            getLayer: () => ({ batchDraw: vi.fn() }),
          };
          const evt = { cancelBubble: false, target: node };
          const konvaName = kind === 'move' ? `character-motion-part:${IDS.layerChar}:face:body` : `character-motion-${kind}`;
          const invoke = (handler: string) =>
            (konvaNodes.get(konvaName)![handler] as (e: unknown) => void)(evt);
          node.stopDrag.mockImplementation(() => invoke('onDragEnd'));

          const undoBefore = editor.history.getSnapshot().undoCount;
          await act(async () => invoke('onDragStart'));
          for (let step = 1; step <= 60; step += 1) {
            pointer =
              kind === 'move'
                ? { x: 10 + step * 0.5, y: -10 + step * 0.25 }
                : kind === 'rotate'
                  ? {
                      x: 10 + 60 * Math.sin(((step * 30) / 60) * (Math.PI / 180)),
                      y: -10 - 60 * Math.cos(((step * 30) / 60) * (Math.PI / 180)),
                    }
                  : { x: 10 + 60 * (1 + step / 120), y: -10 };
            await act(async () => invoke('onDragMove'));
          }
          await act(async () => invoke('onDragEnd'));

          expect(editor.history.getSnapshot().undoCount).toBe(undoBefore + 1);
          const committedProject = editor.getSnapshot()!.project;
          const poseAfter = evaluateCompositeFacePoseAtTime(
            committedProject,
            committedProject.shots[0]!.layers.find((entry) => entry.id === IDS.layerChar)!,
            500,
          )!;
          if (kind === 'move') {
            expect(poseAfter.offsetX).toBeCloseTo(40, 5);
            expect(poseAfter.offsetY).toBeCloseTo(5, 5);
          } else if (kind === 'rotate') {
            expect(poseAfter.rotationDeg).toBeCloseTo(45, 4);
          } else {
            expect(poseAfter.scaleX).toBeCloseTo(1.8, 4);
            expect(poseAfter.scaleY).toBeCloseTo(poseAfter.scaleX, 10);
          }
          // Check Export renders the updated animated Face Pose directly.
          const exportEvaluated = evaluateExportShotAtTime(committedProject, committedProject.shots[0]!, 500);
          const exportVisual = resolveLayerVisualParts(
            committedProject,
            committedProject.shots[0]!,
            exportEvaluated.layers.find((entry) => entry.id === IDS.layerChar)!,
            500,
          );
          expect(exportVisual.facePlacement?.offsetX).toBeCloseTo(poseAfter.offsetX, 6);
          expect(exportVisual.facePlacement?.rotationDeg).toBeCloseTo(poseAfter.rotationDeg, 6);
        }

        // Undo reverts back cleanly one gesture at a time.
        expect(editor.history.getSnapshot().undoCount).toBe(3);
        await act(async () => editor.undo());
        await act(async () => editor.undo());
        await act(async () => editor.undo());
        expect(editor.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.layerChar)!.animationClip).toBeUndefined();
      } finally {
        await act(async () => root.unmount());
        element.remove();
      }
    },
  );

  it('syncs Inspector + Timeline Face Motion: Auto-Key OFF/ON, Graphic Preview, Copy/Paste, Easing, Retime, Delete & Undo/Redo', async () => {
    const project = compositeUiProject('graphic', true);
    editorProjectStore.open('D:/test-composite-sync-ui', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    timelineUiStore.seek(500, 2_000);
    timelineUiStore.setCharacterMotionAutoKey(false);

    function Harness() {
      const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot)!;
      const ui = useSyncExternalStore(timelineUiStore.subscribe, timelineUiStore.getSnapshot);
      const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
      const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
      return createElement(
        Fragment,
        null,
        createElement('div', { ref: setToolbarHost, 'data-testid': 'toolbar-host' }),
        createElement(CharacterMotionLane, {
          project: snapshot.project,
          shot: snapshot.project.shots[0]!,
          layerId,
          currentTimeMs: ui.currentTimeMs,
          pixelsPerMs: 0.2,
          toolbarHost,
        }),
        createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' }),
      );
    }

    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => root.render(createElement(Harness)));

      // Switch selector from 角色整体 -> 脸部
      const selectEl = element.querySelector<HTMLSelectElement>('.character-motion-controls select')!;
      await act(async () => {
        selectEl.value = 'face';
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(selectionStore.getSelectedCharacterNodeId()).toBe('face');

      // Verify GraphicFacePreview + part context + ExpressionAtTimeControl + transform panel are mounted!
      const contextCard = element.querySelector('[data-testid="right-inspector-part-context"]')!;
      expect(contextCard.querySelector('strong')!.textContent).toBe('脸部');
      expect(contextCard.querySelector('canvas[data-first-frame="0"]')).not.toBeNull();
      expect(element.querySelector('[data-testid="expression-at-time"]')).not.toBeNull();

      // Auto-Key OFF edit writes static FacePlacement only (no Clip v3)
      const xInput = () => element.querySelector<HTMLInputElement>('[aria-label="位置 X"]')!;
      await act(async () => {
        xInput().focus();
        reactProps(xInput()).onChange!({ target: { value: '25' } });
      });
      await act(async () => {
        element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        xInput().blur();
      });
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.layerChar)!.animationClip).toBeUndefined();
      const charOff = editorProjectStore.getSnapshot()!.project.characters[0]!;
      expect(charOff.mode === 'composite' && charOff.facePlacement.offsetX).toBe(25);

      // Toggle Auto-Key ON via Inspector button -> edits at 500ms create Clip v3 keys [0, 500]
      const autoKeyBtn = element.querySelector<HTMLButtonElement>('.character-motion-controls button')!;
      expect(autoKeyBtn.disabled).toBe(false);
      await act(async () => autoKeyBtn.click());
      expect(timelineUiStore.getSnapshot().characterMotionAutoKey).toBe(true);

      await act(async () => {
        xInput().focus();
        reactProps(xInput()).onChange!({ target: { value: '65' } });
      });
      await act(async () => {
        element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        xInput().blur();
      });
      const layerAfterAuto = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.layerChar)!;
      expect(layerAfterAuto.animationClip?.version).toBe(3);

      // Timeline face lane displays diamonds at 0ms and 500ms!
      const faceLane = () =>
        element.querySelector<HTMLElement>('[data-testid="character-node-lane"][data-character-node-id="face"]')!;
      const faceDiamond = (ms: number) =>
        faceLane().querySelector<HTMLButtonElement>(`button[data-time-ms="${ms}"]`)!;
      expect(faceDiamond(0)).not.toBeNull();
      expect(faceDiamond(500)).not.toBeNull();
      expect(element.querySelector('[data-testid="character-motion-toolbar"]')).not.toBeNull();

      // Click 500ms diamond -> enables Copy & Delete; Copy Pose -> seek 1000ms -> Paste Pose -> creates 1000ms key!
      await act(async () => faceDiamond(500).click());
      expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
      const copyBtn = element.querySelector<HTMLButtonElement>('[data-testid="character-motion-copy-pose"]')!;
      const pasteBtn = () => element.querySelector<HTMLButtonElement>('[data-testid="character-motion-paste-pose"]')!;
      expect(copyBtn.disabled).toBe(false);
      await act(async () => copyBtn.click());
      await act(async () => timelineUiStore.seek(1_000, 2_000));
      expect(pasteBtn().disabled).toBe(false);
      await act(async () => pasteBtn().click());
      expect(faceDiamond(1000)).not.toBeNull();
      expect(xInput().value).toBe('65');

      // Select 0ms diamond -> Easing switch to step -> works, Delete remains disabled (0ms protected)
      await act(async () => faceDiamond(0).click());
      expect(element.querySelector<HTMLButtonElement>('[data-testid="character-motion-delete-key"]')!.disabled).toBe(true);
      const easingSelect = element.querySelector<HTMLSelectElement>('[data-testid="character-motion-easing"]')!;
      await act(async () => {
        easingSelect.value = 'step';
        easingSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => timelineUiStore.seek(250, 2_000));
      expect(xInput().value).toBe('25');

      // PNG image composite character resolves `partVisualKind: 'image'` for `face` thumbnail summary.
      const imgProj = compositeUiProject('image', false);
      const imgSummary = getRightInspectorLayerSummary(
        {
          project: imgProj,
          projectRoot: 'D:/img',
          dirty: false,
          revision: 0,
        },
        imgProj.shots[0]!.layers.find((l) => l.id === IDS.layerChar)!,
        null,
        'face',
      );
      expect(imgSummary.partVisualKind).toBe('image');

      // Drag-retime 500ms diamond right by +250ms (pixelsPerMs = 0.2 -> +50px) -> becomes 750ms.
      const dispatchPointer = (target: Element, type: string, clientX: number) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
            clientX,
          }),
        );
      };
      const diamond500 = faceDiamond(500);
      await act(async () => dispatchPointer(diamond500, 'pointerdown', 0));
      await act(async () => dispatchPointer(diamond500, 'pointermove', 250 * 0.2));
      await act(async () => dispatchPointer(diamond500, 'pointerup', 250 * 0.2));
      expect(faceDiamond(500)).toBeNull();
      expect(faceDiamond(750)).not.toBeNull();

      // Solo 0ms drag leaves 0ms anchored; Shift+multi-select [0, 750] drag shows protected cue!
      await act(async () => dispatchPointer(faceDiamond(0), 'pointerdown', 0));
      await act(async () => dispatchPointer(faceDiamond(0), 'pointermove', 250 * 0.2));
      await act(async () => dispatchPointer(faceDiamond(0), 'pointerup', 250 * 0.2));
      expect(faceDiamond(0)).not.toBeNull();
      expect(faceDiamond(750)).not.toBeNull();

      await act(async () => faceDiamond(750).click());
      await act(async () =>
        faceDiamond(0).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
      );
      await act(async () => dispatchPointer(faceDiamond(750), 'pointerdown', 0));
      await act(async () => dispatchPointer(faceDiamond(750), 'pointermove', 250 * 0.2));
      await act(async () => dispatchPointer(faceDiamond(750), 'pointerup', 250 * 0.2));
      expect(element.textContent).toContain('基础姿势');
      expect(faceDiamond(0)).not.toBeNull();

      // Clicking Reset Transform in Auto-Key ON restores basis pose (x = 25, not 0) at 750ms
      await act(async () => faceDiamond(750).click());
      const resetBtn = Array.from(element.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('重置变换'),
      )!;
      await act(async () => resetBtn.click());
      expect(xInput().value).toBe('25');

      // Delete 750ms & 1000ms diamonds -> diamonds disappear cleanly
      await act(async () => faceDiamond(750).click());
      await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="character-motion-delete-key"]')!.click());
      expect(faceDiamond(750)).toBeNull();
      await act(async () => faceDiamond(1000).click());
      await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="character-motion-delete-key"]')!.click());
      expect(faceDiamond(1000)).toBeNull();

      // Scale bounds respect Auto-Key ON basis factor (safe min/max)
      expect(CHARACTER_PART_MIN_SCALE).toBe(0.05);
      expect(CHARACTER_PART_MAX_SCALE).toBe(20);

      // Undo works back all the way cleanly without throwing
      while (editorProjectStore.history.getSnapshot().undoCount > 0) {
        await act(async () => editorProjectStore.undo());
      }
      expect(
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.layerChar)!.animationClip,
      ).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });
});
