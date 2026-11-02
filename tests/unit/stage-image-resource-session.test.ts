import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateSpeakerFocusCamera,
  prepareSpeakerFocusCamera,
  type Project,
  type Shot,
} from '../../src/domain';
import {
  buildStageImageSourceKey,
  isStageFrameReady,
  MAX_RETAINED_STAGE_BYTES,
  MAX_RETAINED_STAGE_SOURCES,
  StageImageResourceSession,
  type StageImageResourceState,
} from '../../src/renderer/stage/stageImageResourceSession';
import {
  commitStageVisualFrame,
  selectStageVisualFrame,
} from '../../src/renderer/stage/stageVisualFrame';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  succeed(): void;
  fail(): void;
}

const LAYER_A = 'layer-a';
const LAYER_B = 'layer-b';
const CHARACTER_BODY = 'character-layer:body';
const CHARACTER_HEAD = 'character-layer:head';
const CHARACTER_FACE = 'character-layer:face';

function createFakeImage(
  getDimensions: (sourceUrl: string) => { width: number; height: number },
): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    naturalWidth: 1,
    naturalHeight: 1,
    succeed() {
      const dimensions = getDimensions(this.src);
      this.naturalWidth = dimensions.width;
      this.naturalHeight = dimensions.height;
      this.onload?.({} as Event);
    },
    fail() {
      this.onerror?.({} as Event);
    },
  };
}

function createHarness(
  getDimensions: (sourceUrl: string) => { width: number; height: number } = () =>
    ({ width: 1, height: 1 }),
): {
  session: StageImageResourceSession;
  images: FakeImage[];
  states: StageImageResourceState[];
} {
  const images: FakeImage[] = [];
  const states: StageImageResourceState[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createFakeImage(getDimensions);
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
  });
  return { session, images, states };
}

function reconcile(
  harness: ReturnType<typeof createHarness>,
  layers: Array<{ id: string; sourceUrl: string; assetId?: string }>,
): void {
  harness.session.reconcile(
    layers.map((layer) => ({ ...layer, assetId: layer.assetId ?? layer.id })),
    (state) => {
    harness.states.push(state);
    },
  );
}

describe('StageImageResourceSession', () => {
  it('wires the exact readiness gate through StageRenderer and hidden Export', () => {
    const stageRenderer = readFileSync(
      'src/renderer/stage/StageRenderer.tsx',
      'utf8',
    );
    const productPreview = readFileSync(
      'src/renderer/shell/ProductPreviewOverlay.tsx',
      'utf8',
    );
    const exportRenderer = readFileSync(
      'src/export-renderer/ExportRendererApp.tsx',
      'utf8',
    );
    expect(stageRenderer).toContain('StageImageResourceSession');
    expect(stageRenderer).toContain('isStageFrameReady');
    expect(stageRenderer).toContain('commitStageVisualFrame');
    expect(stageRenderer).toContain('data-stage-ready={String(ready)}');
    expect(stageRenderer).toContain('data-stage-render-token');
    expect(productPreview).toContain(
      "import { CanvasStage } from '../stage/CanvasStage'",
    );
    expect(productPreview).toContain('<CanvasStage');
    expect(stageRenderer).toContain('buildStageRenderModel');
    expect(stageRenderer).toContain('name="stage-character-head-group"');
    expect(stageRenderer).toContain('visualHeadGroupRenderTransform(headGroup)');
    expect(exportRenderer).toContain('onReady={handleStageReady}');
    expect(exportRenderer).toContain('isExactExportFrameReady');
    expect(exportRenderer).toContain('onError={handleStageError}');
    expect(exportRenderer).toContain(
      "from '../renderer/stage/CanvasStage'",
    );
    expect(exportRenderer).toContain('<CanvasStage');
  });

  it('draws all hidden export layers before capture and includes subtitle fonts in readiness', () => {
    const stageRenderer = readFileSync(
      'src/renderer/stage/StageRenderer.tsx',
      'utf8',
    );
    const exportRenderer = readFileSync(
      'src/export-renderer/ExportRendererApp.tsx',
      'utf8',
    );
    const stageCapture = readFileSync(
      'src/export-renderer/stage-capture.ts',
      'utf8',
    );

    expect(stageRenderer).toContain('await waitForSubtitleFonts');
    expect(stageRenderer).toContain('drawStageLayersSynchronously');
    expect(stageRenderer).toContain("scheduleLayerDraw={drawMode === 'legacy-raf'}");
    expect(exportRenderer).toContain('Konva.autoDrawEnabled = false');
    expect(exportRenderer).toContain('isExactExportFrameDrawn');
    expect(exportRenderer).toContain('captureExportStageCanvas(stageInstance)');
    expect(stageCapture).toContain("strategy: 'drawn-output-layer'");
    expect(stageCapture).toContain("strategy: 'stage-composite'");
    expect(exportRenderer).toContain('EXPORT_FRAME_TIMING_QUERY_PARAM');
  });

  it('keeps Export-style readiness false while an old committed frame is drawable', () => {
    const harness = createHarness();
    const initialLayers = [{ id: LAYER_A, sourceUrl: 'asset-a' }];
    const initialKey = buildStageImageSourceKey(initialLayers);

    reconcile(harness, initialLayers);
    harness.images[0]!.succeed();
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: harness.session.getSnapshot(),
        layerCount: 1,
        sourceKey: initialKey,
      }),
    ).toBe(true);

    const desiredLayers = [{ id: LAYER_A, sourceUrl: 'asset-b' }];
    reconcile(harness, desiredLayers);
    const pendingState = harness.session.getSnapshot();

    expect(pendingState.images.get(LAYER_A)).toBe(harness.images[0]);
    expect(pendingState.ready).toBe(false);
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: pendingState,
        layerCount: 1,
        sourceKey: buildStageImageSourceKey(desiredLayers),
      }),
    ).toBe(false);

    harness.images[1]!.succeed();
    const committedState = harness.session.getSnapshot();
    expect(
      isStageFrameReady({
        error: null,
        hasModel: true,
        imageState: committedState,
        layerCount: 1,
        sourceKey: buildStageImageSourceKey(desiredLayers),
      }),
    ).toBe(true);
  });

  it('does not announce the initial desired frame until every image is decoded', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.size).toBe(0);

    harness.images[0]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('keeps a Body and Face runtime pair atomic across an expression replacement', () => {
    const harness = createHarness();
    const initial = [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-expression' },
    ];

    reconcile(harness, initial);
    harness.images[0]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.size).toBe(0);
    harness.images[1]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-mouth' },
    ]);
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(CHARACTER_BODY)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(
      harness.images[1],
    );
    harness.images[2]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(CHARACTER_BODY)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(
      harness.images[2],
    );
  });

  it('loads Body, Head and Face as one required visual and reuses stable resources', () => {
    const harness = createHarness();
    const initial = [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_HEAD, sourceUrl: 'head-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-expression' },
    ];

    reconcile(harness, initial);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();
    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      images: new Map(),
    });
    harness.images[2]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_HEAD, sourceUrl: 'head-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-mouth' },
    ]);
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(CHARACTER_BODY)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(CHARACTER_HEAD)).toBe(
      harness.images[1],
    );
    harness.images[3]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(CHARACTER_HEAD)).toBe(
      harness.images[1],
    );

    reconcile(harness, [
      { id: CHARACTER_BODY, sourceUrl: 'body-v1' },
      { id: CHARACTER_FACE, sourceUrl: 'face-mouth' },
    ]);
    expect(harness.session.getSnapshot().images.has(CHARACTER_HEAD)).toBe(false);
    expect(harness.images).toHaveLength(4);
    harness.session.dispose();
    expect(harness.session.isDisposed()).toBe(true);
  });

  it('reuses unchanged decoded sources across time and transform reconciles', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.images).toHaveLength(1);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('keeps source A committed while source B is pending, then replaces it atomically', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
    expect(harness.session.getSnapshot().desiredSourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );

    harness.images[1]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[1],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );
  });

  it('reuses an already decoded A source on A → B → A without another decode', () => {
    const harness = createHarness();
    const a = [{ id: CHARACTER_FACE, sourceUrl: 'face-expression-a' }];
    const b = [{ id: CHARACTER_FACE, sourceUrl: 'face-mouth-b' }];

    reconcile(harness, a);
    harness.images[0]!.succeed();
    reconcile(harness, b);
    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(harness.images[0]);
    harness.images[1]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, a);
    expect(harness.images).toHaveLength(2);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(CHARACTER_FACE)).toBe(harness.images[0]);
    expect(isStageFrameReady({
      error: null,
      hasModel: true,
      imageState: harness.session.getSnapshot(),
      layerCount: 1,
      sourceKey: buildStageImageSourceKey(a),
    })).toBe(true);
  });

  it('lets the text-only return to A show its scheduled Camera without redundant decode wait', () => {
    const shot = {
      id: 'shot', durationMs: 1000, backgroundLayerId: null,
      dialogues: [
        { id: 'A1', characterId: 'A', startMs: 0, endMs: 300, text: 'A', audioClipId: 'audio-a' },
        { id: 'B1', characterId: 'B', startMs: 300, endMs: 600, text: 'B', audioClipId: 'audio-b' },
        { id: 'A2', characterId: 'A', startMs: 600, endMs: 900, text: 'A again' },
      ],
      timelineEvents: [{ id: 'shake-a', layerId: 'A-layer', type: 'shake', startMs: 600, endMs: 900, amplitudeX: 50, amplitudeY: 20, frequencyHz: 2 }],
      layers: [
        { id: 'A-layer', source: { kind: 'character', characterId: 'A' }, x: 400, y: 500, visible: true },
        { id: 'B-layer', source: { kind: 'character', characterId: 'B' }, x: 1500, y: 500, visible: true },
      ],
    } as unknown as Shot;
    const project = { width: 1920, height: 1080, characters: [], shots: [shot] } as unknown as Project;
    const plan = prepareSpeakerFocusCamera(project, shot);
    const harness = createHarness();
    const sourceA = [{ id: CHARACTER_FACE, sourceUrl: 'expression-a' }];
    const sourceB = [{ id: CHARACTER_FACE, sourceUrl: 'mouth-b' }];

    reconcile(harness, sourceA);
    harness.images[0]!.succeed();
    const frameA = { model: { timeMs: 250 }, caption: 'A', camera: evaluateSpeakerFocusCamera(plan, 250) };
    let committed = commitStageVisualFrame(null, frameA, harness.session.getSnapshot().ready);

    reconcile(harness, sourceB);
    const frameB = { model: { timeMs: 550 }, caption: 'B', camera: evaluateSpeakerFocusCamera(plan, 550) };
    expect(selectStageVisualFrame(committed, frameB, harness.session.getSnapshot().ready)).toEqual(frameA);
    harness.images[1]!.succeed();
    committed = commitStageVisualFrame(committed, frameB, harness.session.getSnapshot().ready);
    expect(committed?.camera?.centerX).toBe(1280);

    reconcile(harness, sourceA);
    const returnCamera = evaluateSpeakerFocusCamera(plan, 650);
    const returnFrame = { model: { timeMs: 650 }, caption: 'A again', camera: returnCamera };
    expect(harness.images).toHaveLength(2);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(selectStageVisualFrame(committed, returnFrame, true)).toEqual(returnFrame);
    expect(returnCamera.centerX).toBeLessThan(frameB.camera.centerX);
    expect(returnCamera.centerX).toBeGreaterThan(frameA.camera.centerX);
    expect(returnCamera).toEqual(evaluateSpeakerFocusCamera(plan, 650));
  });

  it('keeps Body and both Face occurrences atomic when a decoded expression returns', () => {
    const harness = createHarness();
    const a = [
      { id: 'A:body', sourceUrl: 'body-a' },
      { id: 'A:face', sourceUrl: 'expression-a' },
      { id: 'B:body', sourceUrl: 'body-b' },
      { id: 'B:face', sourceUrl: 'expression-b' },
    ];
    const b = [
      a[0]!,
      { id: 'A:face', sourceUrl: 'mouth-a' },
      a[2]!,
      { id: 'B:face', sourceUrl: 'mouth-b' },
    ];
    reconcile(harness, a);
    harness.images.forEach((image) => image.succeed());
    reconcile(harness, b);
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images[4]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images[5]!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, a);
    const state = harness.session.getSnapshot();
    expect(harness.images).toHaveLength(6);
    expect(state.ready).toBe(true);
    expect(state.images.get('A:face')).toBe(harness.images[1]);
    expect(state.images.get('B:face')).toBe(harness.images[3]);
    expect(state.images.get('A:body')).toBe(harness.images[0]);
    expect(state.images.get('B:body')).toBe(harness.images[2]);
  });

  it('keeps only the configured number of superseded decoded sources', () => {
    const harness = createHarness();
    for (let index = 0; index <= MAX_RETAINED_STAGE_SOURCES + 1; index += 1) {
      reconcile(harness, [{ id: LAYER_A, sourceUrl: `source-${index}` }]);
      harness.images.at(-1)!.succeed();
      expect(harness.session.getSnapshot().ready).toBe(true);
    }
    const countBeforeReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'source-1' }]);
    expect(harness.images).toHaveLength(countBeforeReturn);
    expect(harness.session.getSnapshot().ready).toBe(true);

    const countBeforeEvictedReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'source-0' }]);
    expect(harness.images).toHaveLength(countBeforeEvictedReturn + 1);
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images.at(-1)!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    harness.session.dispose();
    expect(harness.session.getSnapshot().images.size).toBe(0);
  });

  it('reuses 21 distinct synthetic animation frames for three complete loops', () => {
    const harness = createHarness();
    const sources = Array.from(
      { length: 21 },
      (_, index) => `synthetic-frame-${index}`,
    );
    const firstLoopImages = new Map<string, FakeImage>();
    const newImagesPerLoop: number[] = [];

    for (let loop = 0; loop < 3; loop += 1) {
      const imagesBeforeLoop = harness.images.length;
      for (const sourceUrl of sources) {
        reconcile(harness, [{ id: LAYER_A, sourceUrl }]);
        let state = harness.session.getSnapshot();
        if (!state.ready) {
          harness.images.at(-1)!.succeed();
          state = harness.session.getSnapshot();
        }

        expect(state.ready).toBe(true);
        expect(state.desiredSourceUrls.get(LAYER_A)).toBe(sourceUrl);
        expect(state.sourceUrls.get(LAYER_A)).toBe(sourceUrl);
        const image = state.images.get(LAYER_A) as unknown as FakeImage;
        if (loop === 0) firstLoopImages.set(sourceUrl, image);
        else expect(image).toBe(firstLoopImages.get(sourceUrl));
      }
      newImagesPerLoop.push(harness.images.length - imagesBeforeLoop);
    }

    expect(newImagesPerLoop).toEqual([21, 0, 0]);
    harness.session.dispose();
  });

  it('evicts by estimated decoded bytes and does not retain a single oversized image', () => {
    const imageBytes = 32 * 1024 * 1024;
    const harness = createHarness((sourceUrl) => {
      if (sourceUrl.startsWith('large-')) return { width: 4096, height: 2048 };
      if (sourceUrl === 'oversized') return { width: 4097, height: 4097 };
      return { width: 1, height: 1 };
    });
    expect(MAX_RETAINED_STAGE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_RETAINED_STAGE_SOURCES).toBe(64);
    expect(4096 * 2048 * 4).toBe(imageBytes);

    for (let index = 0; index < 4; index += 1) {
      reconcile(harness, [{ id: LAYER_A, sourceUrl: `large-${index}` }]);
      harness.images.at(-1)!.succeed();
    }

    // The third 32 MiB idle resource evicts the oldest; the remaining pair total 64 MiB.
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'small' }]);
    harness.images.at(-1)!.succeed();
    const countBeforeRetainedReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'large-2' }]);
    expect(harness.images).toHaveLength(countBeforeRetainedReturn);
    expect(harness.session.getSnapshot().ready).toBe(true);

    const countBeforeEvictedReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'large-1' }]);
    expect(harness.images).toHaveLength(countBeforeEvictedReturn + 1);
    harness.images.at(-1)!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'oversized' }]);
    harness.images.at(-1)!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'small' }]);
    harness.images.at(-1)!.succeed();
    const countBeforeOversizedReturn = harness.images.length;
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'oversized' }]);
    expect(harness.images).toHaveLength(countBeforeOversizedReturn + 1);
    expect(harness.session.getSnapshot().ready).toBe(false);
    harness.images.at(-1)!.succeed();
    expect(harness.session.getSnapshot().ready).toBe(true);
    harness.session.dispose();
  });

  it('does not cache zero, invalid, non-finite, or overflowing image dimensions', () => {
    const invalidDimensions = [
      { width: 0, height: 1 },
      { width: 1, height: 0 },
      { width: -1, height: 1 },
      { width: Number.NaN, height: 1 },
      { width: 1, height: Number.POSITIVE_INFINITY },
      { width: Number.MAX_SAFE_INTEGER, height: 2 },
    ];
    const dimensionBySource = new Map(
      invalidDimensions.map((dimensions, index) => [
        `invalid-${index}`,
        dimensions,
      ]),
    );
    const harness = createHarness(
      (sourceUrl) => dimensionBySource.get(sourceUrl) ?? { width: 1, height: 1 },
    );

    invalidDimensions.forEach((_, index) => {
      const sourceUrl = `invalid-${index}`;
      reconcile(harness, [{ id: LAYER_A, sourceUrl }]);
      harness.images.at(-1)!.succeed();
      expect(harness.session.getSnapshot().ready).toBe(true);

      reconcile(harness, [{ id: LAYER_A, sourceUrl: 'fallback' }]);
      harness.images.at(-1)!.succeed();
      const countBeforeReturn = harness.images.length;
      reconcile(harness, [{ id: LAYER_A, sourceUrl }]);
      expect(harness.images).toHaveLength(countBeforeReturn + 1);
      harness.images.at(-1)!.succeed();
      expect(harness.session.getSnapshot().ready).toBe(true);
    });

    harness.session.dispose();
  });

  it('keeps identical source images isolated to their Stage sessions', () => {
    const first = createHarness();
    const second = createHarness();
    const source = [{ id: LAYER_A, sourceUrl: 'shared-source-url' }];

    reconcile(first, source);
    reconcile(second, source);
    first.images[0]!.succeed();
    second.images[0]!.succeed();

    expect(first.session.getSnapshot().images.get(LAYER_A)).toBe(first.images[0]);
    expect(second.session.getSnapshot().images.get(LAYER_A)).toBe(second.images[0]);
    expect(first.session.getSnapshot().images.get(LAYER_A)).not.toBe(
      second.session.getSnapshot().images.get(LAYER_A),
    );

    first.session.dispose();
    second.session.dispose();
  });

  it('does not re-decode or remove unchanged siblings during one-layer replacement', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);

    expect(harness.images).toHaveLength(3);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );
  });

  it('commits simultaneous replacements only when the desired frame is complete', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b-next' },
    ]);
    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[3]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[3],
    );
  });

  it('ignores a late B completion after the desired frame returns to A', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);
    const staleB = harness.images[1]!;

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    staleB.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(staleB.src).toBe('');
  });

  it('keeps the last committed frame as an explicit fallback when a replacement fails', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, assetId: 'mouth-asset', sourceUrl: 'asset-b' }]);
    harness.images[1]!.fail();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().error).toBeInstanceOf(Error);
    expect(harness.session.getSnapshot().failures).toMatchObject([
      {
        partId: LAYER_A,
        assetId: 'mouth-asset',
        sourceUrl: 'asset-b',
        reason: 'decode',
      },
    ]);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
  });

  it('releases removed resources and makes late callbacks harmless after disposal', () => {
    const harness = createHarness();
    let callbackCount = 0;

    harness.session.reconcile(
      [
        { id: LAYER_A, sourceUrl: 'asset-a' },
        { id: LAYER_B, sourceUrl: 'asset-b' },
      ],
      () => {
        callbackCount += 1;
      },
    );
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    harness.session.reconcile(
      [{ id: LAYER_A, sourceUrl: 'asset-a' }],
      () => {
        callbackCount += 1;
      },
    );
    expect(harness.session.getSnapshot().images.has(LAYER_B)).toBe(false);
    expect(harness.images[1]!.onload).toBeNull();

    const callbacksBeforeDispose = callbackCount;
    harness.session.dispose();
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    expect(callbackCount).toBe(callbacksBeforeDispose);
    expect(harness.session.getSnapshot().images.size).toBe(0);
  });
});
