// @vitest-environment happy-dom
import { act, createElement, Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterNodeMotionService,
  evaluateShotAtTime,
  ProjectSchema,
  resolveLayerVisualParts,
} from '../../src/domain';
import { CharacterMotionLane } from '../../src/renderer/features/timeline/CharacterMotionLane';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { RightInspector, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { buildProject, IDS } from './domain/testProject';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const MOUTH_ASSET_ID = '10000000-0000-4000-8000-000000000098';
const HEAD_ASSET_ID = '10000000-0000-4000-8000-000000000097';

afterEach(() => {
  vi.restoreAllMocks();
  selectionStore.clear();
  editorProjectStore.clear();
  timelineUiStore.seek(0, 2_000);
  timelineUiStore.setCharacterMotionAutoKey(false);
});

function buildUiProject(options: {
  mode: 'single-image' | 'composite';
  mouthKind: 'image' | 'graphic' | 'none';
}) {
  const base = options.mouthKind === 'graphic' ? graphicFaceProject() : buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: MOUTH_ASSET_ID,
        kind: 'image' as const,
        name: '张嘴',
        relativePath: 'mouth.png',
        mimeType: 'image/png',
        width: 120,
        height: 80,
        usage: 'character' as const,
        keywords: [],
      },
      {
        id: HEAD_ASSET_ID,
        kind: 'image' as const,
        name: '头部',
        relativePath: 'head.png',
        mimeType: 'image/png',
        width: 300,
        height: 280,
        usage: 'character' as const,
        keywords: [],
      },
    ],
    characters: base.characters.map((character) => {
      if (character.id !== IDS.character || character.mode === 'adaptive-parts') return character;
      const mouthFields =
        options.mouthKind === 'graphic'
          ? { mouthOpenVisualSource: faceSource(3) }
          : options.mouthKind === 'image'
            ? { mouthOpenAssetId: MOUTH_ASSET_ID }
            : {};
      if (options.mode === 'single-image') {
        return {
          ...character,
          mode: 'single-image' as const,
          ...mouthFields,
        };
      }
      return {
        id: character.id,
        name: character.name,
        mode: 'composite' as const,
        ...(options.mouthKind === 'graphic'
          ? { baseAssetId: undefined }
          : { baseAssetId: character.baseAssetId }),
        bodyAssetId: IDS.assetChar2,
        bodyPlacement: { offsetX: 0, offsetY: 40, scale: 1 },
        facePlacement: { offsetX: 12, offsetY: -8, scale: 1.2, rotationDeg: 15, flipX: false },
        head: {
          assetId: HEAD_ASSET_ID,
          placement: { offsetX: 0, offsetY: -50, scale: 1, rotationDeg: 0, flipX: false },
          pivot: { x: 0, y: 15 },
        },
        defaultVoiceProfileId: character.defaultVoiceProfileId,
        ...mouthFields,
        defaultExpressionId: IDS.expressionNormal,
        expressions:
          options.mouthKind === 'graphic'
            ? [
                { id: IDS.expressionNormal, name: '平静', visualSource: faceSource(0) },
                { id: IDS.expressionAngry, name: '生气', visualSource: faceSource(2) },
              ]
            : character.expressions,
        defaultScale: character.defaultScale,
        defaultFlipX: character.defaultFlipX,
      };
    }),
    shots: base.shots.map((shot) => ({ ...shot, durationMs: 2_000 })),
  });
}

function Harness() {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot)!;
  const ui = useSyncExternalStore(timelineUiStore.subscribe, timelineUiStore.getSnapshot);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  return createElement(
    Fragment,
    null,
    createElement(CharacterMotionLane, {
      project: snapshot.project,
      shot: snapshot.project.shots[0]!,
      layerId,
      currentTimeMs: ui.currentTimeMs,
      pixelsPerMs: 0.2,
    }),
    createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' }),
  );
}

describe('Mouth Cue Inspector + Timeline UI (#1159)', () => {
  it('hides Mouth Cue controls when no mouth-open visual is configured without blocking Expression or V1-B Face motion', async () => {
    const project = buildUiProject({ mode: 'composite', mouthKind: 'none' });
    editorProjectStore.open('D:/test-mouth-none', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    selectionStore.selectCharacterNode('face');
    timelineUiStore.seek(500, 2_000);

    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => root.render(createElement(Harness)));
      expect(element.querySelector('[data-testid="expression-at-time"]')).not.toBeNull();
      expect(element.querySelector('[data-testid="mouth-cue-at-time"]')).toBeNull();
      expect(element.querySelector('[data-testid="mouth-cue-lane"]')).toBeNull();
      expect(element.querySelector('[data-testid="character-part-transform-panel"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });

  it.each([
    { mode: 'single-image' as const, mouthKind: 'image' as const },
    { mode: 'composite' as const, mouthKind: 'image' as const },
    { mode: 'composite' as const, mouthKind: 'graphic' as const },
  ])(
    'authors 500ms open & 800ms rest cues with Timeline marker seek/delete, same-time update & Undo/Redo ($mode / $mouthKind)',
    async ({ mode, mouthKind }) => {
      let project = buildUiProject({ mode, mouthKind });
      if (mode === 'composite') {
        project = new CharacterNodeMotionService().apply(
          project,
          { shotId: IDS.shot, layerId: IDS.layerChar, nodeId: 'face', timeMs: 500, autoKey: true },
          { 'transform.offsetX': 48, 'transform.rotationDeg': 30, 'transform.scaleX': 1.5, 'transform.scaleY': 1.5 },
        );
      }
      editorProjectStore.open('D:/test-mouth-ui', project);
      shotStore.select(IDS.shot);
      selectionStore.select(IDS.layerChar);
      if (mode === 'composite') {
        selectionStore.selectCharacterNode('face');
      }
      timelineUiStore.seek(500, 2_000);

      const element = document.createElement('div');
      document.body.append(element);
      const root = createRoot(element);
      try {
        await act(async () => root.render(createElement(Harness)));
        const openBtn = () => element.querySelector<HTMLButtonElement>('[data-testid="mouth-cue-open-button"]')!;
        const restBtn = () => element.querySelector<HTMLButtonElement>('[data-testid="mouth-cue-rest-button"]')!;
        const markers = () =>
          Array.from(element.querySelectorAll<HTMLButtonElement>('[data-testid="mouth-cue-timeline-marker"]'));

        expect(openBtn()).not.toBeNull();
        expect(restBtn()).not.toBeNull();
        expect(element.querySelector('[data-testid="mouth-cue-lane"]')).toBeNull();

        // 1. 500ms authored open
        await act(async () => openBtn().click());
        expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
        expect(openBtn().getAttribute('aria-pressed')).toBe('true');
        expect(markers().map((m) => [Number(m.dataset.timeMs), m.dataset.mouthCueState])).toEqual([
          [500, 'open'],
        ]);

        // 2. 800ms authored rest (snapped to 792ms on 24fps grid)
        await act(async () => timelineUiStore.seek(800, 2_000));
        await act(async () => restBtn().click());
        expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
        expect(restBtn().getAttribute('aria-pressed')).toBe('true');
        expect(markers().map((m) => [Number(m.dataset.timeMs), m.dataset.mouthCueState])).toEqual([
          [500, 'open'],
          [792, 'rest'],
        ]);

        // 3. Undo / Redo exact cycle: Undo rest -> Undo open -> Redo open -> Redo rest
        await act(async () => editorProjectStore.undo());
        expect(markers().map((m) => m.dataset.mouthCueState)).toEqual(['open']);
        await act(async () => editorProjectStore.undo());
        expect(element.querySelector('[data-testid="mouth-cue-lane"]')).toBeNull();
        await act(async () => editorProjectStore.redo());
        expect(markers().map((m) => m.dataset.mouthCueState)).toEqual(['open']);
        await act(async () => editorProjectStore.redo());
        expect(markers().map((m) => m.dataset.mouthCueState)).toEqual(['open', 'rest']);

        // 4. Composite Face v3 Motion remains intact alongside open mouth cue at 500ms!
        if (mode === 'composite') {
          const currentProject = editorProjectStore.getSnapshot()!.project;
          const evaluated500 = evaluateShotAtTime(currentProject.shots[0]!, 500, currentProject);
          const visual500 = resolveLayerVisualParts(
            currentProject,
            currentProject.shots[0]!,
            evaluated500.layers.find((l) => l.id === IDS.layerChar)!,
            500,
          );
          expect(visual500.activeFace?.source).toBe('mouth');
          expect(visual500.facePlacement).toMatchObject({
            offsetX: 48,
            offsetY: -8,
            rotationDeg: 30,
          });
        }

        // 5. Same-time update at 500ms -> rest; clicking rest again at 500ms is a no-op
        await act(async () => markers()[0]!.click());
        expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
        const undoBeforeSameTime = editorProjectStore.history.getSnapshot().undoCount;
        await act(async () => restBtn().click());
        expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeSameTime + 1);
        expect(markers()[0]!.dataset.mouthCueState).toBe('rest');
        await act(async () => restBtn().click());
        expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeSameTime + 1);

        // 6. Click marker -> inline delete button deletes cue cleanly cleanly via Timeline
        await act(async () => markers()[0]!.click());
        const inlineDelete = element.querySelector<HTMLButtonElement>('[data-testid="mouth-cue-timeline-delete"]')!;
        expect(inlineDelete).not.toBeNull();
        await act(async () => inlineDelete.click());
        expect(markers()).toHaveLength(1);

        // 7. Delete remaining cue via keyboard Delete on focused marker
        await act(async () => {
          markers()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        });
        expect(element.querySelector('[data-testid="mouth-cue-lane"]')).toBeNull();
      } finally {
        await act(async () => root.unmount());
        element.remove();
      }
    },
  );
});
