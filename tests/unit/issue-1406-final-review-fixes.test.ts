// @vitest-environment happy-dom
import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride,
  AUTO_FRAMING_PRESETS,
  evaluateShotAtTime,
  FlaGraphicDefinitionSchema,
  LayerService,
  migrateProject,
  prepareShotCamera,
  ProjectSchema,
  projectShotDialogueVisual,
  resolveLayerAnimationTimeLink,
  setLayerAnimationTimeLink,
  setShotCameraAutoFraming,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  signedFrameOffsetMs,
  stepSignedFrameOffsetMs,
  type Layer,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import {
  evaluateExportShotAtTime,
  evaluateFormalExportFrame,
} from '../../src/export-renderer/evaluateExportShotAtTime';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { ShotAutoFramingControls } from '../../src/renderer/features/canvas/ShotAutoFramingControls';
import { ShotCameraControls } from '../../src/renderer/features/canvas/ShotCameraControls';
import { LayerDepthControl } from '../../src/renderer/features/properties/LayerDepthControl';
import { ShotCameraLane } from '../../src/renderer/features/timeline/ShotCameraLane';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { depthPreviewStore, DepthPreviewStore } from '../../src/renderer/stores/depthPreviewStore';
import { EditorProjectStore, editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore, selectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore, shotStore } from '../../src/renderer/stores/shotStore';
import { buildDialogueSubtitleCues } from '../../src/shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACTION_ID = '83000000-0000-4000-8000-000000000001';
const ACTION_EVENT_1 = '83000000-0000-4000-8000-000000000011';
const FRAME_ASSET_0 = '13000000-0000-4000-8000-000000000100';
const FRAME_ASSET_1 = '13000000-0000-4000-8000-000000000101';
const FRAME_ASSET_2 = '13000000-0000-4000-8000-000000000102';
const FRAME_ASSET_3 = '13000000-0000-4000-8000-000000000103';
const FRAME_SHA = 'c'.repeat(64);
const OVR_A = '23000000-0000-4000-8000-000000000001';
const OVR_B = '23000000-0000-4000-8000-000000000002';

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

function mountElement(element: React.JSX.Element): HTMLDivElement {
  unmountElement();
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(element);
  });
  return mountedContainer;
}

function unmountElement(): void {
  if (mountedRoot) {
    act(() => {
      mountedRoot!.unmount();
    });
    mountedRoot = null;
  }
  if (mountedContainer) {
    mountedContainer.remove();
    mountedContainer = null;
  }
}

function makeFrameAsset(id: string, name: string, flaGraphicOrdinal?: number) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: flaGraphicOrdinal !== undefined ? `assets/${name}.svg` : `assets/${name}.png`,
    mimeType: flaGraphicOrdinal !== undefined ? 'image/svg+xml' : 'image/png',
    sha256: FRAME_SHA,
    width: 256,
    height: 256,
    usage: 'uncategorized' as const,
    keywords: [],
    ...(flaGraphicOrdinal !== undefined
      ? {
          flaGraphicFrame: {
            definitionId: IDS.animation,
            ordinal: flaGraphicOrdinal,
          },
        }
      : {}),
  };
}

function build24FpsOffsetProject(options?: {
  flaGraphic?: boolean;
  shotDurationMs?: number;
  event?: { startMs: number; endMs: number };
  extraEvents?: Project['shots'][number]['timelineEvents'];
  playback?: Layer['animationPlayback'];
}): Project {
  const base = buildProjectWithAnimation();
  const frameAssets = [
    makeFrameAsset(FRAME_ASSET_0, 'f0', options?.flaGraphic ? 0 : undefined),
    makeFrameAsset(FRAME_ASSET_1, 'f1', options?.flaGraphic ? 1 : undefined),
    makeFrameAsset(FRAME_ASSET_2, 'f2', options?.flaGraphic ? 2 : undefined),
    makeFrameAsset(FRAME_ASSET_3, 'f3', options?.flaGraphic ? 3 : undefined),
  ];
  const frameDurationMs = 1_000 / 24;
  const frames = frameAssets.map((asset, ordinal) => ({
    ordinal,
    sourceFrameIndex: ordinal,
    assetId: asset.id,
    sha256: FRAME_SHA,
    offset: { x: 0, y: 0 },
    sourceViewport: { x: 0, y: 0, width: 256, height: 256 },
    startMs: ordinal * frameDurationMs,
    durationMs: frameDurationMs,
    createdBySequenceImport: !options?.flaGraphic,
  }));
  const totalDurationMs = frames.length * frameDurationMs;
  const baseSource = {
    ...base.animations[0]!.source,
    sourceFps: 24,
    startFrameIndex: 0,
    endFrameIndex: 3,
    canvas: { width: 256, height: 256 },
    documentCanvas: { width: 256, height: 256 },
    anchor: { x: 0, y: 0 },
  };
  const animation = options?.flaGraphic
    ? FlaGraphicDefinitionSchema.parse({
        id: IDS.animation,
        kind: 'fla-graphic',
        name: '24fps剑光',
        durationMs: totalDurationMs,
        source: baseSource,
        frames,
      })
    : {
        ...base.animations[0]!,
        id: IDS.animation,
        name: '24fps序列',
        durationMs: totalDurationMs,
        source: baseSource,
        frames,
      };

  const baseShot = base.shots[0]!;
  const baseCharacter = base.characters[0]!;
  const animationLayer: Layer = {
    id: IDS.animationLayer,
    name: '附属动画',
    source: { kind: 'animation', animationId: IDS.animation },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 3,
    locked: false,
    flipX: false,
    startTimeMs: 0,
    animationPlayback: options?.playback ?? { mode: 'once', endBehavior: 'hold' },
  };

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets],
    animations: [animation],
    characters: [
      {
        ...baseCharacter,
        actions: [
          {
            id: ACTION_ID,
            name: '挥拳',
            animationId: IDS.animation,
            placement: { offsetX: 0, offsetY: 0, scale: 1 },
          },
        ],
      },
    ],
    shots: [
      {
        ...baseShot,
        durationMs: options?.shotDurationMs ?? 2_000,
        layers: [...baseShot.layers, animationLayer],
        timelineEvents: [
          {
            id: ACTION_EVENT_1,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: options?.event?.startMs ?? 42,
            endMs: options?.event?.endMs ?? 1_000,
          },
          ...(options?.extraEvents ?? []),
        ],
      },
    ],
  });
}

function evalAnim(project: Project, timeMs: number) {
  return evaluateShotAtTime(project.shots[0]!, timeMs, project).layers.find(
    (layer) => layer.id === IDS.animationLayer,
  )!;
}

afterEach(() => {
  unmountElement();
  shotStore.selectCameraOverride(null);
  timelineUiStore.seek(0, 10_000);
  vi.restoreAllMocks();
});

describe('Issue #1406 Wave A/B Final Review Fixes', () => {
  describe('P2-01 (#1403): signed author-frame offset arithmetic & out-of-bounds visibility', () => {
    it('shifts frame-aligned 42ms +1 frame to exact 83ms (not 84ms), 83ms -1 frame to 42ms, and keeps arbitrary ms offsets unquantized', () => {
      // 42ms (frame 1) + 1 frame (+42ms) => 83ms (frame 2), preserving 23-frame span to 1042ms
      const plus1 = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ flaGraphic: true, event: { startMs: 42, endMs: 1_000 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: stepSignedFrameOffsetMs(0, 1), // +42ms
        },
      );
      const plus1Layer = plus1.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
      expect(resolveLayerAnimationTimeLink(plus1.shots[0]!, plus1Layer)).toMatchObject({
        status: 'active',
        offsetMs: 42,
        startMs: 83,
        endMs: 1_042,
        visibleStartMs: 83,
        visibleEndMs: 1_042,
        outOfShotBounds: false,
      });
      // First visible at 83ms (author frame 2), NOT 84ms!
      expect(evalAnim(plus1, 42).visible).toBe(false);
      expect(evalAnim(plus1, 82).visible).toBe(false);
      expect(evalAnim(plus1, 83)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
      expect(evalAnim(plus1, 125)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
      // 60fps formal export at 83ms (frame 5 at 60fps) matches author frame 0
      expect(
        evaluateExportShotAtTime(plus1, plus1.shots[0]!, 66).layers.find((l) => l.id === IDS.animationLayer)!.visible,
      ).toBe(false);
      expect(
        evaluateExportShotAtTime(plus1, plus1.shots[0]!, 83).layers.find((l) => l.id === IDS.animationLayer),
      ).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });

      // 83ms (frame 2) - 1 frame (-42ms) => 42ms (frame 1), preserving span to 958ms
      const minus1 = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ flaGraphic: true, event: { startMs: 83, endMs: 1_000 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: stepSignedFrameOffsetMs(0, -1), // -42ms
        },
      );
      expect(
        resolveLayerAnimationTimeLink(
          minus1.shots[0]!,
          minus1.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({
        status: 'active',
        startMs: 42,
        endMs: 958,
      });
      expect(evalAnim(minus1, 41).visible).toBe(false);
      expect(evalAnim(minus1, 42)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
      expect(evalAnim(minus1, 83)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });

      // Multi-frame +2 (83ms) on 83ms => 167ms (frame 4, not 166ms)
      const plus2 = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ event: { startMs: 83, endMs: 250 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: signedFrameOffsetMs(2), // +83ms
        },
      );
      expect(
        resolveLayerAnimationTimeLink(
          plus2.shots[0]!,
          plus2.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({ startMs: 167, endMs: 333 });

      // Arbitrary non-grid +200ms / -200ms preserves exact millisecond offset and duration
      const plus200 = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ event: { startMs: 1_000, endMs: 1_500 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: 200,
        },
      );
      expect(
        resolveLayerAnimationTimeLink(
          plus200.shots[0]!,
          plus200.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({ startMs: 1_200, endMs: 1_700 });

      const minus200 = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ event: { startMs: 1_000, endMs: 1_500 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: -200,
        },
      );
      expect(
        resolveLayerAnimationTimeLink(
          minus200.shots[0]!,
          minus200.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({ startMs: 800, endMs: 1_300 });
    });

    it('hides completely out-of-bounds links (including startMs === shot.durationMs), preserves cross-zero clock, and keeps explicit graphic-playback priority', () => {
      // Exact shot.durationMs boundary: event [1000, 2000) + 1000ms => [2000, 3000) on durationMs=2000
      const atShotEnd = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ flaGraphic: true, shotDurationMs: 2_000, event: { startMs: 1_000, endMs: 2_000 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: 1_000,
        },
      );
      const endLayer = atShotEnd.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
      expect(resolveLayerAnimationTimeLink(atShotEnd.shots[0]!, endLayer)).toMatchObject({
        status: 'active',
        startMs: 2_000,
        endMs: 3_000,
        visibleStartMs: 2_000,
        visibleEndMs: 2_000,
        outOfShotBounds: true,
      });
      // Evaluating right at shot.durationMs (2000ms) MUST be invisible (not erroneously shown!)
      expect(evalAnim(atShotEnd, 0).visible).toBe(false);
      expect(evalAnim(atShotEnd, 1_999).visible).toBe(false);
      expect(evalAnim(atShotEnd, 2_000).visible).toBe(false);
      expect(
        evaluateFormalExportFrame(atShotEnd, atShotEnd.shots[0]!, 2_000, []).evaluatedShot.layers.find(
          (l) => l.id === IDS.animationLayer,
        ),
      ).toBeUndefined();

      // Completely before shot start: [0, 500) - 500ms => [-500, 0)
      const beforeShot = setLayerAnimationTimeLink(
        build24FpsOffsetProject({ flaGraphic: true, shotDurationMs: 2_000, event: { startMs: 0, endMs: 500 } }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: -500,
        },
      );
      expect(evalAnim(beforeShot, 0).visible).toBe(false);
      expect(
        resolveLayerAnimationTimeLink(
          beforeShot.shots[0]!,
          beforeShot.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({ status: 'active', outOfShotBounds: true });

      // Cross-zero frame-aligned window: [42, 1000) - 2 frames (-83ms) => [-42, 917)
      // At t=0: 1 frame already elapsed -> FRAME_ASSET_1 (clock NOT reset to 0!)
      const crossZero = setLayerAnimationTimeLink(
        build24FpsOffsetProject({
          flaGraphic: true,
          event: { startMs: 42, endMs: 1_000 },
          extraEvents: [
            {
              id: randomUUID(),
              layerId: IDS.animationLayer,
              type: 'graphic-playback',
              animationId: IDS.animation,
              startMs: 125,
              endMs: 250,
              playbackStartMs: 125,
              range: { firstFrame: 0, lastFrame: 3 },
              playback: { mode: 'single-frame', endBehavior: 'hold' },
              firstFrame: 3,
            },
          ],
        }),
        IDS.shot,
        IDS.animationLayer,
        {
          kind: 'character-action',
          sourceLayerId: IDS.layerChar,
          eventId: ACTION_EVENT_1,
          offsetMs: signedFrameOffsetMs(-2), // -83ms
        },
      );
      expect(
        resolveLayerAnimationTimeLink(
          crossZero.shots[0]!,
          crossZero.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!,
        ),
      ).toMatchObject({
        status: 'active',
        startMs: -42,
        endMs: 917,
        visibleStartMs: 0,
        visibleEndMs: 917,
        outOfShotBounds: false,
      });
      expect(evalAnim(crossZero, 0)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
      expect(evalAnim(crossZero, 42)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
      // Explicit graphic-playback event at [125, 250) retains priority with firstFrame=3
      expect(evalAnim(crossZero, 125)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
      // Export preparation collects resources for cross-zero window
      const media = new Set(collectExportPreparationMedia(crossZero).map((m) => m.asset.id));
      expect(media.has(FRAME_ASSET_1)).toBe(true);
      expect(media.has(FRAME_ASSET_3)).toBe(true);
    });
  });

  describe('P2-02 (#1397/#1402): depth preview synchronized with Hybrid auto-camera & dynamic inherit input', () => {
    it('computes identical Hybrid auto-follow camera during DepthPreviewStore drag as after commit, while leaving manual overrides and HUD untouched', () => {
      const base = migrateProject(structuredClone(demo));
      const shot0 = base.shots[0]!;
      const charLayer = shot0.layers.find((l) => l.source.kind === 'character')!;
      const character = base.characters.find(
        (c) => charLayer.source.kind === 'character' && c.id === charLayer.source.characterId,
      )!;
      const asset = base.assets.find((a) => a.kind === 'image')!;
      const carrierId = randomUUID();
      const hudId = randomUUID();
      const carrierLayer: Layer = {
        id: carrierId,
        name: '父级载具',
        source: { kind: 'control' },
        anchor: 'center',
        x: 600,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 1,
        locked: false,
        flipX: false,
        depth: 0,
      };
      const hudLayer: Layer = {
        id: hudId,
        name: 'HUD',
        source: { kind: 'asset', assetId: asset.id },
        anchor: 'center',
        x: 960,
        y: 100,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 20,
        locked: false,
        flipX: false,
        cameraSpace: 'screen',
      };

      let project = ProjectSchema.parse({
        ...base,
        shots: [
          {
            ...shot0,
            durationMs: 3_000,
            layers: [...shot0.layers, carrierLayer, hudLayer],
            dialogues: [
              {
                id: randomUUID(),
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                text: '自动跟拍台词',
                startMs: 0,
                endMs: 2_500,
                subtitleStyleId: shot0.defaultSubtitleStyleId,
              },
            ],
          },
        ],
      });
      project = new LayerService().setParent(project, shot0.id, charLayer.id, carrierId, 0);
      project = setShotCameraMode(project, shot0.id, 'hybrid');
      project = setShotCameraAutoFraming(project, shot0.id, {
        zoom: 1.8,
        ...AUTO_FRAMING_PRESETS['left-third'],
      });
      project = setShotCameraKey(project, shot0.id, 1_500, {
        centerX: 1_100,
        centerY: 500,
        zoom: 1.25,
        rotationDeg: 8,
      });
      project = addShotCameraOverride(project, shot0.id, {
        id: OVR_A,
        startMs: 1_500,
        endMs: 2_500,
        blendInMs: 0,
        blendOutMs: 0,
      });

      const editor = new EditorProjectStore();
      editor.open('D:/p202-hybrid-depth.pandastage', project);
      const localShotStore = new ShotStore(editor, new ShotService());
      localShotStore.select(shot0.id);
      const localSelectionStore = new LayerSelectionStore(editor, localShotStore);
      localSelectionStore.select(carrierId);
      const previewStore = new DepthPreviewStore({
        editorStore: editor,
        shotSelection: localShotStore,
        layerSelection: localSelectionStore,
        timeline: { getSnapshot: () => ({ currentTimeMs: 500 }), subscribe: () => () => {} },
      });

      const beforeAutoCam = prepareShotCamera(project, project.shots[0]!, 'speaker-focus')(500)!;
      const beforeManualCam = prepareShotCamera(project, project.shots[0]!, 'speaker-focus')(1_800)!;

      // Drag parent carrier depth to 500 in preview without writing History
      const handle = previewStore.begin(carrierId, 0)!;
      expect(handle.setDepth(500)).toBe(true);
      expect(editor.history.getSnapshot().undoCount).toBe(0);

      const previewProject = previewStore.getSnapshot()!.previewProject;
      const previewShot = previewProject.shots[0]!;
      const previewAutoCam = prepareShotCamera(previewProject, previewShot, 'speaker-focus')(500)!;
      const previewManualCam = prepareShotCamera(previewProject, previewShot, 'speaker-focus')(1_800)!;
      const previewHud = evaluateShotAtTime(previewShot, 500, previewProject).layers.find((l) => l.id === hudId)!;

      // Auto-follow camera updates immediately with parent depth change, manual & HUD stay unchanged
      expect(previewAutoCam.centerX).not.toBeCloseTo(beforeAutoCam.centerX, 2);
      expect(previewManualCam).toEqual(beforeManualCam);
      expect(previewHud.effectiveCameraSpace).toBe('screen');

      // Commit on release (1 Undo) -> post-commit auto-follow camera matches live drag frame identically
      handle.finish((final) => {
        editor.updateProject(final.previewProject, '设置图层深度');
      });
      expect(editor.history.getSnapshot().undoCount).toBe(1);
      const committed = editor.getSnapshot()!.project;
      const committedAutoCam = prepareShotCamera(committed, committed.shots[0]!, 'speaker-focus')(500)!;
      expect(committedAutoCam).toEqual(previewAutoCam);

      previewStore.dispose();
      localSelectionStore.dispose();
      localShotStore.dispose();
    });

    it('keeps dynamic-inherit numeric input blank with inherited effective depth placeholder instead of leaking static base layer.depth', () => {
      const base = migrateProject(structuredClone(demo));
      const asset = base.assets.find((a) => a.kind === 'image')!;
      const parentId = randomUUID();
      const childId = randomUUID();
      const parentLayer: Layer = {
        id: parentId,
        name: '远景父层',
        source: { kind: 'asset', assetId: asset.id },
        anchor: 'center',
        x: 640,
        y: 420,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 1,
        locked: false,
        flipX: false,
        depth: 120,
      };
      const childLayer: Layer = {
        ...parentLayer,
        id: childId,
        name: '动态交接子层',
        zIndex: 2,
        depth: 350, // Static base depth at t=0
      };
      let project = ProjectSchema.parse({
        ...base,
        shots: [
          {
            ...base.shots[0]!,
            durationMs: 2_000,
            dialogues: [],
            audioClips: [],
            timelineEvents: [],
            layers: [base.shots[0]!.layers[0]!, parentLayer, childLayer],
          },
        ],
      });
      // At t=500ms, dynamically attach child to parent with depthMode='inherit' (effective depth = 120)
      project = new LayerService().setParentKey(project, project.shots[0]!.id, childId, 500, parentId, {
        depthMode: 'inherit',
      });

      editorProjectStore.open('D:/p202-dyn-inherit.pandastage', project);
      shotStore.select(project.shots[0]!.id);
      selectionStore.select(childId);
      timelineUiStore.seek(500, 2_000);

      const snap = editorProjectStore.getSnapshot()!;
      const shot = snap.project.shots[0]!;
      const layer = shot.layers.find((l) => l.id === childId)!;
      const container = mountElement(createElement(LayerDepthControl, { layer, shot, snapshot: snap }));

      const input = container.querySelector<HTMLInputElement>(`#layer-depth-input-${childId}`)!;
      const slider = container.querySelector<HTMLInputElement>('[data-testid="layer-depth-slider"]')!;
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('120');
      expect(Number(slider.value)).toBeGreaterThan(524); // depth 120 > 0 (zero tick ~524)

      // Committing a number on the dynamic-inherit segment updates ONLY that segment, leaving static layer.depth=350 untouched
      act(() => {
        input.focus();
        input.value = '260';
        input.blur();
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const updatedLayer = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === childId)!;
      expect(updatedLayer.depth).toBe(350);
      expect(updatedLayer.parentKeys?.[0]).toMatchObject({
        timeMs: 500,
        depthMode: 'preserve',
        depth: 260,
      });

      // Ensure DepthPreviewStore cancel leaves history clean
      act(() => {
        const handle = depthPreviewStore.begin(childId, 260);
        handle?.setDepth(400);
        handle?.cancel();
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    });
  });

  describe('P2-03 (#1398): camera curve draft unified preview time across subtitle & dialogue projection', () => {
    it('evaluates subtitle cue and dialogue projection at the same curve-draft sample time across speaker boundaries without moving the playhead', () => {
      const base = migrateProject(structuredClone(demo));
      const shot0 = base.shots[0]!;
      const charA = base.characters[0]!;
      const charALayer = shot0.layers.find(
        (l) => l.source.kind === 'character' && l.source.characterId === charA.id,
      )!;
      const charBId = randomUUID();
      const charBVoiceId = randomUUID();
      const charBLayerId = randomUUID();
      const dlgAId = randomUUID();
      const dlgBId = randomUUID();
      const audioAId = randomUUID();
      const audioBId = randomUUID();
      const baseAudioAsset = base.assets.find((a) => a.kind === 'audio')!;
      const exprAssetId = charA.expressions?.find((e) => e.id === charA.defaultExpressionId)?.assetId;
      const baseImageAsset =
        base.assets.find((a) => a.kind === 'image' && a.id !== exprAssetId) ??
        base.assets.find((a) => a.kind === 'image')!;
      const baseVoice = base.voiceProfiles.find((vp) => vp.id === charA.defaultVoiceProfileId)!;
      const project = ProjectSchema.parse({
        ...base,
        characters: [
          {
            ...charA,
            mouthOpenAssetId: baseImageAsset.id,
          },
          {
            ...charA,
            id: charBId,
            name: '角色B',
            defaultVoiceProfileId: charBVoiceId,
            mouthOpenAssetId: baseImageAsset.id,
          },
        ],
        voiceProfiles: [
          ...base.voiceProfiles,
          {
            ...baseVoice,
            id: charBVoiceId,
            characterId: charBId,
            name: '角色B声音',
          },
        ],
        shots: [
          {
            ...shot0,
            durationMs: 2_000,
            audioClips: [
              {
                id: audioAId,
                name: '台词A音频',
                role: 'dialogue',
                assetId: baseAudioAsset.id,
                startMs: 0,
                endMs: 500,
                volume: 1,
              },
              {
                id: audioBId,
                name: '台词B音频',
                role: 'dialogue',
                assetId: baseAudioAsset.id,
                startMs: 500,
                endMs: 1_200,
                volume: 1,
              },
            ],
            timelineEvents: [],
            layers: [
              ...shot0.layers,
              {
                ...charALayer,
                id: charBLayerId,
                name: '角色B图层',
                zIndex: 10,
                x: 1_300,
                source: {
                  kind: 'character',
                  characterId: charBId,
                  expressionId: charA.defaultExpressionId ?? charA.expressions?.[0]?.id ?? '',
                },
              },
            ],
            dialogues: [
              {
                id: dlgAId,
                characterId: charA.id,
                voiceProfileId: charA.defaultVoiceProfileId,
                audioClipId: audioAId,
                text: '第一句台词A',
                startMs: 0,
                endMs: 500,
                subtitleStyleId: shot0.defaultSubtitleStyleId,
              },
              {
                id: dlgBId,
                characterId: charBId,
                voiceProfileId: charBVoiceId,
                audioClipId: audioBId,
                text: '第二句台词B',
                startMs: 500,
                endMs: 1_200,
                subtitleStyleId: shot0.defaultSubtitleStyleId,
              },
            ],
          },
        ],
      });

      const shot = project.shots[0]!;
      const cues = buildDialogueSubtitleCues(shot.dialogues);
      // Playhead is at 80ms (Speaker A open phase), while camera curve draft previews at 580ms (Speaker B open phase)
      const playheadCue = evaluateSubtitleAtTime(cues, 80);
      const draftCue = evaluateSubtitleAtTime(cues, 580);
      expect(playheadCue?.id).toBe(dlgAId);
      expect(draftCue?.id).toBe(dlgBId);

      const canvasModelAtDraft = buildEditorTemporalCanvasModel({
        project,
        shot,
        currentTimeMs: 580,
        cameraViewActive: true,
        activeDialogueId: draftCue?.id ?? null,
        readyAssetIds: new Set(),
        previousVisuals: new Map(),
      });
      const formalAtDraft = projectShotDialogueVisual(
        project,
        shot,
        evaluateShotAtTime(shot, 580, project),
        draftCue?.id ?? null,
      );
      expect(canvasModelAtDraft.evaluatedShot).toEqual(formalAtDraft);
      // Verify Speaker B (not Speaker A) receives dialogue projection at 580ms
      const layerA = canvasModelAtDraft.evaluatedShot.layers.find((l) => l.id === charALayer.id)!;
      const layerB = canvasModelAtDraft.evaluatedShot.layers.find((l) => l.id === charBLayerId)!;
      expect(layerA.mouthOverrideAssetId).toBeNull();
      expect(layerB.mouthOverrideAssetId).toBe(baseImageAsset.id);

      // Contrast with stale playheadCue (bug before P2-03): Speaker B would NOT receive mouth override
      const staleModel = buildEditorTemporalCanvasModel({
        project,
        shot,
        currentTimeMs: 580,
        cameraViewActive: true,
        activeDialogueId: playheadCue?.id ?? null,
        readyAssetIds: new Set(),
        previousVisuals: new Map(),
      });
      expect(staleModel.evaluatedShot.layers.find((l) => l.id === charBLayerId)!.mouthOverrideAssetId).toBeNull();
    });
  });

  describe('P3-01 (#1395): synchronized override selection between ShotCameraControls and ShotCameraLane', () => {
    it('agrees on unselected outside overrides, playhead fallback inside overrides, and explicit selection without writing Project/History', () => {
      const base = migrateProject(structuredClone(demo));
      const shotId = base.shots[0]!.id;
      let project = setShotCameraMode(base, shotId, 'hybrid');
      project = addShotCameraOverride(project, shotId, { id: OVR_A, startMs: 500, endMs: 1_000, blendInMs: 0, blendOutMs: 0 });
      project = addShotCameraOverride(project, shotId, { id: OVR_B, startMs: 1_500, endMs: 2_000, blendInMs: 0, blendOutMs: 0 });

      editorProjectStore.open('D:/p301-override-sync.pandastage', project);
      shotStore.select(shotId);
      const snap = editorProjectStore.getSnapshot()!;
      const shot = snap.project.shots[0]!;

      const renderBoth = (timeMs: number) =>
        mountElement(
          createElement(
            'div',
            null,
            createElement(ShotCameraLane, {
              snapshot: snap,
              shot,
              currentTimeMs: timeMs,
              pixelsPerMs: 0.2,
              trackWidth: 1_000,
              disabled: false,
            }),
            createElement(ShotCameraControls, {
              shot,
              timeMs,
              throughCamera: true,
              cameraTool: false,
              onViewChange: () => {},
              onToolChange: () => {},
            }),
          ),
        );

      // 1) Playhead outside all overrides (1200ms) with no explicit selection => BOTH unselected
      let container = renderBoth(1_200);
      let bars = [...container.querySelectorAll<HTMLElement>('[data-testid="shot-camera-override"]')];
      let select = container.querySelector<HTMLSelectElement>('select[aria-label="接管段"]')!;
      let deleteBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (btn) => btn.textContent === '删除接管段',
      )!;
      expect(bars.every((bar) => bar.dataset.selected === 'false')).toBe(true);
      expect(select.value).toBe('');
      expect(deleteBtn.disabled).toBe(true);
      // Dropdown still lists both overrides so the author can pick one
      expect(select.options.length).toBe(3);

      // 2) Playhead inside OVR_A (750ms) with no explicit selection => BOTH select OVR_A
      container = renderBoth(750);
      bars = [...container.querySelectorAll<HTMLElement>('[data-testid="shot-camera-override"]')];
      select = container.querySelector<HTMLSelectElement>('select[aria-label="接管段"]')!;
      expect(bars.find((b) => b.dataset.overrideId === OVR_A)?.dataset.selected).toBe('true');
      expect(bars.find((b) => b.dataset.overrideId === OVR_B)?.dataset.selected).toBe('false');
      expect(select.value).toBe(OVR_A);

      // 3) Explicit selection OVR_B while playhead is outside (1200ms) => BOTH select OVR_B
      act(() => {
        shotStore.selectCameraOverride(OVR_B);
      });
      container = renderBoth(1_200);
      bars = [...container.querySelectorAll<HTMLElement>('[data-testid="shot-camera-override"]')];
      select = container.querySelector<HTMLSelectElement>('select[aria-label="接管段"]')!;
      deleteBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (btn) => btn.textContent === '删除接管段',
      )!;
      expect(bars.find((b) => b.dataset.overrideId === OVR_A)?.dataset.selected).toBe('false');
      expect(bars.find((b) => b.dataset.overrideId === OVR_B)?.dataset.selected).toBe('true');
      expect(select.value).toBe(OVR_B);
      expect(deleteBtn.disabled).toBe(false);

      // Viewing / selecting never writes Project or History
      expect(editorProjectStore.getSnapshot()).toBe(snap);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    });
  });

  describe('P3-02 (#1402): ShotAutoFramingControls no-op blur / Escape preserves exact 1/3 & 2/3 without writing History', () => {
    it('preserves exact 1/3 and 2/3 values and History count on focus/blur and Escape, while committing real edits once', () => {
      const base = migrateProject(structuredClone(demo));
      const shotId = base.shots[0]!.id;
      const store = new EditorProjectStore();
      store.open('D:/p302-auto-framing.pandastage', setShotCameraMode(base, shotId, 'speaker-focus'));
      const errors: string[] = [];

      const renderControls = () => {
        const shot = store.getSnapshot()!.project.shots[0]!;
        return mountElement(
          createElement(ShotAutoFramingControls, {
            shot,
            onEdit: (change, label) => {
              store.updateProject(change(store.getSnapshot()!.project), label);
              return true;
            },
            onError: (msg) => errors.push(msg),
          }),
        );
      };

      let container = renderControls();
      // Click Left Third -> sets exact 1/3 (revision 1, undoCount 1)
      act(() => {
        container.querySelector<HTMLButtonElement>('[data-testid="auto-framing-preset-left-third"]')!.click();
      });
      expect(store.getSnapshot()!.revision).toBe(1);
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(1 / 3);

      // Re-render with updated shot (displays "0.333")
      container = renderControls();
      let inputU = container.querySelector<HTMLInputElement>('[data-testid="auto-framing-u"]')!;
      expect(inputU.value).toBe('0.333');

      // Focus + blur without modifying -> MUST NOT write 0.333 or bump revision/History
      act(() => {
        inputU.focus();
        inputU.blur();
      });
      expect(store.getSnapshot()!.revision).toBe(1);
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(1 / 3);

      // Type new text then press Escape (which blurs) -> MUST NOT write 0.333 or bump revision/History
      act(() => {
        inputU.focus();
        inputU.value = '0.45';
        inputU.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(inputU.value).toBe('0.333');
      expect(store.getSnapshot()!.revision).toBe(1);
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(1 / 3);

      // Same for Right Third (2/3 -> "0.667")
      act(() => {
        container.querySelector<HTMLButtonElement>('[data-testid="auto-framing-preset-right-third"]')!.click();
      });
      expect(store.getSnapshot()!.revision).toBe(2);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(2 / 3);
      container = renderControls();
      inputU = container.querySelector<HTMLInputElement>('[data-testid="auto-framing-u"]')!;
      expect(inputU.value).toBe('0.667');
      act(() => {
        inputU.focus();
        inputU.blur();
      });
      expect(store.getSnapshot()!.revision).toBe(2);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(2 / 3);

      // Real valid edit commits once
      act(() => {
        inputU.focus();
        inputU.value = '0.42';
        inputU.blur();
      });
      expect(store.getSnapshot()!.revision).toBe(3);
      expect(store.history.getSnapshot().undoCount).toBe(3);
      expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.targetU).toBe(0.42);

      // Invalid edit reverts & reports error without writing History
      container = renderControls();
      const inputZoom = container.querySelector<HTMLInputElement>('[data-testid="auto-framing-zoom"]')!;
      act(() => {
        inputZoom.focus();
        inputZoom.value = '0.5';
        inputZoom.blur();
      });
      expect(inputZoom.value).toBe('1.5');
      expect(errors.length).toBe(1);
      expect(store.getSnapshot()!.revision).toBe(3);
      expect(store.history.getSnapshot().undoCount).toBe(3);
    });
  });
});
